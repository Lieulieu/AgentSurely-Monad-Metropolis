/**
 * upgrade-07: publishes the catalog's starter playbooks (catalog/playbooks.json) to the PlaybookRegistry
 * for every catalog agent the operator wallet owns — so the market opens with 60 playbooks and renters
 * can vote them "useful". Idempotent: playbooks with the same title already on-chain are skipped, so the
 * script can be re-run after editing playbooks.json (new titles are added; use the app to edit existing ones).
 *
 *   npm run playbooks:publish                    # local Hardhat
 *   npm run playbooks:publish -- --chain monad
 */
import { identityRegistryAbi } from "../src/generated/abis";
import { catalog, catalogDeployments, playbooks } from "../src/generated/catalog";
import { setup, ts } from "./env";

async function main() {
  const { sdk, chain, account, publicClient } = setup("PRIVATE_KEY");
  if (!sdk.hasPlaybookMarket) throw new Error("No PlaybookRegistry in this deployment — run `npm run playbooks:monad` (or deploy:local) first");
  const ids = catalogDeployments[chain.id] ?? {};
  console.log(`${ts()} Playbooks publish · ${chain.name} · registry ${sdk.addresses.PlaybookRegistry} · operator ${account.address}`);
  let added = 0;
  let skipped = 0;
  for (const a of catalog) {
    const books = playbooks.agents[a.id] ?? [];
    const agentNum = ids[a.id];
    if (!agentNum || books.length === 0) continue;
    const agentId = BigInt(agentNum);
    const owner = await publicClient.readContract({ address: sdk.addresses.IdentityRegistry, abi: identityRegistryAbi, functionName: "ownerOf", args: [agentId] });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      console.log(`  - ${a.name} #${agentId}: owned by ${owner}, skipped`);
      continue;
    }
    const existing = new Set((await sdk.getPlaybooks(agentId, { includeInactive: true })).map((p) => p.title.toLowerCase()));
    for (const p of books) {
      if (existing.has(p.title.toLowerCase())) {
        skipped++;
        continue;
      }
      const index = await sdk.publishPlaybook(agentId, p);
      added++;
      console.log(`  + ${a.name} #${agentId} [${index}] ${p.title}`);
    }
  }
  console.log(`${ts()} Done: ${added} published, ${skipped} already on-chain.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
