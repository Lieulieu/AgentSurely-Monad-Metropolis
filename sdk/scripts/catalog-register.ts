/**
 * Registers the AgentSurely catalog (catalog/index.json) onchain:
 *   1. ERC-8004 identity per catalog agent (URI carries name, skills and source attribution)
 *   2. bond per tier in USDC (basic 0.5 · pro 1 · vip 1.5 → 19.5 USDC for all 20 — one Circle faucet drip)
 *   3. SubscriptionManager.publishAgents — register + list every catalog agent for rent
 *      ($1 / agent / 30 days). The operator must be `unlimited` (the deployer is by default).
 * Idempotent: agents already in contracts/deployments/catalog/<network>.json are skipped.
 *
 *   npm run catalog:register                 # local Hardhat
 *   npm run catalog:register -- --chain monad
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { subscriptionManagerAbi, surelyVaultAbi } from "../src/generated/abis";
import { catalog } from "../src/generated/catalog";
import { catalogAgentUri } from "../src/catalog-core";
import { toUnits } from "../src/format";
import { ensureUsdc, setup, ts } from "./env";

const BOND = { basic: 0.5, pro: 1, vip: 1.5 } as const;

async function main() {
  const { sdk, chain, account, publicClient, walletClient } = setup("PRIVATE_KEY");
  const network = chain.id === 31337 ? "localhost" : "monadTestnet";
  const dir = path.resolve(__dirname, "..", "..", "contracts", "deployments", "catalog");
  const file = path.join(dir, `${network}.json`);
  fs.mkdirSync(dir, { recursive: true });
  let state: { chainId: number; identityRegistry?: string; agents: Record<string, number> } = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { chainId: chain.id, agents: {} };
  const identity = sdk.addresses.IdentityRegistry.toLowerCase();
  if (state.identityRegistry && state.identityRegistry.toLowerCase() !== identity) {
    console.log(`Identity registry changed (${state.identityRegistry} → ${identity}): registering the catalog again`);
    state = { chainId: chain.id, agents: {} };
  }
  state.identityRegistry = sdk.addresses.IdentityRegistry;
  const subs = sdk.addresses.SubscriptionManager;
  if (!subs) throw new Error("Deployment has no SubscriptionManager — redeploy with the upgrade-01 contracts");
  console.log(`Catalog register · ${chain.name} · ${catalog.length} agents · operator ${account.address}`);

  // Bonds are USDC. On Monad testnet USDC comes from Circle's faucet (20 USDC / 2h), so bond agent by agent and
  // stop cleanly when the wallet runs dry — re-run after the next faucet drip to continue where it stopped.
  let short: { need: number; agents: number } | undefined;
  const afford = async (amount: number) => {
    if (short) return false;
    if (process.env.CHAIN !== "monad") await ensureUsdc(sdk, account.address, toUnits(amount));
    if ((await sdk.tokenBalance(account.address)) >= toUnits(amount)) return true;
    return false;
  };
  const isBonded = (id: number) =>
    publicClient.readContract({ address: sdk.addresses.SurelyVault, abi: surelyVaultAbi, functionName: "isBonded", args: [BigInt(id)] });

  for (const a of catalog) {
    const known = state.agents[a.id];
    if (known && (await isBonded(known))) continue;
    if (!(await afford(BOND[a.tier]))) {
      short = short ?? { need: 0, agents: 0 };
      short.need += BOND[a.tier];
      short.agents++;
      continue;
    }
    // Identities survive a vault redeploy: only re-bond agents the current vault doesn't know yet.
    const agentId = known ? BigInt(known) : await sdk.registerAgent(catalogAgentUri(a));
    await sdk.depositBond(agentId, toUnits(BOND[a.tier]));
    if (!known) {
      state.agents[a.id] = Number(agentId);
      fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
    }
    console.log(`[${ts()}] #${agentId} ${a.tier.padEnd(5)} ${a.name} — ${known ? "re-" : ""}bonded ${BOND[a.tier]} USDC`);
  }

  const ids: bigint[] = [];
  for (const a of catalog) if (state.agents[a.id] && (await isBonded(state.agents[a.id]))) ids.push(BigInt(state.agents[a.id]));
  const unlimited = await publicClient.readContract({ address: subs, abi: subscriptionManagerAbi, functionName: "unlimited", args: [account.address] });
  if (!unlimited) throw new Error(`Operator ${account.address} is not unlimited — owner must call SubscriptionManager.setUnlimited(operator, true)`);
  const flags = await Promise.all(ids.map((id) => publicClient.readContract({ address: subs, abi: subscriptionManagerAbi, functionName: "listed", args: [id] })));
  const todo = ids.filter((_, i) => !flags[i]);
  if (todo.length) {
    const hash = await walletClient.writeContract({ address: subs, abi: subscriptionManagerAbi, functionName: "publishAgents", args: [todo], chain, account });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log(`[${ts()}] ${ids.length} catalog agents listed for rent (1 USDC / 30 days) → ${path.relative(process.cwd(), file)}`);
  execSync("npx tsx scripts/sync.ts", { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  if (short) {
    throw new Error(
      `Not enough USDC: ${short.agents} catalog agents still need ${short.need} USDC of bond. Get testnet USDC at ` +
        `https://faucet.circle.com (Monad Testnet, 20 USDC / 2h) for ${account.address}, then run catalog:register again.`
    );
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
