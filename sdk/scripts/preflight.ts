/**
 * Checks everything needed before/after deploying to Monad testnet.
 *   npm run preflight:monad
 */
import { formatEther } from "viem";
import { surelyVaultAbi } from "../src/generated/abis";
import { deployments } from "../src/generated/deployments";
import { monadTestnet, localhost } from "../src/chains";
import { llm, setup } from "./env";

const ok = (m: string) => console.log(`  ✔ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const bad = (m: string) => {
  console.log(`  ✖ ${m}`);
  process.exitCode = 1;
};

async function main() {
  const { chain, account, publicClient } = setup("JUDGE_PRIVATE_KEY");
  console.log(`\nAgentSurely preflight · ${chain.name} (${chain.id})\n`);

  try {
    const id = await publicClient.getChainId();
    id === chain.id ? ok(`RPC reachable, chainId ${id}`) : bad(`RPC returned chainId ${id}, expected ${chain.id}`);
  } catch (e) {
    bad(`RPC unreachable: ${(e as Error).message.split("\n")[0]}`);
    return;
  }

  const bal = await publicClient.getBalance({ address: account.address });
  const mon = Number(formatEther(bal));
  if (mon >= 0.5) ok(`Key ${account.address} has ${mon.toFixed(3)} MON`);
  else if (mon > 0) warn(`Key ${account.address} has only ${mon.toFixed(3)} MON — top up at https://faucet.monad.xyz`);
  else bad(`Key ${account.address} has 0 MON — fund it at https://faucet.monad.xyz`);

  const dep = deployments[chain.id];
  if (!dep) {
    warn(`Not deployed on ${chain.name} yet → npm run deploy:${chain.id === monadTestnet.id ? "monad" : "local"}`);
  } else {
    const code = await publicClient.getCode({ address: dep.SurelyVault });
    code && code !== "0x" ? ok(`SurelyVault at ${dep.SurelyVault}`) : bad(`No code at SurelyVault ${dep.SurelyVault} — redeploy + sync`);
    const fwd = await publicClient.readContract({ address: dep.SurelyVault, abi: surelyVaultAbi, functionName: "forwarder" });
    if (fwd.toLowerCase() === account.address.toLowerCase())
      warn(`Forwarder is this key (relayer mode → npm run judge:monad). For CRE --broadcast: FORWARDER=simulation in contracts/.env, then npm run forwarder:monad`);
    else if (fwd.toLowerCase() === "0xb9f79d863261869b234c481d1f9a7af84aead192") ok(`Forwarder = CRE MockKeystoneForwarder (simulate --broadcast)`);
    else if (fwd.toLowerCase() === "0xf8344cfd5c43616a4366c34e3eee75af79a74482") ok(`Forwarder = CRE KeystoneForwarder (deployed workflow)`);
    else ok(`Forwarder ${fwd}`);
    const read = (functionName: string, args: unknown[] = []) =>
      publicClient.readContract({ address: dep.SurelyVault, abi: surelyVaultAbi, functionName, args } as never) as Promise<unknown>;
    const [jobs, pending, bonded, rep, val] = await Promise.all([
      read("jobCount"), read("pendingCount"), read("bondedAgents"), read("reputationRegistry"), read("validationRegistry"),
    ]);
    ok(`${jobs} job(s) onchain · ${pending} awaiting verdict · ${(bonded as unknown[]).length} bonded agent(s)`);
    const zero = "0x0000000000000000000000000000000000000000";
    for (const [name, addr] of [["ERC-8004 Reputation", rep], ["ERC-8004 Validation", val]] as const) {
      const a = addr as `0x${string}`;
      if (a === zero) warn(`${name} registry not set (verdicts not published)`);
      else {
        const c = await publicClient.getCode({ address: a });
        c && c !== "0x" ? ok(`${name} registry ${a}`) : bad(`${name} registry ${a} has no code`);
      }
    }
    const identityCode = await publicClient.getCode({ address: dep.IdentityRegistry });
    identityCode && identityCode !== "0x" ? ok(`ERC-8004 Identity registry ${dep.IdentityRegistry}`) : bad(`No code at IdentityRegistry ${dep.IdentityRegistry}`);
    if (chain.id !== localhost.id) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      for (const f of ["config.staging.json", "config.production.json"]) {
        const file = path.resolve(__dirname, "..", "..", "cre", "surely-judge", f);
        if (!fs.existsSync(file)) continue;
        const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
        cfg.vaultAddress?.toLowerCase() === dep.SurelyVault.toLowerCase()
          ? ok(`cre/surely-judge/${f} → vaultAddress matches`)
          : bad(`cre/surely-judge/${f} vaultAddress ${cfg.vaultAddress} ≠ ${dep.SurelyVault} (run npm run sync -w @agentsurely/sdk)`);
      }
    }
  }

  llm ? ok(`LLM judge configured: ${llm.model} @ ${new URL(llm.url).host}`) : warn("No LLM_API_KEY — judge/agent scripts will use the mock judge");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
