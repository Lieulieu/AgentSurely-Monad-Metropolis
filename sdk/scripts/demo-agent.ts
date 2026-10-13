/**
 * Demo ERC-8004 agent: watches for jobs assigned to AGENT_ID, does the work
 * (LLM if LLM_API_KEY is set, otherwise a canned answer) and submits it.
 *
 *   npm run agent:demo -- --agent 1
 *   npm run agent:demo -- --agent 3 --lazy        # deliberately bad output → slash demo
 *   npm run agent:demo -- --agent 1 --chain monad
 */
import { surelyVaultAbi } from "../src/generated/abis";
import { chat, llm, setup, ts } from "./env";

const { sdk, publicClient, chain } = setup("AGENT_PRIVATE_KEY");
const AGENT_ID = BigInt(process.env.AGENT_ID ?? "1");
const LAZY = process.env.AGENT_MODE === "lazy";
const done = new Set<string>();

async function work(spec: string): Promise<string> {
  if (LAZY) return "Sorry, I am not sure. Lorem ipsum dolor sit amet.";
  if (llm) {
    const r = (await chat([
      { role: "system", content: "You are a precise assistant. Follow every constraint in the task." },
      { role: "user", content: spec },
    ])) as { choices: { message: { content: string } }[] };
    return r.choices[0].message.content.slice(0, 4000);
  }
  // Offline fallback: restate the task's key terms in a structured answer.
  const terms = Array.from(new Set(spec.toLowerCase().match(/[a-zà-ỹ0-9']{4,}/gi) ?? [])).slice(0, 12);
  return [`Answer for: ${spec}`, ...terms.map((t, i) => `${i + 1}. ${t} — covered in detail.`)].join("\n");
}

async function handle(jobId: bigint) {
  const key = jobId.toString();
  if (done.has(key)) return;
  done.add(key);
  const job = await sdk.getJob(jobId);
  if (job.agentId !== AGENT_ID || job.status !== "Open") return;
  console.log(`[${ts()}] job #${jobId}: "${job.spec!.slice(0, 70)}…"`);
  const output = await work(job.spec!);
  await sdk.submitResult(jobId, output);
  console.log(`[${ts()}] job #${jobId}: submitted ${output.length} chars → waiting for CRE verdict`);
}

async function main() {
  const agent = await sdk.getAgent(AGENT_ID);
  console.log(`Agent #${AGENT_ID} "${agent.profile.name}" on ${chain.name} · mode ${LAZY ? "lazy" : llm ? "llm" : "offline"}`);
  for (const j of await sdk.listJobs({ agentId: AGENT_ID })) if (j.status === "Open") await handle(j.id);
  publicClient.watchContractEvent({
    address: sdk.addresses.SurelyVault,
    abi: surelyVaultAbi,
    eventName: "JobCreated",
    args: { agentId: AGENT_ID },
    onLogs: (logs) => logs.forEach((l) => l.args.jobId !== undefined && handle(l.args.jobId).catch((e) => console.error(e.message))),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
