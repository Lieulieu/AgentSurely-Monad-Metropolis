/**
 * One-shot catalog job for CRE runs (no long-running processes):
 *   client side  → make sure the agent is rented ($1 / 30 days; frees the oldest rental if the plan is full), hire it
 *   operator side → run the agent's ported steps with the LLM, submitResult
 * Prints SUBMIT_TX / JOB_ID and writes "tx jobId" to --out for `cre workflow simulate --evm-tx-hash`.
 *
 *   npm run catalog:job -- --chain monad --catalog research-report-writer --out logs\last-submit.txt "Your task…"
 */
import fs from "node:fs";
import { runCatalogAgent, type ChatMessage } from "../src/catalog-core";
import { chat, ensureUsdc, JOB_COVERAGE, JOB_FEE, llm, positional, setup, ts } from "./env";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const catalogId = flag("catalog") ?? "research-report-writer";
const SPECS: Record<string, string> = {
  "research-report-writer": "Write a short research brief on why AI agents need performance bonds: 3 sections (problem, how bonds work, risks) and 3 follow-up questions.",
  "polyglot-router": "Réponds en français : explique en trois phrases ce qu'est une caution de performance pour un agent IA.",
};

async function main() {
  const { sdk, account, chain } = setup("PRIVATE_KEY");
  const agent = sdk.catalog().find((a) => a.id === catalogId);
  if (!agent || agent.agentId === undefined) throw new Error(`Catalog agent ${catalogId} is not registered on ${chain.name} — run npm run catalog:register`);
  const me = account.address;
  const words = positional.filter((p) => !p.startsWith("--") && p !== catalogId);
  const spec = words.join(" ").trim() || SPECS[catalogId] || `Complete a representative task for: ${agent.description}`;

  // ── client: rental ──
  // Fee (+ rent) are USDC. Check before sending so a short balance is a clear message, not 0xe450d38c.
  const sub = await sdk.getSubscription(me);
  if (!(await sdk.canHire(me, agent.agentId))) {
    await ensureUsdc(sdk, me, JOB_FEE + 1_000_000n, "renting (1 USDC) + the job fee");
    if (sub.rentals.length >= sub.limits.rent) await sdk.cancelRental(sub.rentals[0].agentId);
    await sdk.rent(agent.agentId, 1);
    console.log(`[${ts()}] rented ${agent.name} (#${agent.agentId}) for 30 days`);
  }
  await ensureUsdc(sdk, me, JOB_FEE, "the job fee");
  const jobId = await sdk.hire({ agentId: agent.agentId, spec, fee: JOB_FEE, coverage: JOB_COVERAGE, deadline: Math.floor(Date.now() / 1000) + 6 * 3600, minScore: 70 });
  console.log(`[${ts()}] hired ${agent.name} → job #${jobId} (plan ${sub.plan})`);

  // ── operator: run the ported agent ──
  if (!llm) throw new Error("No LLM key (LLM_API_KEY_VAR in cre\\.env) — catalog jobs need a real model");
  const ask = async (m: ChatMessage[]) => ((await chat(m, { temperature: 0.2 })) as { choices: { message: { content: string } }[] }).choices[0].message.content;
  const output = await runCatalogAgent(agent, spec, ask, (name, out) => console.log(`[${ts()}]   step ${name}: ${out.length} chars`));
  const tx = await sdk.submitResult(jobId, output);
  console.log(`SUBMIT_TX=${tx}`);
  console.log(`JOB_ID=${jobId}`);
  const out = flag("out");
  if (out) fs.writeFileSync(out, `${tx} ${jobId}\n`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
