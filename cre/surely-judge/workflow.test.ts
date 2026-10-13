import { describe, expect } from "bun:test";
import type { EVMLog } from "@chainlink/cre-sdk";
import {
  addContractMock,
  EvmMock,
  HttpActionsMock,
  newTestRuntime,
  REPORT_METADATA_HEADER_LENGTH,
  test,
} from "@chainlink/cre-sdk/test";
import { decodeAbiParameters, keccak256, pad, toBytes, toHex, type Hex } from "viem";

import { parseJudgeResponse, RESULT_SUBMITTED_TOPIC, SURELY_VAULT_ABI } from "./judge-core";
import { onCron, onResultSubmitted, type Config } from "./workflow";

const MONAD_TESTNET = 2183018362218727504n;
const VAULT = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as const;

const baseConfig: Config = {
  chainSelectorName: "monad-testnet",
  vaultAddress: VAULT,
  gasLimit: "600000",
  llm: { mode: "live", url: "https://llm.example/v1/chat/completions", model: "qwen-max" },
};

const SPEC = "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.";
const GOOD =
  "- Monad runs transactions in parallel, like several checkout lanes.\n- Execution is optimistic.\n- Conflicts are re-run.\n- Results match sequential order.\n- This gives 10,000 TPS for a non-technical reader.";

function makeLog(jobId: bigint): EVMLog {
  return {
    topics: [toBytes(RESULT_SUBMITTED_TOPIC), toBytes(pad(toHex(jobId))), toBytes(pad(toHex(1n)))],
  } as unknown as EVMLog;
}

function job(output: string, status = 2, minScore = 70) {
  return {
    agentId: 1n,
    client: "0x0000000000000000000000000000000000000001",
    fee: 25_000_000n,
    coverage: 500_000_000n,
    createdAt: 1n,
    deadline: 9_999_999_999n,
    submittedAt: 2n,
    minScore,
    score: 0,
    status,
    specHash: keccak256(toBytes(SPEC)),
    outputHash: keccak256(toBytes(output)),
    reportHash: ("0x" + "00".repeat(32)) as Hex,
  };
}

function setup(output: string, llmScore: number | null, status: number | number[] = 2, cfg: Config = baseConfig) {
  const evm = EvmMock.testInstance(MONAD_TESTNET);
  const vault = addContractMock(evm, { address: VAULT, abi: SURELY_VAULT_ABI });
  const statuses = Array.isArray(status) ? status : [status];
  const reads: bigint[] = [];
  vault.jobCount = () => BigInt(statuses.length);
  vault.getJobForVerification = (id: unknown) => {
    reads.push(id as bigint);
    const st = Array.isArray(status) ? statuses[Number(id)] : statuses[0];
    return [job(output, st), SPEC, output];
  };

  let verdict: { jobId: bigint; score: number; reason: string } | undefined;
  vault.writeReport = ({ report }) => {
    const payload = toHex(report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH));
    const [jobId, score, , reason] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "string" }],
      payload
    );
    verdict = { jobId, score, reason };
    return { txStatus: "TX_STATUS_SUCCESS" };
  };

  const http = HttpActionsMock.testInstance();
  let llmCalls = 0;
  http.sendRequest = (req) => {
    llmCalls++;
    expect(req.url).toBe(cfg.llm.url);
    const content = JSON.stringify({ score: llmScore, reason: "test" });
    if (cfg.llm.url.includes("anthropic.com")) {
      expect(req.headers?.["x-api-key"]).toBe("test-key");
      expect(req.headers?.["anthropic-version"]).toBe("2023-06-01");
      const raw = req.body as unknown;
      const text = typeof raw === "string" ? Buffer.from(raw, "base64").toString("utf8") : new TextDecoder().decode(raw as Uint8Array);
      const sent = JSON.parse(text);
      expect(typeof sent.system).toBe("string");
      expect(sent.max_tokens).toBeGreaterThan(0);
      expect(sent.output_config?.format?.type).toBe("json_schema");
      expect(sent.temperature).toBeUndefined();
      const reply = { content: [{ type: "text", text: content }] };
      return { statusCode: 200, body: new TextEncoder().encode(JSON.stringify(reply)) };
    }
    expect(req.headers?.Authorization).toBe("Bearer test-key");
    return { statusCode: 200, body: new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content } }] })) };
  };

  return { getVerdict: () => verdict, getLlmCalls: () => llmCalls, reads };
}

const secrets = new Map([["main", new Map([["LLM_API_KEY", "test-key"]])]]);

