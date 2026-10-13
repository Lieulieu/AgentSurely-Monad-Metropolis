import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_8004, CRE_FORWARDERS } from "./erc8004";
import { resolveUsdc } from "./usdc";

/**
 * Deploys MockUSD, SurelyVault and the ERC-8004 registries it talks to, then
 * writes deployments/<network>.json (read by the SDK, app and CRE workflow).
 *
 * ERC-8004 registries
 *   ERC8004=canonical       use the canonical Identity + Reputation registries for
 *                           this chain (default on monadTestnet), deploy our
 *                           ValidationRegistry (no canonical one exists yet)
 *   ERC8004=mock            deploy mocks for all three (default locally)
 *   IDENTITY_REGISTRY / REPUTATION_REGISTRY / VALIDATION_REGISTRY override each one
 *
 * Forwarder
 *   FORWARDER=simulation | production | 0x… | relayer/empty (→ deployer wallet, npm run judge:monad)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const mode = process.env.ERC8004 ?? (CANONICAL_8004[chainId] ? "canonical" : "mock");
  console.log(`Network ${network.name} (${chainId}) · deployer ${deployer.address} · ERC-8004 ${mode}`);
  const deploy = async (name: string, args: unknown[] = []) => {
    const c = await ethers.deployContract(name, args);
    await c.waitForDeployment();
    return c.getAddress();
  };

  const canonical = mode === "canonical" ? CANONICAL_8004[chainId] : undefined;
  if (mode === "canonical" && !canonical) throw new Error(`No canonical ERC-8004 registries known for chain ${chainId}`);
  for (const addr of canonical ? [canonical.identity, canonical.reputation] : []) {
    if ((await ethers.provider.getCode(addr)) === "0x") throw new Error(`Canonical ERC-8004 registry ${addr} has no code on chain ${chainId} — set ERC8004=mock`);
  }

  const fwdEnv = process.env.FORWARDER || process.env.FORWARDER_ADDRESS || "";
  const known = (CRE_FORWARDERS as Record<string, Record<string, string>>)[network.name];
  const forwarder = (known && known[fwdEnv]) || (fwdEnv.startsWith("0x") ? fwdEnv : deployer.address);
  if (fwdEnv && fwdEnv !== "relayer" && !known?.[fwdEnv] && !fwdEnv.startsWith("0x")) {
    throw new Error(`FORWARDER="${fwdEnv}" not recognised on ${network.name} (use simulation, production, relayer or 0x…)`);
  }

  // upgrade-04: USDC is the money (bonds, fees, coverage, plans, rentals); mUSD is only the reward token.
  const usdc = await resolveUsdc(chainId, deploy);
  const musd = await deploy("MockUSD");
  const identity = process.env.IDENTITY_REGISTRY || canonical?.identity || (await deploy("MockIdentityRegistry"));
  const reputation = process.env.REPUTATION_REGISTRY || canonical?.reputation || (await deploy("MockReputationRegistry", [identity]));
  const validation = process.env.VALIDATION_REGISTRY || canonical?.validation || (await deploy("ValidationRegistry", [identity]));

  const vaultAddr = await deploy("SurelyVault", [usdc, identity, forwarder]);
  const vault = await ethers.getContractAt("SurelyVault", vaultAddr);
  await (await vault.setRegistries(reputation, validation)).wait();

  // mUSD reward: REWARD_PER_PASS (default 10 mUSD) per passed job, from a pool minted into the vault.
  const rewardPerPass = ethers.parseUnits(process.env.REWARD_PER_PASS ?? "10", 6);
  const rewardPool = ethers.parseUnits(process.env.REWARD_POOL ?? "1000000", 6);
  await (await vault.setReward(musd, rewardPerPass)).wait();
  await (await (await ethers.getContractAt("MockUSD", musd)).mint(vaultAddr, rewardPool)).wait();

  // upgrade-02 plans (Free $0 · Pro $5 · VIP $30 / 30 days) + agent rentals ($1 / agent / 30 days,
  // 10% platform fee). Gates every hire: creators test their own agents, everyone else rents.
  const treasury = process.env.TREASURY || deployer.address;
  const subscriptions = await deploy("SubscriptionManager", [usdc, identity, treasury, 1_000_000]); // USDC has 6 decimals
  await (await vault.setHireGate(subscriptions)).wait();
  // upgrade-07: playbook market — creators publish ready-to-run tasks, renters vote them useful.
  const playbooks = await deploy("PlaybookRegistry", [identity, subscriptions]);
  // upgrade-08: jobs by domain (Free 1×3 · PRO 5×5 · VIP 30×30); VIP may rent 30 × 30 = 900 agents.
  const jobBoard = await deploy("JobBoard", [subscriptions]);
  {
    const subs = await ethers.getContractAt("SubscriptionManager", subscriptions);
    const [price, createLimit, listLimit] = await subs.plans(2);
    await (await subs.setPlan(2, price, createLimit, listLimit, 900)).wait();
  }

  const out = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
    erc8004: mode,
    contracts: {
      USDC: usdc,
      MockUSD: musd,
      IdentityRegistry: identity,
      ReputationRegistry: reputation,
      ValidationRegistry: validation,
      SurelyVault: vaultAddr,
      SubscriptionManager: subscriptions,
      PlaybookRegistry: playbooks,
      JobBoard: jobBoard,
    },
    treasury,
    forwarder,
    reward: { token: "mUSD", perPass: process.env.REWARD_PER_PASS ?? "10", pool: process.env.REWARD_POOL ?? "1000000" },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.table(out.contracts);

  console.log(`Forwarder: ${forwarder}${forwarder === deployer.address ? " (deployer — local relayer mode)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
