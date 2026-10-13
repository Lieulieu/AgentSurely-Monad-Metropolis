import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { IDENTITY_MIN_ABI } from "./erc8004";

/**
 * Registers three demo agents, posts bonds and opens one job — for the demo video.
 * Works with the mock and the canonical ERC-8004 Identity Registry (reads agentId
 * from the Registered event). SEED_AGENTS_ONLY=1 skips the demo job.
 */
async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const [me] = await ethers.getSigners();
  // upgrade-04: bonds and fees are USDC. Locally USDC is a MockStable we can mint; on Monad testnet it is
  // Circle's USDC — get it at https://faucet.circle.com (Monad Testnet, 20 USDC / 2h).
  const usd = await ethers.getContractAt("MockStable", dep.contracts.USDC);
  const reg = new ethers.Contract(dep.contracts.IdentityRegistry, IDENTITY_MIN_ABI, me);
  const vault = await ethers.getContractAt("SurelyVault", dep.contracts.SurelyVault);
  const U = (n: number) => ethers.parseUnits(String(n), 6);

  const need = U(3.5); // 3 × 1 USDC bonds + demo job fee/coverage headroom
  if (network.name === "localhost" || network.name === "hardhat") await (await usd.mint(me.address, U(1_000))).wait();
  const bal = await usd.balanceOf(me.address);
  if (bal < need) throw new Error(`Seed needs ${ethers.formatUnits(need, 6)} USDC on ${me.address}, has ${ethers.formatUnits(bal, 6)} — get testnet USDC at https://faucet.circle.com (Monad Testnet)`);
  await (await usd.approve(dep.contracts.SurelyVault, ethers.MaxUint256)).wait();

  const agents = [
    { name: "ResearchBot", skills: ["research", "summary"], bond: 1 },
    { name: "SolAuditor", skills: ["solidity-review"], bond: 1 },
    { name: "TranslateVN", skills: ["translation", "vi-en"], bond: 1 },
  ];
  const ids: bigint[] = [];
  for (const a of agents) {
    const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: a.name, description: `AgentSurely demo agent (${a.skills.join(", ")})`, skills: a.skills }))}`;
    const receipt = await (await reg.register(uri)).wait();
    const ev = receipt!.logs.map((l: { topics: string[]; data: string }) => { try { return reg.interface.parseLog(l); } catch { return null; } }).find((e: { name?: string } | null) => e?.name === "Registered");
    const id = ev!.args.agentId as bigint;
    ids.push(id);
    await (await vault.depositBond(id, U(a.bond))).wait();
    console.log(`Agent #${id} ${a.name} bonded ${a.bond} USDC`);
  }

  // upgrade-02: list the demo agents for rent ($1 / 30 days) so other wallets can rent and hire them.
  if (dep.contracts.SubscriptionManager) {
    const subs = await ethers.getContractAt("SubscriptionManager", dep.contracts.SubscriptionManager);
    await (await subs.publishAgents(ids)).wait();
    console.log(`Listed ${ids.length} demo agents for rent`);
  }

  if (process.env.SEED_AGENTS_ONLY !== "1") {
    const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
    await (await vault.createJob(ids[0], "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.", U(0.1), U(0.25), deadline, 70)).wait();
    console.log(`Opened job #${(await vault.jobCount()) - 1n} for agent #${ids[0]}`);
  }
  console.log(`\nDemo agents: ${ids.map(String).join(", ")}  →  npm run agent:demo -- --agent ${ids[0]}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
