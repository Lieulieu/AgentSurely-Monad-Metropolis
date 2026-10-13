/**
 * Pure judging logic shared by the CRE workflow (main.ts) and the local
 * relayer (sdk/scripts/local-judge.ts). No CRE or Node APIs in here, so it
 * runs both inside the CRE WASM runtime and in plain Node.
 */
import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

export const SURELY_VAULT_ABI = [
  {
    type: "event",
    name: "ResultSubmitted",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "outputHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "jobCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getJobForVerification",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "job",
        type: "tuple",
        components: [
          { name: "agentId", type: "uint256" },
          { name: "client", type: "address" },
          { name: "fee", type: "uint256" },
          { name: "coverage", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "submittedAt", type: "uint64" },
          { name: "minScore", type: "uint8" },
          { name: "score", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "specHash", type: "bytes32" },
          { name: "outputHash", type: "bytes32" },
          { name: "reportHash", type: "bytes32" },
        ],
      },
      { name: "spec", type: "string" },
      { name: "output", type: "string" },
    ],
  },
] as const;

/** keccak256("ResultSubmitted(uint256,uint256,bytes32)") */
export const RESULT_SUBMITTED_TOPIC = keccak256(toBytes("ResultSubmitted(uint256,uint256,bytes32)"));

export const STATUS_SUBMITTED = 2;
export const JUDGE_VERSION = "surely-judge/v1";

export type JobForVerification = {
  status: number;
  minScore: number;
  specHash: Hex;
  outputHash: Hex;
};

export type CheckResult = { ok: boolean; failures: string[] };

/** Cheap, deterministic checks every node agrees on before asking the LLM. */
export function deterministicChecks(job: JobForVerification, spec: string, output: string): CheckResult {
  const failures: string[] = [];
  if (job.status !== STATUS_SUBMITTED) failures.push(`job not in Submitted state (status=${job.status})`);
  if (keccak256(toBytes(spec)) !== job.specHash) failures.push("spec hash mismatch");
  if (keccak256(toBytes(output)) !== job.outputHash) failures.push("output hash mismatch");
  if (output.trim().length < 10) failures.push("output is empty or too short");
  return { ok: failures.length === 0, failures };
}

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict, impartial verifier for paid AI-agent work. " +
  "Score how well the OUTPUT fulfils the TASK from 0 to 100 using this rubric: " +
  "correctness 40, completeness 30, follows explicit constraints (format, length, language) 20, clarity 10. " +
  "Hallucinated facts or ignoring the task must score below 40. " +
  'Respond ONLY with JSON: {"score": <integer 0-100>, "reason": "<one sentence>"}';

/**
 * Wire format of the LLM endpoint.
 *   openai    — OpenAI-compatible /chat/completions (OpenAI, Qwen/DashScope, Kimi/Moonshot…)
 *   anthropic — Anthropic Messages API (https://api.anthropic.com/v1/messages)
 */
export type LlmApi = "openai" | "anthropic";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/** Explicit `api` wins; otherwise an anthropic.com URL means the Messages API. */
export function llmApiFor(url: string, api?: LlmApi): LlmApi {
  return api ?? (/anthropic\.com/i.test(url) ? "anthropic" : "openai");
}

/** HTTP headers for the LLM call (never logged). */
export function llmHeaders(api: LlmApi, key: string): Record<string, string> {
  return api === "anthropic"
    ? { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION }
    : { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

/** OpenAI-compatible chat request body for the LLM judge. */
export function buildJudgeRequest(model: string, spec: string, output: string) {
  return {
    model,
    temperature: 0,
    seed: 42,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: `TASK:\n${spec}\n\nOUTPUT:\n${output}` },
    ],
  };
}

/**
 * Anthropic Messages API request body for the LLM judge. No `temperature`: newer Claude models
 * reject it; the DON median across nodes absorbs run-to-run variance.
 */
export function buildAnthropicJudgeRequest(model: string, spec: string, output: string) {
  return {
    model,
    max_tokens: 600,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `TASK:\n${spec}\n\nOUTPUT:\n${output}` }],
    // Structured outputs: the answer is constrained to this JSON schema, so prose replies like
    // "The output meets the format…" can no longer break parsing. Works on every current Claude model
    // (forced tool_choice does not — e.g. claude-sonnet-5-5 rejects it).
    output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
  };
}

