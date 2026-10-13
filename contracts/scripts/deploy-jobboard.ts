import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

/**
 * upgrade-08: deploys ONLY the JobBoard (jobs by domain: Free 1 job × 3 agents · PRO 5 × 5 · VIP 30 × 30)
 * next to the existing contracts — no redeploy of SurelyVault / SubscriptionManager.
 *
 *   1. JobBoard(SubscriptionManager) → deployments/<network>.json contracts.JobBoard
 *   2. SubscriptionManager.setPlan(VIP, …, rentLimit 900) so a VIP can staff 30 jobs × 30 agents
 *      (price, create and list limits unchanged; needs the SubscriptionManager owner = deployer)
 *   then: npm run sync -w @agentsurely/sdk
 *
 * Re-running keeps the existing board unless REDEPLOY_JOBBOARD=1.
 */
const VIP = 2;
const VIP_RENT_LIMIT = Number(process.env.VIP_RENT_LIMIT ?? 900);

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployments/${network.name}.json — deploy the protocol first`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!dep.contracts.SubscriptionManager) throw new Error("Deployment has no SubscriptionManager");
  const [me] = await ethers.getSigners();

  if (dep.contracts.JobBoard && process.env.REDEPLOY_JOBBOARD !== "1") {
    console.log(`JobBoard already deployed at ${dep.contracts.JobBoard} (REDEPLOY_JOBBOARD=1 to replace)`);
  } else {
    const c = await ethers.deployContract("JobBoard", [dep.contracts.SubscriptionManager]);
    await c.waitForDeployment();
    dep.contracts.JobBoard = await c.getAddress();
    dep.jobBoardDeployedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(dep, null, 2));
    console.log(`JobBoard ${dep.contracts.JobBoard} · plans from ${dep.contracts.SubscriptionManager}`);
  }

  const subs = await ethers.getContractAt("SubscriptionManager", dep.contracts.SubscriptionManager);
  const [price, createLimit, listLimit, rentLimit] = await subs.plans(VIP);
  if (Number(rentLimit) >= VIP_RENT_LIMIT) {
    console.log(`VIP rent limit already ${rentLimit}`);
  } else if ((await subs.owner()).toLowerCase() !== me.address.toLowerCase()) {
    console.warn(`! ${me.address} is not the SubscriptionManager owner — VIP rent limit stays ${rentLimit}`);
  } else {
    await (await subs.setPlan(VIP, price, createLimit, listLimit, VIP_RENT_LIMIT)).wait();
    console.log(`VIP rent limit ${rentLimit} → ${VIP_RENT_LIMIT} (30 jobs × 30 agents)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
