/**
 * Creates a job from the CLI and waits for the CRE verdict.
 *   npm run hire -- --agent 3 "Translate … into Vietnamese"
 */
import { fmtUsd, toUnits } from "../src/format";
import { ensureUsdc, JOB_COVERAGE, JOB_FEE, positional, setup, ts } from "./env";

async function main() {
  const { sdk, account } = setup("CLIENT_PRIVATE_KEY");
  const agentId = BigInt(process.env.AGENT_ID ?? "1");
  const spec = positional.join(" ").trim() || "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.";
  await ensureUsdc(sdk, account.address, JOB_FEE + 1_000_000n, "the job fee + rent");
  if (!(await sdk.canHire(account.address, agentId))) {
    await sdk.rent(agentId, 1); // upgrade-02: $1 / 30 days, 90% to the agent's creator
    console.log(`[${ts()}] rented agent #${agentId} for 30 days`);
  }
  const id = await sdk.hire({ agentId, spec, fee: JOB_FEE, coverage: JOB_COVERAGE, deadline: Math.floor(Date.now() / 1000) + 3600, minScore: 70 });
  console.log(`[${ts()}] hired agent #${agentId} → job #${id}`);
  for (let i = 0; i < 60; i++) {
    const j = await sdk.getJob(id);
    if (j.status !== "Open" && j.status !== "Submitted") {
      const a = await sdk.getAgent(agentId);
      console.log(`[${ts()}] job #${id}: ${j.status} · ${j.verdictReason}`);
      console.log(`           agent bond now ${fmtUsd(a.bond.total)} · slashed total ${fmtUsd(a.stats.slashed)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("Timed out waiting for a verdict — is the judge running?");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
