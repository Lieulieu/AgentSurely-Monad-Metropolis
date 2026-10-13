/**
 * Local verifier relayer — same logic as the CRE workflow (cre/surely-judge),
 * for local Hardhat demos where the CRE DON cannot reach your machine.
 * It must be the vault's `forwarder` (deploy.ts sets the deployer by default).
 *
 *   npm run judge:local                       # LLM if LLM_API_KEY is in .env, else mock
 *   npm run judge:local -- --mock             # force the mock judge
 *   npm run judge:local -- --chain monad      # relayer mode on Monad testnet (before CRE is wired)
 */
import { surelyVaultAbi } from "../src/generated/abis";
import {
  buildJudgeRequest,
  computeReportHash,
  deterministicChecks,
  encodeVerdict,
  mockJudge,
  parseJudgeResponse,
  verdictReason,
} from "../../cre/surely-judge/judge-core";
import { chat, llm, setup, ts } from "./env";

const { sdk, publicClient, walletClient, account, chain } = setup("JUDGE_PRIVATE_KEY");
const vault = sdk.addresses.SurelyVault;
const busy = new Set<string>();

async function judge(jobId: bigint) {
  const key = jobId.toString();
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const job = await sdk.getJob(jobId);
    if (job.status !== "Submitted") return;
    const checks = deterministicChecks(
      { status: 2, minScore: job.minScore, specHash: job.specHash, outputHash: job.outputHash },
      job.spec!,
      job.output!
    );
    let score = 0;
    let source = "checks";
    if (checks.ok) {
      if (llm) {
        const r = parseJudgeResponse(await chat(buildJudgeRequest(llm.model, job.spec!, job.output!).messages, { temperature: 0, response_format: { type: "json_object" } }));
        score = r.score;
        source = llm.model;
        console.log(`[${ts()}]   LLM: ${r.reason}`);
      } else {
        const r = mockJudge(job.spec!, job.output!);
        score = r.score;
        source = "mock";
      }
    }
    const reason = verdictReason(score, job.minScore, source, checks);
    const reportHash = computeReportHash(jobId, job.specHash, job.outputHash, score, source);
    const hash = await walletClient.writeContract({
      address: vault,
      abi: surelyVaultAbi,
      functionName: "onReport",
      args: ["0x", encodeVerdict(jobId, score, reportHash, reason)],
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[${ts()}] job #${jobId} → ${reason}  (tx ${hash.slice(0, 10)}…)`);
  } catch (e) {
    console.error(`[${ts()}] job #${jobId} failed:`, (e as Error).message);
  } finally {
    busy.delete(key);
  }
}

async function main() {
  const forwarder = await publicClient.readContract({ address: vault, abi: surelyVaultAbi, functionName: "forwarder" });
  if (forwarder.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`This key (${account.address}) is not the vault forwarder (${forwarder}).`);
  }
  console.log(`AgentSurely local judge · ${chain.name} · vault ${vault} · ${llm ? `LLM ${llm.model}` : "mock judge"}`);

  // Catch up on anything already waiting for a verdict.
  for (const j of await sdk.listJobs()) if (j.status === "Submitted") await judge(j.id);

  publicClient.watchContractEvent({
    address: vault,
    abi: surelyVaultAbi,
    eventName: "ResultSubmitted",
    onLogs: (logs) => logs.forEach((l) => l.args.jobId !== undefined && judge(l.args.jobId)),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