describe("surely-judge workflow", () => {
  test("passes a good output using the LLM score", () => {
    const { getVerdict, getLlmCalls } = setup(GOOD, 86);
    const runtime = newTestRuntime<Config>(secrets, {}, baseConfig);
    const out = JSON.parse(onResultSubmitted(runtime, makeLog(7n)));
    expect(out.score).toBe(86);
    expect(getLlmCalls()).toBe(1);
    expect(getVerdict()).toEqual({ jobId: 7n, score: 86, reason: "PASS · score 86/70 · qwen-max · surely-judge/v1" });
  });

  test("fails a poor output (slash path)", () => {
    const { getVerdict } = setup("lorem ipsum dolor sit amet", 22);
    const runtime = newTestRuntime<Config>(secrets, {}, baseConfig);
    onResultSubmitted(runtime, makeLog(8n));
    expect(getVerdict()?.score).toBe(22);
    expect(getVerdict()?.reason.startsWith("FAIL")).toBe(true);
  });

  test("skips the LLM and scores 0 when deterministic checks fail", () => {
    const { getVerdict, getLlmCalls } = setup(GOOD, 99, /* status */ 3);
    const runtime = newTestRuntime<Config>(secrets, {}, baseConfig);
    onResultSubmitted(runtime, makeLog(9n));
    expect(getLlmCalls()).toBe(0);
    expect(getVerdict()?.score).toBe(0);
    expect(getVerdict()?.reason).toContain("checks:");
  });

  test("mock mode judges offline without secrets", () => {
    const { getVerdict, getLlmCalls } = setup(GOOD, null);
    const runtime = newTestRuntime<Config>(null, {}, { ...baseConfig, llm: { ...baseConfig.llm, mode: "mock" } });
    onResultSubmitted(runtime, makeLog(10n));
    expect(getLlmCalls()).toBe(0);
    expect(getVerdict()!.score).toBeGreaterThan(50);
  });

  test("cron fallback verifies the oldest waiting job in the scan window", () => {
    // jobs: #0 Passed, #1 Submitted, #2 Submitted, #3 Open
    const { getVerdict, reads } = setup(GOOD, 91, [3, 2, 2, 1]);
    const runtime = newTestRuntime<Config>(secrets, {}, { ...baseConfig, cronSchedule: "0 * * * * *", scanWindow: 5 });
    onCron(runtime);
    expect(reads).toEqual([3n, 2n, 1n, 0n]);
    expect(getVerdict()).toEqual({ jobId: 1n, score: 91, reason: "PASS · score 91/70 · qwen-max · surely-judge/v1" });
  });

  test("cron fallback does nothing when no job is waiting", () => {
    const { getVerdict, getLlmCalls } = setup(GOOD, 91, [3, 4, 1]);
    const runtime = newTestRuntime<Config>(secrets, {}, { ...baseConfig, scanWindow: 2 });
    expect(JSON.parse(onCron(runtime))).toEqual({ verified: null });
    expect(getVerdict()).toBeUndefined();
    expect(getLlmCalls()).toBe(0);
  });

  test("uses the Anthropic Messages API when the url is api.anthropic.com", () => {
    const cfg: Config = { ...baseConfig, llm: { mode: "live", url: "https://api.anthropic.com/v1/messages", model: "claude-test" } };
    const { getVerdict, getLlmCalls } = setup(GOOD, 88, 2, cfg);
    const runtime = newTestRuntime<Config>(secrets, {}, cfg);
    onResultSubmitted(runtime, makeLog(9n));
    expect(getLlmCalls()).toBe(1);
    expect(getVerdict()).toEqual({ jobId: 9n, score: 88, reason: "PASS · score 88/70 · claude-test · surely-judge/v1" });
  });

  test("parses verdicts from tool_use, JSON text and prose fallbacks", () => {
    expect(parseJudgeResponse({ content: [{ type: "tool_use", input: { score: 77, reason: "ok" } }] })).toEqual({ score: 77, reason: "ok" });
    expect(parseJudgeResponse({ content: [{ type: "text", text: 'Sure. {"score": 64, "reason": "meh"}' }] }).score).toBe(64);
    expect(parseJudgeResponse({ content: [{ type: "text", text: "The output meets the format. Score: 88 — clear and accurate." }] }).score).toBe(88);
    expect(() => parseJudgeResponse({ content: [{ type: "text", text: "The output meets the format." }] })).toThrow();
  });
});
