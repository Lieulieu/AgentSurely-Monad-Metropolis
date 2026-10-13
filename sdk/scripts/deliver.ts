/**
 * One-shot helpers for the CRE demo (no long-running processes):
 *
 *   npm run deliver -- --chain monad [--agent 1] [--lazy] [--out file]
 *       (no --agent: picks your seeded ResearchBot, or TranslateVN with --lazy)
 *       Hires the agent if it has no Open job, delivers its output (opening the
 *       ERC-8004 validation request first) and prints SUBMIT_TX / JOB_ID.
 *       --out writes "TX JOB" to a file for scripts (cmd /c set /p).
 *
 *   npm run deliver -- --chain monad --job 0 status
 *       Prints the job status, verdict and the agent's ERC-8004 record.
 */
import fs from "node:fs";
import { fmtUsd, toUnits } from "../src/format";
import { chat, ensureUsdc, JOB_COVERAGE, JOB_FEE, llm, positional, setup, ts } from "./env";

const GOOD: Record<string, string> = {
  "parallel execution": [
    "- Monad processes many transactions at the same time instead of one by one, like a supermarket opening several checkout lanes — parallel execution.",
    "- Its execution model is optimistic: it assumes most transactions don't touch the same accounts.",
    "- If two transactions conflict, Monad re-runs the affected one with the correct data.",
    "- The final result always matches running everything in order, so apps behave predictably for every reader.",
    "- In summary, this non-technical picture explains why Monad handles far more activity at low cost.",
  ].join("\n"),
};
/** SurelyVault stores at most 4096 bytes (UTF-8) of output. */
function fitBytes(text: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= max) return text;
  let out = text;
  while (enc.encode(out).length > max) out = out.slice(0, Math.floor(out.length * 0.95));
  return out;
}

const LAZY_OUTPUT = "Sorry, I am not sure. Lorem ipsum dolor sit amet.";