/** JSON schema of a verdict (structured outputs: no min/max on integers — the score is clamped instead). */
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100 score using the rubric" },
    reason: { type: "string", description: "One sentence explaining the score" },
  },
  required: ["score", "reason"],
  additionalProperties: false,
} as const;

/** Judge request body in the endpoint's wire format. */
export function buildJudgeRequestFor(api: LlmApi, model: string, spec: string, output: string) {
  return api === "anthropic" ? buildAnthropicJudgeRequest(model, spec, output) : buildJudgeRequest(model, spec, output);
}

/** Text of a chat response in either wire format (OpenAI choices[] or Anthropic content[]). */
export function responseText(body: unknown): string | undefined {
  const b = body as {
    choices?: { message?: { content?: string } }[];
    content?: { type?: string; text?: string; input?: unknown }[];
  };
  const openai = b?.choices?.[0]?.message?.content;
  if (openai) return openai;
  if (Array.isArray(b?.content)) {
    // A tool_use block (if a caller uses tools) wins over free text.
    const tool = b.content.find((c) => c?.type === "tool_use" && c.input && typeof c.input === "object");
    if (tool) return JSON.stringify(tool.input);
    const text = b.content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
    return text || undefined;
  }
  return undefined;
}

/** Extracts {score, reason} from an OpenAI-compatible or Anthropic Messages response. */
export function parseJudgeResponse(body: unknown): { score: number; reason: string } {
  const content = responseText(body);
  if (!content) throw new Error("LLM response has no content");
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
      if (parsed.score !== undefined) return { score: clampScore(Number(parsed.score)), reason: String(parsed.reason ?? "").slice(0, 280) };
    } catch {
      /* fall through to the text fallback */
    }
  }
  // Fallback for prose answers: "... score: 82 ..." / "82/100".
  const m = content.match(/score["'\s:=]*\**\s*(\d{1,3})\b/i) ?? content.match(/\b(\d{1,3})\s*\/\s*100\b/);
  if (m) return { score: clampScore(Number(m[1])), reason: content.replace(/\s+/g, " ").trim().slice(0, 280) };
  throw new Error(`LLM response is not JSON: ${content.slice(0, 120)}`);
}

/**
 * Offline judge used when no LLM key is configured (demos, CI).
 * Keyword coverage of the task + length sanity. Deterministic.
 */
export function mockJudge(spec: string, output: string): { score: number; reason: string } {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9à-ỹ]+/i)
        .filter((w) => w.length > 3)
    );
  const want = words(spec);
  const got = words(output);
  let hit = 0;
  want.forEach((w) => {
    if (got.has(w)) hit++;
  });
  const coverage = want.size === 0 ? 0 : hit / want.size;
  const lengthOk = output.length >= 80 ? 1 : output.length / 80;
  const score = clampScore(Math.round(100 * (0.7 * Math.min(1, coverage * 1.6) + 0.3 * lengthOk)));
  return { score, reason: `mock judge: ${Math.round(coverage * 100)}% task keyword coverage` };
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Short, deterministic reason string stored onchain. */
export function verdictReason(score: number, minScore: number, source: string, checks: CheckResult): string {
  if (!checks.ok) return `FAIL · checks: ${checks.failures.join("; ")}`;
  return `${score >= minScore ? "PASS" : "FAIL"} · score ${score}/${minScore} · ${source} · ${JUDGE_VERSION}`;
}

/** Commitment to everything the verdict was based on. */
export function computeReportHash(jobId: bigint, specHash: Hex, outputHash: Hex, score: number, source: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "string" }],
      [jobId, specHash, outputHash, score, `${source}|${JUDGE_VERSION}`]
    )
  );
}

/** Payload decoded by SurelyVault.onReport. */
export function encodeVerdict(jobId: bigint, score: number, reportHash: Hex, reason: string): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "string" }],
    [jobId, score, reportHash, reason]
  );
}
