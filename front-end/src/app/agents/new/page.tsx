"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { toUnits, TOKEN_SYMBOL } from "@agentsurely/sdk";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useSubscription } from "@/lib/queries";
import { Funding } from "@/components/Funding";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

export default function NewAgentPage() {
  const sdk = useSdk();
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const sub = useSubscription(address);
  const [form, setForm] = useState({ name: "", description: "", skills: "", endpoint: "", bond: "1" });
  const [list, setList] = useState(false);
  const limits = sub.data?.limits;
  const createFull = !!sub.data && sub.data.created.length >= sub.data.limits.create;
  const canList = !!sub.data && sub.data.listed.length < sub.data.limits.list;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const create = useTx("Register agent", async () => {
    const agentId = await sdk!.registerAgent({
      name: form.name.trim(),
      description: form.description.trim(),
      skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
      endpoint: form.endpoint.trim() || undefined,
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    });
    if (Number(form.bond) > 0) await sdk!.depositBond(agentId, toUnits(form.bond));
    if (sdk!.addresses.SubscriptionManager) {
      // upgrade-02: count it against the plan (Free 3 · PRO 5 · VIP 30) and optionally list it for rent.
      if (list && canList) await sdk!.publishAgents([agentId]);
      else await sdk!.registerWithPlan(agentId);
    }
    router.push(`/agents/${agentId}`);
    return agentId;
  });

  return (
    <div className="page max-w-3xl py-10">
      <SectionTitle eyebrow="ERC-8004" title="Register and bond an agent" sub="Mint an agent identity, then post a bond. The bond is the maximum coverage your agent can offer clients at once." />
      {sub.data && limits && (
        <p className="mt-4 text-sm text-ink-2">
          Plan <b>{sub.data.plan === "Vip" ? "VIP" : sub.data.plan}</b> · created {sub.data.created.length}/{limits.create} · listed for rent {sub.data.listed.length}/{limits.list}
          {createFull && <> · <Link className="text-brand" href="/pricing">limit reached — upgrade</Link></>}
        </p>
      )}
      <Card className="mt-8 p-6">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <div>
            <label className="label" htmlFor="name">Agent name</label>
            <input id="name" required className="input" placeholder="ResearchBot" value={form.name} onChange={set("name")} />
          </div>
          <div>
            <label className="label" htmlFor="desc">What does it do?</label>
            <textarea id="desc" rows={3} className="input" placeholder="Summarises technical docs into plain-language briefs." value={form.description} onChange={set("description")} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="skills">Skills (comma separated)</label>
              <input id="skills" className="input" placeholder="research, summary, vi-en" value={form.skills} onChange={set("skills")} />
            </div>
            <div>
              <label className="label" htmlFor="endpoint">Endpoint (optional)</label>
              <input id="endpoint" className="input" placeholder="https://agent.example/a2a" value={form.endpoint} onChange={set("endpoint")} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="bond">Initial bond ({TOKEN_SYMBOL})</label>
            <input id="bond" className="input" inputMode="decimal" value={form.bond} onChange={set("bond")} />
            <p className="mt-1.5 text-xs text-ink-3">Bonds are posted in {TOKEN_SYMBOL}. Three wallet confirmations: register, deposit, then add to your plan.</p>
            {isConnected && Number(form.bond) > 0 && <Funding className="mt-2" need={toUnits(form.bond)} needLabel="the bond" />}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={list && canList} disabled={!canList} onChange={(e) => setList(e.target.checked)} />
            <span>
              List for rent ($1 / 30 days per renter — you keep 90%).{" "}
              {!canList && <span className="text-ink-3">Free agents are for testing only; <Link className="text-brand" href="/pricing">PRO lists 5, VIP lists 30</Link>.</span>}
            </span>
          </label>
          <Button type="submit" disabled={!isConnected || !sdk || createFull} loading={create.isPending} className="sm:justify-self-start">
            {!isConnected ? "Connect a wallet first" : createFull ? "Create limit reached" : "Register & bond"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
