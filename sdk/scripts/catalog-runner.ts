/**
 * Runs the AgentSurely catalog agents: watches JobCreated for catalog agentIds,
 * executes the agent's ported steps with the LLM (OpenAI-compatible, key from
 * cre/.env or sdk/.env) and submits the result → CRE judge settles it.
 *
 *   npm run catalog:run                  # local Hardhat
 *   npm run catalog:run -- --chain monad
 *   npm run catalog:run -- --chain monad --once     # handle open jobs, then exit
 *   npm run catalog:run -- --chain monad --once --job 4 --out logs/settle.txt
 *       only task #4; appends "TX JOB" per delivered task to the file (run-cre-monad.cmd settle
 *       then asks Chainlink CRE for each verdict)
 *
 * Without an LLM key it answers offline (demo only).
 */
import fs from "node:fs";
import { surelyVaultAbi } from "../src/generated/abis";
import { runCatalogAgent, type ChatMessage } from "../src/catalog-core";
import type { CatalogAgent } from "../src/types";
import { chat, llm, setup, ts } from "./env";

const ONCE = process.argv.includes("--once");
const ONLY = process.env.JOB_ID !== undefined ? BigInt(process.env.JOB_ID) : undefined;
const OUT = process.env.OUT_FILE;
const MAX_PER_CLIENT_PER_HOUR = Number(process.env.CATALOG_RATE_LIMIT ?? 30);

const { sdk, publicClient, chain, account } = setup("PRIVATE_KEY");
const byAgentId = new Map<bigint, CatalogAgent>();
for (const a of sdk.catalog()) if (a.agentId !== undefined) byAgentId.set(a.agentId, a);
const done = new Set<string>();
const recent = new Map<string, number[]>();

async function llmChat(messages: ChatMessage[]): Promise<string> {
  const r = (await chat(messages, { temperature: 0.2 })) as { choices: { message: { content: string } }[] };
  return r.choices[0].message.content;
}

function offline(agent: CatalogAgent, spec: string): string {
  const terms = Array.from(new Set(spec.toLowerCase().match(/[a-zà-ỹ0-9']{4,}/gi) ?? [])).slice(0, 10);
  return [`${agent.name} — answer for: ${spec}`, ...terms.map((t, i) => `${i + 1}. ${t}: addressed with a concrete explanation.`)].join("\n");
}

function rateLimited(client: string): boolean {
  const now = Date.now();
  const list = (recent.get(client) ?? []).filter((t) => now - t < 3_600_000);
  recent.set(client, list);
  if (list.length >= MAX_PER_CLIENT_PER_HOUR) return true;
  list.push(now);
  return false;
}

async function handle(jobId: bigint) {
  const key = jobId.toString();
  if (done.has(key)) return;
  done.add(key);
  const job = await sdk.getJob(jobId);
  const agent = byAgentId.get(job.agentId);
  if (!agent) {
    console.log(`[${ts()}] job #${jobId}: agent #${job.agentId} is not a catalog agent — its own creator must deliver it`);
    return;
  }
  if (job.status !== "Open") {
    console.log(`[${ts()}] job #${jobId}: status ${job.status} — nothing to deliver`);
    return;
  }
  if (job.deadline * 1000 < Date.now()) {
    console.log(`[${ts()}] job #${jobId}: deadline passed — the client can claim fee + coverage on the task page (claimExpired)`);
    return;
  }
  const placeholders = job.spec?.match(/<[^<>\n]{1,40}>/g);
  if (placeholders) console.log(`[${ts()}] job #${jobId}: spec still has placeholders ${placeholders.join(" ")} — the agent will answer generically and may FAIL`);
  if (rateLimited(job.client.toLowerCase())) {
    console.log(`[${ts()}] job #${jobId}: client ${job.client} over ${MAX_PER_CLIENT_PER_HOUR}/h — skipped (job can expire or be retried)`);
    return;
  }
  console.log(`[${ts()}] job #${jobId} → ${agent.name} (${agent.tier}, ${agent.steps.length} step${agent.steps.length > 1 ? "s" : ""}) · ${agent.source.project}`);
  const output = llm
    ? await runCatalogAgent(agent, job.spec!, llmChat, (name, out) => console.log(`[${ts()}]   step ${name}: ${out.length} chars`))
    : offline(agent, job.spec!);
  const tx = await sdk.submitResult(jobId, output);
  console.log(`[${ts()}] job #${jobId}: submitted ${output.length} chars · tx ${tx}`);
  if (OUT) fs.appendFileSync(OUT, `${tx} ${jobId}\n`);
}

async function main() {
  if (byAgentId.size === 0) throw new Error(`No catalog agents registered on chain ${chain.id} — run npm run catalog:register`);
  console.log(`Catalog runner · ${chain.name} · ${byAgentId.size} agents · operator ${account.address} · ${llm ? `LLM ${llm.model}` : "offline mode"}`);
  if (ONLY !== undefined) {
    await handle(ONLY).catch((e) => console.error(`job #${ONLY}: ${e.message}`));
    return;
  }
  const open = (await sdk.listJobs()).filter((j) => j.status === "Open" && byAgentId.has(j.agentId));
  console.log(`${open.length} open task(s) for catalog agents`);
  for (const j of open) await handle(j.id).catch((e) => console.error(`job #${j.id}: ${e.message}`));
  if (ONCE) return;
  publicClient.watchContractEvent({
    address: sdk.addresses.SurelyVault,
    abi: surelyVaultAbi,
    eventName: "JobCreated",
    onLogs: (logs) =>
      logs.forEach((l) => {
        if (l.args.jobId !== undefined && l.args.agentId !== undefined && byAgentId.has(l.args.agentId))
          handle(l.args.jobId).catch((e) => console.error(`job #${l.args.jobId}: ${e.message}`));
      }),
  });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
