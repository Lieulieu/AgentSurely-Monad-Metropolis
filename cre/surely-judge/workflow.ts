/**
 * AgentSurely · CRE workflow "surely-judge" — handlers (entrypoint: main.ts)
 *
 * Orchestration layer between Monad and an off-chain LLM:
 *   1. EVM log trigger  — SurelyVault emits ResultSubmitted(jobId, agentId, outputHash)
 *      (optional cron trigger scans for waiting jobs as a fallback)
 *   2. EVM read         — getJobForVerification(jobId) → job, spec, output
 *   3. Deterministic checks (hashes, state, length) — identical on every node
 *   4. HTTP (node mode) — LLM judge scores the output 0-100; DON takes the median
 *   5. Signed report    — abi.encode(jobId, score, reportHash, reason)
 *   6. EVM write        — KeystoneForwarder → SurelyVault.onReport → pay or slash
 */
import {
  bytesToHex,
  consensusMedianAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  logTriggerConfig,
  ok,
  prepareReportRequest,
  type EVMLog,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";

import {
  buildJudgeRequestFor,
  llmApiFor,
  llmHeaders,
  computeReportHash,
  deterministicChecks,
  encodeVerdict,
  mockJudge,
  parseJudgeResponse,
  RESULT_SUBMITTED_TOPIC,
  STATUS_SUBMITTED,
  SURELY_VAULT_ABI,
  verdictReason,
} from "./judge-core";

export const configSchema = z.object({
  chainSelectorName: z.string(), // e.g. "monad-testnet"
  vaultAddress: z.string(),
  gasLimit: z.string(),
  // Optional fallback poller, e.g. "0 * * * * *" (every minute, 6-field cron)
  cronSchedule: z.string().optional(),
  scanWindow: z.number().int().positive().optional(),
  llm: z.object({
    mode: z.enum(["live", "mock"]),
    url: z.string(), // OpenAI-compatible /chat/completions or Anthropic /v1/messages endpoint
    model: z.string(),
    api: z.enum(["openai", "anthropic"]).optional(), // default: inferred from url
  }),
});
export type Config = z.infer<typeof configSchema>;

const getEvmClient = (config: Config) => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true });
  if (!network) throw new Error(`Unknown chain ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
};

/** Runs on every node: call the LLM and return its score. The DON takes the median. */
const askLlm = (sendRequester: HTTPSendRequester, config: Config, apiKey: string, spec: string, output: string): number => {
  const api = llmApiFor(config.llm.url, config.llm.api);
  const body = buildJudgeRequestFor(api, config.llm.model, spec, output);
  const response = sendRequester
    .sendRequest({
      url: config.llm.url,
      method: "POST",
      headers: llmHeaders(api, apiKey),
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    })
    .result();
  if (!ok(response)) throw new Error(`LLM HTTP ${response.statusCode}`);
  const parsed = parseJudgeResponse(JSON.parse(new TextDecoder().decode(response.body)));
  return parsed.score;
};

type Evm = ReturnType<typeof getEvmClient>;

const readVault = <F extends "getJobForVerification" | "jobCount">(
  runtime: Runtime<Config>,
  evm: Evm,
  functionName: F,
  args: F extends "jobCount" ? [] : [bigint]
) => {
  const call = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.vaultAddress as Address,
        data: encodeFunctionData({ abi: SURELY_VAULT_ABI, functionName, args } as never),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi: SURELY_VAULT_ABI, functionName, data: bytesToHex(call.data) } as never);
};

type JobTuple = readonly [
  { minScore: number; status: number; specHash: Hex; outputHash: Hex },
  string,
  string,
];

/** Steps 3–6 for one job: checks → LLM judge (DON median) → signed report → onReport. */
const verifyJob = (runtime: Runtime<Config>, evm: Evm, jobId: bigint, data?: JobTuple): string => {
  const config = runtime.config;
  const [job, spec, output] = data ?? (readVault(runtime, evm, "getJobForVerification", [jobId]) as JobTuple);

  // 3. Deterministic checks
  const checks = deterministicChecks(job, spec, output);
  let score = 0;
  let source = "checks";

  // 4. LLM judge with DON consensus (median of node scores)
  if (checks.ok) {
    if (config.llm.mode === "mock") {
      const m = mockJudge(spec, output);
      score = m.score;
      source = "mock";
      runtime.log(m.reason);
    } else {
      const apiKey = runtime.getSecret({ id: "LLM_API_KEY" }).result().value;
      const http = new cre.capabilities.HTTPClient();
      score = http
        .sendRequest(runtime, askLlm, consensusMedianAggregation<number>())(config, apiKey, spec, output)
        .result();
      source = config.llm.model;
    }
  } else {
    runtime.log(`Checks failed: ${checks.failures.join("; ")}`);
  }

  const reason = verdictReason(score, job.minScore, source, checks);
  const reportHash = computeReportHash(jobId, job.specHash, job.outputHash, score, source);
  runtime.log(`Verdict job #${jobId}: ${reason}`);

  // 5 + 6. Sign the report and deliver it to SurelyVault.onReport via the forwarder
  const report = runtime.report(prepareReportRequest(encodeVerdict(jobId, score, reportHash, reason))).result();
  const write = evm
    .writeReport(runtime, { receiver: config.vaultAddress as Address, report, gasConfig: { gasLimit: config.gasLimit } })
    .result();

  const txHash = write.txHash ? bytesToHex(write.txHash) : ("0x" as Hex);
  runtime.log(`writeReport status=${write.txStatus} tx=${txHash}`);
  return JSON.stringify({ jobId: jobId.toString(), score, reason, txHash });
};

/** Primary trigger: SurelyVault emitted ResultSubmitted(jobId, agentId, outputHash). */
export const onResultSubmitted = (runtime: Runtime<Config>, log: EVMLog): string => {
  const jobId = BigInt(bytesToHex(log.topics[1])); // topics = [sig, jobId, agentId]
  runtime.log(`ResultSubmitted · job #${jobId}`);
  return verifyJob(runtime, getEvmClient(runtime.config), jobId);
};

/**
 * Fallback trigger (set `cronSchedule` in config): scans the newest `scanWindow`
 * jobs and verifies the oldest one still waiting. One verdict per tick keeps the
 * run inside CRE's per-execution call limits.
 */
export const onCron = (runtime: Runtime<Config>): string => {
  const evm = getEvmClient(runtime.config);
  const count = readVault(runtime, evm, "jobCount", []) as bigint;
  const window = BigInt(runtime.config.scanWindow ?? 5);
  const from = count > window ? count - window : 0n;
  let pending: { id: bigint; data: JobTuple } | undefined;
  for (let id = count - 1n; id >= from && id >= 0n; id--) {
    const data = readVault(runtime, evm, "getJobForVerification", [id]) as JobTuple;
    if (data[0].status === STATUS_SUBMITTED) pending = { id, data };
  }
  if (!pending) {
    runtime.log(`cron · no job waiting among #${from}..#${count - 1n}`);
    return JSON.stringify({ verified: null });
  }
  runtime.log(`cron · verifying job #${pending.id}`);
  return verifyJob(runtime, evm, pending.id, pending.data);
};

export const initWorkflow = (config: Config) => {
  const evm = getEvmClient(config);
  return [
    cre.handler(
      evm.logTrigger(
        logTriggerConfig({
          addresses: [config.vaultAddress as Hex],
          topics: [[RESULT_SUBMITTED_TOPIC]],
          confidence: "LATEST",
        })
      ),
      onResultSubmitted
    ),
    ...(config.cronSchedule
      ? [cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.cronSchedule }), onCron)]
      : []),
  ];
};
