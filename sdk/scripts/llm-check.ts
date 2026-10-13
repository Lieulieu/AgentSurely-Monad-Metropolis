/**
 * Checks the real LLM judge before CRE runs, and switches the CRE workflow to it.
 *   npm run llm:check                        # auto: Anthropic key (sk-ant-…) → anthropic, else openai
 *   npm run llm:check -- --provider anthropic   (or openai | qwen | kimi)
 *
 * - Reads the key from cre/.env (LLM_API_KEY_VAR) or LLM_API_KEY.
 * - Sends the exact CRE judge prompt for one good and one bad sample.
 * - Tries the configured model, then fallbacks, until one answers. For Anthropic the
 *   candidates come from GET /v1/models (newest Sonnet first, then Haiku), so no model
 *   name has to be hard-coded.
 * - Writes llm.mode = "live", url and the working model into
 *   cre/surely-judge/config.staging.json + config.production.json.
 * Never prints the key.
 */
import fs from "node:fs";
import path from "node:path";
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, buildJudgeRequestFor, llmApiFor, llmHeaders, parseJudgeResponse } from "../../cre/surely-judge/judge-core";
import { llm, positional } from "./env";
import { diagnose, explainFetchError, netFetch } from "./net";

const PROVIDERS: Record<string, { url: string; models: string[] }> = {
  anthropic: { url: ANTHROPIC_MESSAGES_URL, models: ["claude-sonnet-4-6", "claude-haiku-4-5"] },
  openai: { url: "https://api.openai.com/v1/chat/completions", models: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o"] },
  qwen: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", models: ["qwen-max", "qwen-plus"] },
  kimi: { url: "https://api.moonshot.ai/v1/chat/completions", models: ["kimi-k2-0905-preview", "moonshot-v1-8k"] },
};

const SPEC = "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.";
const GOOD = [
  "- Monad processes many transactions at the same time instead of one after another, like opening several checkout lanes.",
  "- It runs them optimistically, assuming most transactions do not touch the same accounts.",
  "- When two transactions do conflict, Monad re-runs the affected one with the corrected data.",
  "- The final result is identical to running everything in order, so apps behave predictably.",
  "- This lets Monad handle far more activity per second at low cost.",
].join("\n");
const BAD = "Sorry, I am not sure. Lorem ipsum dolor sit amet.";

const argv = process.argv.slice(2);
const pi = argv.indexOf("--provider");
const requested = (pi >= 0 ? argv[pi + 1] : undefined) ?? positional.find((p) => PROVIDERS[p]) ?? "auto";
const providerName = requested === "auto" ? (llm?.key.startsWith("sk-ant-") ? "anthropic" : "openai") : requested;
const provider = process.env.LLM_CHECK_URL ? { ...PROVIDERS[providerName], url: process.env.LLM_CHECK_URL } : PROVIDERS[providerName];
if (!provider) throw new Error(`Unknown provider ${providerName} (anthropic | openai | qwen | kimi | auto)`);
const api = providerName === "anthropic" ? ("anthropic" as const) : llmApiFor(provider.url);

/** Anthropic: newest models this key can use — Sonnet first, then Haiku, then the rest. */
async function anthropicModels(): Promise<string[]> {
  try {
    const res = await netFetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": llm!.key, "anthropic-version": ANTHROPIC_VERSION },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id: string; created_at?: string }[] };
    const list = (body.data ?? []).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).map((m) => m.id);
    const rank = (id: string) => (/sonnet/i.test(id) ? 0 : /haiku/i.test(id) ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b)).slice(0, 4);
  } catch {
    return [];
  }
}

async function judge(model: string, output: string) {
  const res = await netFetch(provider.url, {
    method: "POST",
    headers: llmHeaders(api, llm!.key),
    body: JSON.stringify(buildJudgeRequestFor(api, model, SPEC, output)),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: res.status, text };
  try {
    return { ok: true as const, ...parseJudgeResponse(JSON.parse(text)) };
  } catch (e) {
    // Unparseable answer: report it as a failed attempt for this model instead of aborting the whole check.
    return { ok: false as const, status: 0, text: `unparseable verdict — ${(e as Error).message}` };
  }
}

/** One retry: a single odd answer should not disqualify a model. */
async function judgeWithRetry(model: string, output: string) {
  const first = await judge(model, output);
  return first.ok || first.status !== 0 ? first : judge(model, output);
}

async function main() {
  if (!llm) throw new Error("No LLM key: set LLM_API_KEY_VAR in cre\\.env");
  const creDir = path.resolve(__dirname, "..", "..", "cre", "surely-judge");
  const staging = JSON.parse(fs.readFileSync(path.join(creDir, "config.staging.json"), "utf8"));
  const current = staging.llm?.url === provider.url ? [staging.llm.model] : [];
  const live = providerName === "anthropic" ? await anthropicModels() : [];
  const candidates = [...new Set([...live, ...current, ...provider.models])]; // Anthropic: newest model first
  console.log(`LLM check · provider ${providerName} · key ${llm.key.slice(0, 3)}…(${llm.key.length} chars)`);

  for (const model of candidates) {
    const good = await judgeWithRetry(model, GOOD);
    if (!good.ok) {
      const msg = good.text.slice(0, 200).replace(/\s+/g, " ");
      if (good.status === 401) throw new Error(`Key rejected (401). Check LLM_API_KEY_VAR in cre\\.env. ${msg}`);
      if (good.status === 429 && /quota|billing/i.test(good.text)) throw new Error(`No quota/credit on this key (429). ${msg}`);
      console.log(`  ✖ ${model}: ${good.status ? `HTTP ${good.status} ` : ""}${msg}`);
      continue;
    }
    const bad = await judgeWithRetry(model, BAD);
    if (!bad.ok) {
      console.log(`  ✖ ${model}: bad sample — ${bad.status ? `HTTP ${bad.status}` : bad.text.slice(0, 160)}`);
      continue;
    }
    console.log(`  ✔ ${model}: good sample ${good.score}/100 ("${good.reason}")`);
    console.log(`  ✔ ${model}: bad sample  ${bad.score}/100 ("${bad.reason}")`);
    if (good.score < 70 || bad.score >= 70) console.log("  ! judge did not separate the samples at threshold 70 — check the rubric");
    for (const f of ["config.staging.json", "config.production.json"]) {
      const p = path.join(creDir, f);
      if (!fs.existsSync(p)) continue;
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      c.llm = { ...(c.llm ?? {}), mode: "live", url: provider.url, model, api };
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
      console.log(`  → cre/surely-judge/${f}: llm.mode=live, api=${api}, model=${model}`);
    }
    console.log(`LLM_OK model=${model}`);
    return;
  }
  throw new Error(`None of ${candidates.join(", ")} worked with this key`);
}

main().catch(async (e) => {
  console.error(`LLM check failed: ${explainFetchError(e)}`);
  if (/fetch failed/i.test(String((e as Error).message))) await diagnose(new URL(provider.url).host);
  process.exit(1);
});
