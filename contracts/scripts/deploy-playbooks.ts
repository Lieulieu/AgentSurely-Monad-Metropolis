import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

/**
 * upgrade-07: deploys ONLY the PlaybookRegistry (playbook market) next to the existing contracts.
 * SurelyVault, SubscriptionManager, bonds, rentals and jobs are untouched — no redeploy.
 *
 *   PlaybookRegistry(identity, SubscriptionManager)  → deployments/<network>.json contracts.PlaybookRegistry
 *   then: npm run sync -w @agentsurely/sdk  and  npm run playbooks:publish (catalog playbooks on-chain)
 *
 * Re-running keeps the existing registry unless REDEPLOY_PLAYBOOKS=1.
 */
async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployments/${network.name}.json — deploy the protocol first`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  if (dep.contracts.PlaybookRegistry && process.env.REDEPLOY_PLAYBOOKS !== "1") {
    console.log(`PlaybookRegistry already deployed at ${dep.contracts.PlaybookRegistry} (REDEPLOY_PLAYBOOKS=1 to replace)`);
    return;
  }
  const gate = dep.contracts.SubscriptionManager ?? ethers.ZeroAddress;
  const c = await ethers.deployContract("PlaybookRegistry", [dep.contracts.IdentityRegistry, gate]);
  await c.waitForDeployment();
  dep.contracts.PlaybookRegistry = await c.getAddress();
  dep.playbooksDeployedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
  console.log(`PlaybookRegistry ${dep.contracts.PlaybookRegistry} · identity ${dep.contracts.IdentityRegistry} · renters via ${gate}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
