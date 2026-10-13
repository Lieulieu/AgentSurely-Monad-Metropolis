"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ExternalLink, Minus, Plus } from "lucide-react";
import clsx from "clsx";
import type { CatalogAgent } from "@agentsurely/sdk";
import { Button, ButtonLink, Card, Empty, SectionTitle } from "@/components/ui";
import { Funding } from "@/components/Funding";
import { useRentTerms, useSubscription } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { useSignIn } from "@/lib/siwe";
import { useTx } from "@/lib/tx";

type Tier = CatalogAgent["tier"];
const TIER_STYLE: Record<Tier, string> = {
  basic: "bg-ok-soft text-ok",
  pro: "bg-brand-soft text-brand",
  vip: "bg-warn-soft text-warn",
};

export default function CatalogPage() {
  const sdk = useSdk();
  const { address } = useAccount();
  const { signedIn, signIn } = useSignIn();
  const sub = useSubscription(address);
  const [filter, setFilter] = useState<Tier | "all">("all");
  const agents = useMemo(() => sdk?.catalog() ?? [], [sdk]);
  const terms = useRentTerms();
  const add = useTx("Rent agent", (id: bigint) => sdk!.rent(id, 1));
  const remove = useTx("Cancel rental", (id: bigint) => sdk!.cancelRental(id));

  const plan = sub.data?.plan ?? "Free";
  const rented = sub.data?.rentals ?? [];
  const full = sub.data ? rented.length >= sub.data.limits.rent : false;
  const shown = agents.filter((a) => filter === "all" || a.tier === filter);
  const projects = new Set(agents.map((a) => a.source.project)).size;

  return (
    <div className="page py-10">
      <SectionTitle
        eyebrow="Agent catalog"
        title={`${agents.length} bonded agents, ported from ${projects} open-source projects`}
        sub="Each agent is adapted from a reputable open-source example (MIT or Apache-2.0), with the exact file, commit and license linked. Rent an agent for 1 USDC / 30 days, then hire it — every job is bonded and verified by Chainlink CRE. Free rents 3, PRO 50, VIP 900 — put them on jobs from the Jobs page."
      />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["all", "basic", "pro", "vip"] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={clsx("rounded-full px-3 py-1.5 text-sm", filter === t ? "bg-ink text-white" : "bg-surface-2 text-ink-2")}>
            {t === "all" ? "All" : t.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto text-sm text-ink-2">
          {signedIn && sub.data ? (
            <>Plan <b>{plan === "Vip" ? "VIP" : plan}</b> · renting {rented.length}/{sub.data.limits.rent} · <Link className="text-brand" href="/pricing">change plan</Link></>
          ) : address ? (
            <Button variant="secondary" onClick={() => signIn().catch(() => undefined)}>Sign in to rent agents</Button>
          ) : (
            "Connect a wallet to rent agents"
          )}
        </span>
      </div>

      {signedIn && <Funding className="mt-4" need={terms.data?.price} needLabel="a 30-day rental" />}

      {shown.length === 0 ? (
        <div className="mt-6"><Empty title="No agents in this tier" /></div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => {
            const rental = a.agentId !== undefined ? rented.find((r) => r.agentId === a.agentId) : undefined;
            const registered = a.agentId !== undefined;
            return (
              <Card key={a.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-xs text-ink-3">{registered ? `ERC-8004 #${a.agentId}` : "not registered on this network"}</p>
                  </div>
                  <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase", TIER_STYLE[a.tier])}>{a.tier}</span>
                </div>
                <p className="mt-3 text-sm text-ink-2">{a.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.skills.map((s) => <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{s}</span>)}
                </div>
                <p className="mt-3 text-xs text-ink-3">Steps: {a.steps.map((s) => s.name).join(" → ")}</p>
                <div className="mt-3 rounded-sm bg-surface-2 p-3 text-xs text-ink-2">
                  <p>
                    Ported from <b>{a.source.project}</b> ({a.source.license}) ·{" "}
                    <a className="inline-flex items-center gap-1 text-brand" href={a.source.url} target="_blank" rel="noreferrer">
                      {a.source.path.split("/").pop()} @ {a.source.commit.slice(0, 7)} <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer">What we changed</summary>
                    <ul className="mt-1 list-disc pl-4">{a.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                  </details>
                </div>
                <div className="mt-4 flex gap-2">
                  {!signedIn || !registered ? (
                    <Button variant="secondary" className="flex-1" disabled>{registered ? "Sign in to rent" : "Unavailable"}</Button>
                  ) : rental ? (
                    <>
                      <ButtonLink href={`/workspace#agent-${a.agentId}`} className="flex-1">Use it · until {new Date(rental.expiresAt * 1000).toLocaleDateString()}</ButtonLink>
                      <Button variant="secondary" loading={add.isPending && add.variables === a.agentId} onClick={() => add.mutate(a.agentId!)} title="Extend 30 days ($1)"><Plus className="h-4 w-4" /></Button>
                      <Button variant="secondary" loading={remove.isPending && remove.variables === a.agentId} onClick={() => remove.mutate(a.agentId!)} title="Cancel rental (frees a slot, no refund)"><Minus className="h-4 w-4" /></Button>
                    </>
                  ) : full ? (
                    <ButtonLink href="/pricing" variant="secondary" className="flex-1">Rental limit reached — upgrade</ButtonLink>
                  ) : (
                    <Button className="flex-1" loading={add.isPending && add.variables === a.agentId} onClick={() => add.mutate(a.agentId!)}><Plus className="h-4 w-4" /> Rent · 1 USDC / 30 days</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-8 text-xs text-ink-3">
        Third-party notices: <code>catalog/THIRD_PARTY_NOTICES.md</code> in the repository. Upstream projects do not endorse AgentSurely.
      </p>
    </div>
  );
}
