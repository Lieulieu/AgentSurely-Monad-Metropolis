import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localhost, monadTestnet } from "../src/chains";
import { AgentSurelyClient } from "../src/client";
import { rateLimitedHttp } from "../src/transport";
import { netFetch } from "./net";
import { ANTHROPIC_MESSAGES_URL, llmApiFor, llmHeaders, responseText, VERDICT_SCHEMA, type LlmApi } from "../../cre/surely-judge/judge-core";

/** Default Claude model when an Anthropic key is used without LLM_MODEL (llm:check picks a live one). */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";


/**
 * Cross-platform flags (Windows cmd/PowerShell can't do `FOO=1 npm run …`):
 *   npm run agent:demo -- --agent 3 --lazy
 *   npm run judge:local -- --chain monad
 *   npm run hire -- --agent 3 "Translate … into Vietnamese"
 * Flags are copied into process.env; remaining words are returned as `positional`.
 */
const FLAG_ENV: Record<string, string> = { job: "JOB_ID", out: "OUT_FILE", agent: "AGENT_ID", chain: "CHAIN", rpc: "RPC_URL", model: "LLM_MODEL", mode: "AGENT_MODE" };
export const positional: string[] = [];
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lazy") process.env.AGENT_MODE = "lazy";
    else if (a === "--mock") process.env.FORCE_MOCK = "1";
    else if (a.startsWith("--") && FLAG_ENV[a.slice(2).split("=")[0]]) {
      const [k, inline] = a.slice(2).split("=");
      process.env[FLAG_ENV[k]] = inline ?? argv[++i];
    } else positional.push(a);
  }
}

// sdk/.env first, then contracts/.env (so one PRIVATE_KEY serves deploy + scripts).
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", "..", "contracts", ".env") });
// cre/.env holds the judge key (LLM_API_KEY_VAR) — reuse it so agent/eval scripts use the same LLM as CRE.
dotenv.config({ path: path.resolve(__dirname, "..", "..", "cre", ".env") });

/** LLM endpoint + model the CRE workflow is configured with (single source of truth). */
function creLlmConfig(): { url?: string; model?: string; api?: LlmApi } {
  try {
    const f = path.resolve(__dirname, "..", "..", "cre", "surely-judge", "config.staging.json");
    return JSON.parse(fs.readFileSync(f, "utf8")).llm ?? {};
  } catch {
    return {};
  }
}

/** Hardhat's well-known account #0 — local dev only. */
export const HARDHAT_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function setup(privateKeyEnv: string) {
  const chain: Chain = process.env.CHAIN === "monad" ? monadTestnet : localhost;
  const rpc = process.env.RPC_URL ?? chain.rpcUrls.default.http[0];
  const key = (process.env[privateKeyEnv] ||
    (chain.id === localhost.id ? HARDHAT_KEY_0 : process.env.PRIVATE_KEY)) as `0x${string}` | undefined;
  if (!key) throw new Error(`Set ${privateKeyEnv} (or PRIVATE_KEY) in sdk/.env or contracts/.env`);
  const account = privateKeyToAccount(key);
  // Public Monad RPC is rate limited (~15 req/s): throttle + retry, and fold parallel reads into Multicall3.
  const transport = chain.id === localhost.id ? http(rpc) : rateLimitedHttp(rpc, 8);
  const publicClient = createPublicClient({
    chain,
    transport,
    pollingInterval: 1_000,
    batch: chain.contracts?.multicall3 ? { multicall: true } : undefined,
  });
  const walletClient = createWalletClient({ chain, transport, account });
  // Created on first use so read-only scripts (preflight) work before the first deploy.
  let sdk: AgentSurelyClient | undefined;
  return {
    chain,
    account,
    publicClient,
    walletClient,
    get sdk() {
      return (sdk ??= new AgentSurelyClient({ publicClient, walletClient }));
    },
  };
}

export type Llm = { url: string; model: string; key: string; api: LlmApi } | null;
const llmKey = process.env.LLM_API_KEY || process.env.LLM_API_KEY_VAR;
const creLlm = creLlmConfig();
/** An Anthropic key (sk-ant-…) with no explicit endpoint → Anthropic Messages API. */
const anthropicKey = !!llmKey && llmKey.startsWith("sk-ant-");
const llmUrl =
  process.env.LLM_URL ??
  (anthropicKey && !/anthropic\.com/i.test(creLlm.url ?? "") ? ANTHROPIC_MESSAGES_URL : creLlm.url) ??
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const llmApi = llmApiFor(llmUrl, (process.env.LLM_API as LlmApi | undefined) ?? creLlm.api);
export const llm: Llm = llmKey && process.env.FORCE_MOCK !== "1"
  ? {
      url: llmUrl,
      model:
        process.env.LLM_MODEL ??
        (llmApi === "anthropic" && !/^claude/i.test(creLlm.model ?? "") ? DEFAULT_CLAUDE_MODEL : creLlm.model) ??
        "qwen-max",
      key: llmKey,
      api: llmApi,
    }
  : null;

/**
 * Chat call in either wire format. Always returns an OpenAI-shaped body
 * ({ choices: [{ message: { content } }] }) so callers don't care which provider is used.
 */
export async function chat(messages: { role: string; content: string }[], extra: Record<string, unknown> = {}) {
  if (!llm) throw new Error("LLM not configured");
  let body: Record<string, unknown>;
  if (llm.api === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    // OpenAI-only knobs (response_format, seed) are dropped; prompts already ask for JSON where needed.
    // `temperature` is dropped too: newer Claude models reject it.
    const { response_format: rf, seed: _seed, temperature: _t, max_tokens, ...keep } = extra as Record<string, unknown>;
    body = { model: llm.model, max_tokens: max_tokens ?? 4096, ...(system ? { system } : {}), messages: rest, ...keep };
    // JSON wanted (judge, eval): structured outputs with the verdict schema, so the answer is always JSON.
    if ((rf as { type?: string } | undefined)?.type === "json_object") {
      body.output_config = { format: { type: "json_schema", schema: VERDICT_SCHEMA } };
    }
  } else {
    body = { model: llm.model, messages, ...extra };
  }
  const res = await netFetch(llm.url, { method: "POST", headers: llmHeaders(llm.api, llm.key), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (llm.api === "anthropic") return { choices: [{ message: { content: responseText(json) ?? "" } }], raw: json };
  return json;
}

export const ts = () => new Date().toLocaleTimeString();

/** Default job size in USDC (upgrade-04 — Circle's faucet gives 20 USDC / 2h, so amounts are small). */
export const JOB_FEE = 100_000n; //      0.10 USDC
export const JOB_COVERAGE = 250_000n; // 0.25 USDC

/**
 * Make sure `who` holds `need` USDC. Locally the MockStable USDC is minted; on Monad testnet USDC is
 * Circle's and cannot be minted, so this stops with a clear message instead of a 0xe450d38c revert.
 */
export async function ensureUsdc(sdk: AgentSurelyClient, who: `0x${string}`, need: bigint, what = "this step") {
  const bal = await sdk.tokenBalance(who);
  if (bal >= need) return;
  if (process.env.CHAIN !== "monad") {
    await sdk.mintUsdcLocal(who, need - bal + 10_000_000n);
    console.log(`[${ts()}] local: minted USDC for ${who}`);
    return;
  }
  const f = (v: bigint) => (Number(v) / 1e6).toFixed(2);
  throw new Error(
    `${who} has ${f(bal)} USDC but ${what} needs ${f(need)} USDC. Get testnet USDC at https://faucet.circle.com ` +
      `(choose Monad Testnet, 20 USDC / 2h per address), then run again.`
  );
}
