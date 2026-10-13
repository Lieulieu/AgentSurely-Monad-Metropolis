/**
 * Client walkthrough for upgrade-02 plans + rentals (for demos and the e2e test):
 *   Free → rent 3 catalog agents ($1 each) → 4th rental blocked → hire one →
 *   subscribe Pro ($5, rent up to 50) → rent the 4th → hire it.
 * Waits for each verdict (needs catalog:run + a judge running).
 *
 *   npm run catalog:demo                     # local (client = Hardhat account #1)
 *   npm run catalog:demo -- --chain monad    # CLIENT_PRIVATE_KEY or PRIVATE_KEY
 */
import { fmtUsd, toUnits } from "../src/format";
import { ensureUsdc, JOB_COVERAGE, JOB_FEE, setup, ts } from "./env";

if (!process.env.CLIENT_PRIVATE_KEY && process.env.CHAIN !== "monad") {
  process.env.CLIENT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Hardhat #1
}
const { sdk, account } = setup("CLIENT_PRIVATE_KEY");

async function waitVerdict(jobId: bigint) {
  for (let i = 0; i < 180; i++) {
    const j = await sdk.getJob(jobId);
    if (j.status !== "Open" && j.status !== "Submitted") return j;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`job #${jobId}: no verdict yet (is catalog:run and a judge running?)`);
}

async function hire(agentId: bigint, spec: string) {
  const id = await sdk.hire({ agentId, spec, fee: JOB_FEE, coverage: JOB_COVERAGE, deadline: Math.floor(Date.now() / 1000) + 6 * 3600, minScore: 70 });
  console.log(`[${ts()}]   hired #${agentId} → job #${id}, waiting for verdict…`);
  const j = await waitVerdict(id);
  console.log(`[${ts()}]   job #${id}: ${j.status} · ${j.verdictReason}`);
  return j;
}

async function main() {
  const me = account.address;
  await ensureUsdc(sdk, me, toUnits(9), "3 rentals + PRO + 2 job fees"); // 3 + 5 + 0.2 USDC
  const cat = sdk.catalog().filter((a) => a.agentId !== undefined);
  let sub = await sdk.getSubscription(me);
  console.log(`Client ${me} · plan ${sub.plan} · rentals ${sub.rentals.length}/${sub.limits.rent} · ${fmtUsd(await sdk.tokenBalance(me))} USDC`);

  const polyglot = cat.find((a) => a.id === "polyglot-router") ?? cat[0];
  const picks = [polyglot, ...cat.filter((a) => a !== polyglot)].slice(0, 4);
  for (const a of picks.slice(0, 3)) {
    if (!sub.rentals.some((r) => r.agentId === a.agentId)) await sdk.rent(a.agentId!, 1);
    console.log(`[${ts()}] rented ${a.name} (#${a.agentId}) · 1 USDC / 30 days`);
  }
  sub = await sdk.getSubscription(me);
  const fourth = picks[3];
  if (fourth && sub.plan === "Free" && sub.rentals.length >= sub.limits.rent)
    console.log(`[${ts()}] Free plan: ${sub.rentals.length}/${sub.limits.rent} rentals → renting ${fourth.name} is blocked (as expected)`);

  await hire(polyglot.agentId!, "Réponds en français : explique en trois phrases ce qu'est une caution de performance pour un agent IA.");

  console.log(`[${ts()}] Subscribing to Pro ($5 / 30 days · rent up to 50 agents)…`);
  await sdk.subscribe("Pro", 1);
  sub = await sdk.getSubscription(me);
  console.log(`[${ts()}] plan ${sub.plan} until ${new Date(sub.expiresAt * 1000).toISOString().slice(0, 10)} · rent limit ${sub.limits.rent}`);
  const recruiter = cat.find((a) => a.id === "startup-recruiter") ?? fourth;
  if (!(await sdk.canHire(me, recruiter.agentId!))) await sdk.rent(recruiter.agentId!, 1);
  await hire(recruiter.agentId!, "Write a job description for a senior Solidity engineer at a 10-person DeFi startup: 5 responsibilities, 5 requirements, and 3 interview questions.");
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
