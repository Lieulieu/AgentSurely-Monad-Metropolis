import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { CRE_FORWARDERS } from "./erc8004";

/**
 * Points SurelyVault.onReport at a new forwarder.
 *   FORWARDER=simulation npm run forwarder:monad -w @agentsurely/contracts   # cre simulate --broadcast
 *   FORWARDER=production npm run forwarder:monad -w @agentsurely/contracts   # deployed workflow
 *   FORWARDER=relayer    your deployer wallet (npm run judge:monad)
 *   FORWARDER=0x…        any address
 * Put FORWARDER=… in contracts/.env (Windows) or prefix the command (bash).
 */
async function main() {
  const want = process.env.FORWARDER || process.env.FORWARDER_ADDRESS;
  if (!want) throw new Error("Set FORWARDER=simulation|production|relayer|0x… in contracts/.env");
  const [me] = await ethers.getSigners();
  const known = (CRE_FORWARDERS as Record<string, Record<string, string>>)[network.name];
  const fwd = want === "relayer" ? me.address : (known && known[want]) || want;
  if (!ethers.isAddress(fwd)) throw new Error(`Unknown forwarder "${want}" for ${network.name}`);
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const vault = await ethers.getContractAt("SurelyVault", dep.contracts.SurelyVault);
  await (await vault.setForwarder(fwd)).wait();
  dep.forwarder = fwd;
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
  console.log(`SurelyVault ${dep.contracts.SurelyVault} forwarder → ${fwd}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
