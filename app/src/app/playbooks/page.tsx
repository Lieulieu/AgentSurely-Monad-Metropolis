"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Play, Search, Sparkles, ThumbsUp } from "lucide-react";
import clsx from "clsx";
import type { OnchainPlaybook } from "@agentsurely/sdk";
import { NotDeployed } from "@/components/domain";
import { runHref } from "@/components/Playbooks";
import { ButtonLink, Card, Empty, SectionTitle, Skeleton, Stat } from "@/components/ui";
import { useAgents, usePlaybookMarket, useSubscription } from "@/lib/queries";
import { isDeployed, useSdk } from "@/lib/sdk";

type Sort = "useful" | "new";

/**
 * Playbook market (upgrade-07): every ready-to-run task creators published on-chain, ranked by renters'
 * "useful" votes. Renters find what to do with an agent before (and after) renting it; creators compete on
 * useful playbooks, which brings rentals (90% of the 1 USDC rent goes to them).
 */
export default function PlaybookMarketPage() {
  const sdk = useSdk();
  const market = usePlaybookMarket();
  const agents = useAgents();
  const { address } = useAccount();
  const sub = useSubscription(address);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("useful");

  const nameOf = (id: bigint) => sdk?.catalogAgentFor(id)?.name ?? agents.data?.find((a) => a.id === id)?.profile.name ?? `Agent #${id}`;
  const rented = new Set((sub.data?.rentals ?? []).map((r) => r.agentId.toString()));
  const owned = new Set((sub.data?.created ?? []).map(String));

  const list = useMemo(() => {
    const all = market.data ?? [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter((p) => `${p.title} ${p.outcome} ${p.template} ${nameOf(p.agentId)}`.toLowerCase().includes(needle))
      : all;
    return [...filtered].sort((a, b) => (sort === "useful" ? b.useful - a.useful || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.data, q, sort, agents.data]);

  if (!isDeployed) return <div className="page py-10"><NotDeployed /></div>;

  const all = market.data ?? [];
  const agentCount = new Set(all.map((p) => p.agentId.toString())).size;
  const votes = all.reduce((s, p) => s + p.useful, 0);

  return (
    <div className="page py-10">
      <SectionTitle
        eyebrow="Playbook market"
        title="Find the task, then rent the agent"
        sub="Ready-to-run tasks published on-chain by agent creators and ranked by renters who used them. Run one in a click — if the result fails CRE verification, your fee and the agent's coverage come back to you."
      />

      {!sdk?.hasPlaybookMarket ? (
        <div className="mt-8">
          <Empty title="Playbook market not deployed on this network">
            Run <code className="mono">npm run playbooks:monad</code> (deploys the PlaybookRegistry and publishes the catalog playbooks). Starter tasks are still available in your Workspace.
          </Empty>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-3 gap-6 border-y border-line py-6">
            <Stat label="Playbooks" value={market.data ? all.length : "…"} />
            <Stat label="Agents covered" value={market.data ? agentCount : "…"} />
            <Stat label="Useful votes" value={market.data ? votes : "…"} hint="from renters" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input className="input !pl-9" placeholder="Search: translate, audit, forecast, report…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="flex rounded-sm border border-line p-0.5 text-sm">
              {(["useful", "new"] as Sort[]).map((s) => (
                <button key={s} type="button" onClick={() => setSort(s)} className={clsx("rounded-sm px-3 py-1.5", sort === s ? "bg-surface-2 font-semibold text-ink" : "text-ink-3")}>
                  {s === "useful" ? "Most useful" : "Newest"}
                </button>
              ))}
            </div>
          </div>

          {market.isLoading ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
          ) : list.length === 0 ? (
            <div className="mt-6"><Empty title={q ? "No playbook matches" : "No playbooks yet"}>{q ? "Try another word." : "Creators publish playbooks from their agent page."}</Empty></div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {list.map((p) => (
                <MarketCard key={`${p.agentId}-${p.index}`} p={p} agentName={nameOf(p.agentId)} status={owned.has(p.agentId.toString()) ? "owned" : rented.has(p.agentId.toString()) ? "rented" : "none"} />
              ))}
            </div>
          )}

          <Card className="mt-10 flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-brand" /> Creating agents?</p>
              <p className="mt-1 max-w-xl text-sm text-ink-2">Publish up to 10 playbooks per agent from its page. Useful playbooks rank first here and bring renters — you keep 90% of every 1 USDC rent plus mUSD rewards for each passed job.</p>
            </div>
            <ButtonLink href={sub.data?.created.length ? `/agents/${sub.data.created[0]}#playbooks` : "/agents/new"} variant="secondary">
              {sub.data?.created.length ? "Publish playbooks" : "Create an agent"}
            </ButtonLink>
          </Card>
        </>
      )}
    </div>
  );
}

function MarketCard({ p, agentName, status }: { p: OnchainPlaybook; agentName: string; status: "owned" | "rented" | "none" }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{p.title}</p>
          <Link href={`/agents/${p.agentId}`} className="text-xs text-ink-3 hover:text-brand">{agentName} · #{p.agentId.toString()}</Link>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2" title="Renters who marked it useful">
          <ThumbsUp className="h-3 w-3" /> {p.useful}
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-2"><span className="text-ink-3">You get:</span> {p.outcome || "—"}</p>
      <button type="button" className="mt-2 self-start text-xs font-semibold text-brand hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide task" : "Show task"}</button>
      {open && <pre className="mt-2 whitespace-pre-wrap rounded-sm bg-surface-2 p-2 font-sans text-xs text-ink-2">{p.template}</pre>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <ButtonLink href={runHref(p.agentId, p.template)} className="!px-3 !py-1.5 text-xs">
          <Play className="h-3.5 w-3.5" /> {status === "none" ? "Rent & run · 1 USDC" : "Run"}
        </ButtonLink>
        {status === "rented" && <span className="text-xs text-ok">Rented</span>}
        {status === "owned" && <span className="text-xs text-ink-3">Your agent</span>}
        <span className="ml-auto text-xs text-ink-3">updated {new Date(p.updatedAt * 1000).toLocaleDateString()}</span>
      </div>
    </Card>
  );
}
