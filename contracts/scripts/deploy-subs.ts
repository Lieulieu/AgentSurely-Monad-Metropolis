import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

/**
 * Redeploys ONLY the SubscriptionManager (plans + rentals, paid in the vault's bond token — USDC)
 * next to the existing SurelyVault — bonds, jobs and ERC-8004 identities are kept.
 *
 *   1. deploy SubscriptionManager(bondToken, identity, treasury, 1e6)
 *   2. SurelyVault.setHireGate(new manager)
 *   3. re-list every bonded agent the deployer owns that was listed in the old manager
 *      (catalog + demo agents), so they stay rentable
 *   4. update deployments/<network>.json (then `npm run sync -w @agentsurely/sdk`)
 *
 * Plans and rentals bought on the old manager are NOT migrated (testnet).
 */
async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [me] = await ethers.getSigners();
  const deploy = async (name: string, args: unknown[] = []) => {
    const c = await ethers.deployContract(name, args);
    await c.waitForDeployment();
    return c.getAddress();
  };
  const vault = await ethers.getContractAt("SurelyVault", dep.contracts.SurelyVault);
  if ((await vault.owner()).toLowerCase() !== me.address.toLowerCase()) throw new Error(`${me.address} is not the vault owner`);

  const treasury = dep.treasury ?? me.address;
  // Plans and rentals are paid in the vault's bond token (USDC since upgrade-04).
  const payToken = await vault.bondToken();
  const subsAddr = await deploy("SubscriptionManager", [payToken, dep.contracts.IdentityRegistry, treasury, 1_000_000]);
  const subs = await ethers.getContractAt("SubscriptionManager", subsAddr);
  console.log(`SubscriptionManager ${subsAddr} · paid in ${payToken}`);

  // Re-list the deployer's agents that were listed before.
  const old = dep.contracts.SubscriptionManager ? await ethers.getContractAt("SubscriptionManager", dep.contracts.SubscriptionManager) : undefined;
  const identity = new ethers.Contract(dep.contracts.IdentityRegistry, ["function ownerOf(uint256) view returns (address)"], me);
  const relist: bigint[] = [];
  for (const id of await vault.bondedAgents()) {
    const owner = String(await identity.ownerOf(id)).toLowerCase();
    if (owner !== me.address.toLowerCase()) continue;
    const wasListed = old ? await old.listed(id).catch(() => false) : true;
    if (wasListed) relist.push(id);
  }
  for (let i = 0; i < relist.length; i += 25) {
    await (await subs.publishAgents(relist.slice(i, i + 25))).wait();
  }
  console.log(`Re-listed ${relist.length} agents for rent`);

  await (await vault.setHireGate(subsAddr)).wait();
  console.log(`SurelyVault.hireGate → ${subsAddr}`);

  dep.contracts.SubscriptionManager = subsAddr;
  dep.subscriptionsDeployedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
