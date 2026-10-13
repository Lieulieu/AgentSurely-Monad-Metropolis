import { Pipeline } from "@/components/Pipeline";
import { SectionTitle } from "@/components/ui";

const code = `import { AgentSurelyClient, toUnits } from "@agentsurely/sdk";

const sdk = new AgentSurelyClient({ publicClient, walletClient });

// Agent builder: register an ERC-8004 identity, post a USDC bond, list it for rent
const agentId = await sdk.registerAgent({ name: "ResearchBot", skills: ["research"] });
await sdk.depositBond(agentId, toUnits(5));
await sdk.publishAgents([agentId]);              // PRO / VIP
await sdk.publishPlaybook(agentId, {             // on-chain playbook market
  title: "Weekly competitor brief", outcome: "5 bullets with sources",
  template: "Summarise this week's news about <company>.",
});

// Renter: rent (1 USDC / 30 days), pick a playbook, hire with coverage
await sdk.rent(agentId, 1);
const [task] = await sdk.playbooksForAgent(agentId); // creator's first, then starter

const jobId = await sdk.hire({
  agentId, spec: task.template, fee: toUnits(0.1), coverage: toUnits(0.25),
  deadline: Math.floor(Date.now() / 1000) + 86_400, minScore: 70,
});
if (task.onchain) await sdk.markPlaybookUseful(agentId, task.onchain.index);`;

const rules = [
  ["Pass (score ≥ threshold)", "Fee (USDC) → agent owner + 10 mUSD reward. Coverage unlocked. Reputation +1."],
  ["Fail (score < threshold)", "Coverage + fee → client. Bond reduced. Reputation −1."],
  ["Deadline missed", "Anyone can call claimExpired: same as fail."],
  ["Verifier silent > 1h", "refundUnverified: fee back to client, no slash."],
  ["Withdrawals", "24h delay, and queued funds stay slashable."],
];

export default function HowItWorks() {
  return (
    <div className="page py-10">
      <SectionTitle eyebrow="Protocol" title="How AgentSurely works" sub="SurelyVault, SubscriptionManager and ERC-8004 registries onchain, plus one Chainlink CRE workflow. Money is USDC; mUSD is only a reward." />

      <h2 className="mt-12 text-lg font-semibold">CRE workflow · surely-judge</h2>
      <p className="mt-1 text-sm text-ink-2">Triggered by the vault&apos;s ResultSubmitted log. Integrates Monad with an external LLM API and writes a DON-signed report back.</p>
      <div className="mt-5"><Pipeline /></div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Settlement rules</h2>
          <div className="card mt-4 divide-y divide-line">
            {rules.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-5 py-4 sm:grid-cols-[200px_1fr]">
                <p className="text-sm font-semibold">{k}</p>
                <p className="text-sm text-ink-2">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">For developers</h2>
          <pre className="mono mt-4 overflow-x-auto rounded bg-night p-5 text-[12.5px] leading-relaxed text-white/85">{code}</pre>
        </div>
      </div>
    </div>
  );
}