async function produce(spec: string, lazy: boolean): Promise<string> {
  if (lazy) return LAZY_OUTPUT;
  if (llm) {
    const r = (await chat([
      { role: "system", content: "You are a precise, factual assistant doing paid work. Follow every constraint in the task exactly. Keep the answer under 250 words." },
      { role: "user", content: spec },
    ])) as { choices: { message: { content: string } }[] };
    return fitBytes(r.choices[0].message.content.trim(), 3800);
  }
  const canned = Object.entries(GOOD).find(([k]) => spec.toLowerCase().includes(k));
  if (canned) return canned[1];
  const terms = Array.from(new Set(spec.toLowerCase().match(/[a-zà-ỹ0-9']{4,}/gi) ?? [])).slice(0, 10);
  return [`Answer: ${spec}`, ...terms.map((t, i) => `${i + 1}. ${t} — addressed with a concrete explanation.`)].join("\n");
}

async function status(jobId: bigint) {
  const { sdk, chain } = setup("AGENT_PRIVATE_KEY");
  const j = await sdk.getJob(jobId);
  const a = await sdk.getAgent(j.agentId);
  const e = await sdk.getErc8004Summary(j.agentId);
  console.log(`\nJob #${jobId} on ${chain.name}: ${j.status}  score ${j.score}/${j.minScore}`);
  if (j.verdictReason) console.log(`  verdict   ${j.verdictReason}`);
  console.log(`  agent #${j.agentId} "${a.profile.name}"  bond ${fmtUsd(a.bond.total)} USDC · slashed ${fmtUsd(a.stats.slashed)} · rewards ${fmtUsd(a.rewardsEarned)} mUSD · passed ${a.stats.passed} / failed ${a.stats.failed}`);
  console.log(`  ERC-8004  feedback ${e.feedbackCount} (avg ${Math.round(e.averageScore)}) · validations ${e.validations} (avg ${e.averageValidation})`);
  if (j.status === "Submitted") process.exitCode = 2;
}

type HireArgs = Parameters<ReturnType<typeof setup>["sdk"]["hire"]>[0];

/** USDC for fee (+ rent) — checked up front so a short balance is a clear message, not 0xe450d38c. */
async function topUp(sdk: ReturnType<typeof setup>["sdk"], who: `0x${string}`, need: bigint) {
  await ensureUsdc(sdk, who, need, "the job fee / rent");
}

/**
 * Preferred path: a separate client wallet (CLIENT_PRIVATE_KEY) rents the agent ($1 / 30 days,
 * upgrade-02) and hires it. Returns undefined — and the agent owner hires instead — when there is no
 * client key, the client has no MON for gas, or the agent is not listed for rent.
 */
async function hireAsClient(p: HireArgs): Promise<bigint | undefined> {
  if (!process.env.CLIENT_PRIVATE_KEY) return undefined;
  const { sdk, account, publicClient } = setup("CLIENT_PRIVATE_KEY");
  const me = account.address;
  if ((await publicClient.getBalance({ address: me })) === 0n) {
    console.log(`[${ts()}] client ${me} has no MON for gas — the agent owner hires instead (fund it at faucet.monad.xyz)`);
    return undefined;
  }
  if (!(await sdk.canHire(me, p.agentId))) {
    if (!(await sdk.forRent(p.agentId))) {
      console.log(`[${ts()}] agent #${p.agentId} is not listed for rent — the agent owner hires instead`);
      return undefined;
    }
    await topUp(sdk, me, p.fee + toUnits(1));
    const sub = await sdk.getSubscription(me);
    if (sub.rentals.length >= sub.limits.rent) await sdk.cancelRental(sub.rentals[0].agentId);
    await sdk.rent(p.agentId, 1);
    console.log(`[${ts()}] client ${me} rented agent #${p.agentId} · 1 USDC / 30 days`);
  }
  await topUp(sdk, me, p.fee);
  console.log(`[${ts()}] client ${me} hires agent #${p.agentId}`);
  return sdk.hire(p);
}

/** Fallback: the agent's owner (creator) hires its own agent — always allowed by the hire gate. */
async function hireAsOwner(sdk: ReturnType<typeof setup>["sdk"], owner: `0x${string}`, p: HireArgs) {
  await topUp(sdk, owner, p.fee);
  return sdk.hire(p);
}

async function deliver() {
  const { sdk, chain, account } = setup("AGENT_PRIVATE_KEY");
  const lazy = process.env.AGENT_MODE === "lazy";
  let agentId: bigint;
  if (process.env.AGENT_ID) agentId = BigInt(process.env.AGENT_ID);
  else {
    // Pick one of this key's bonded agents: ResearchBot for good work, TranslateVN for the lazy/slash demo.
    const mine = (await sdk.listAgents()).filter((a) => a.owner.toLowerCase() === account.address.toLowerCase() && a.bond.available >= JOB_COVERAGE);
    if (!mine.length) throw new Error(`No bonded agent owned by ${account.address} with ≥0.25 USDC free bond — run npm run seed:monad or catalog:register`);
    const want = lazy ? "TranslateVN" : "ResearchBot";
    agentId = (mine.find((a) => a.profile.name === want) ?? (lazy ? mine[mine.length - 1] : mine[0])).id;
  }
  const agent = await sdk.getAgent(agentId);
  if (agent.owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Key ${account.address} does not own agent #${agentId} (owner ${agent.owner})`);
  }
  let job = (await sdk.listJobs({ agentId })).find((j) => j.status === "Open");
  if (!job) {
    const spec = positional.join(" ").trim() || "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.";
    const fee = JOB_FEE;
    const params = { agentId, spec, fee, coverage: JOB_COVERAGE, deadline: Math.floor(Date.now() / 1000) + 6 * 3600, minScore: 70 };
    const id = (await hireAsClient(params)) ?? (await hireAsOwner(sdk, account.address, params));
    console.log(`[${ts()}] hired agent #${agentId} → job #${id}`);
    job = await sdk.getJob(id);
  }
  const output = await produce(job.spec!, lazy);
  console.log(`[${ts()}] job #${job.id}: delivering ${output.length} chars (${lazy ? "lazy" : llm ? llm.model : "offline"}) on ${chain.name}`);
  const tx = await sdk.submitResult(job.id, output);
  console.log(`SUBMIT_TX=${tx}`);
  console.log(`JOB_ID=${job.id}`);
  if (process.env.OUT_FILE) fs.writeFileSync(process.env.OUT_FILE, `${tx} ${job.id}\n`);
}

(positional[0] === "status" ? status(BigInt(process.env.JOB_ID ?? "0")) : deliver()).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
