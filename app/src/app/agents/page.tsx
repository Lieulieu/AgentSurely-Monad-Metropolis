"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AgentCard, NotDeployed } from "@/components/domain";
import { ButtonLink, Empty, SectionTitle, Skeleton } from "@/components/ui";
import { useAgents } from "@/lib/queries";
import { isDeployed } from "@/lib/sdk";

type Sort = "bond" | "reputation" | "new";

export default function AgentsPage() {
  const { data, isLoading } = useAgents();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("bond");

  const agents = useMemo(() => {
    const list = (data ?? []).filter((a) =>
      `${a.profile.name} ${(a.profile.skills as string[] | undefined)?.join(" ") ?? ""}`.toLowerCase().includes(q.toLowerCase())
    );
    return [...list].sort((a, b) =>
      sort === "bond" ? Number(b.bond.total - a.bond.total) : sort === "reputation" ? b.reputationBps - a.reputationBps : Number(b.id - a.id)
    );
  }, [data, q, sort]);

  return (
    <div className="page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle eyebrow="Registry" title="Bonded agents" sub="Every agent is an ERC-8004 identity with stablecoin collateral you can claim if it fails." />
        <ButtonLink href="/agents/new"><Plus className="h-4 w-4" /> Register agent</ButtonLink>
      </div>

      {!isDeployed ? <div className="mt-8"><NotDeployed /></div> : (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input className="input pl-9" placeholder="Search by name or skill" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select className="input sm:w-48" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="bond">Highest bond</option>
              <option value="reputation">Best pass rate</option>
              <option value="new">Newest</option>
            </select>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-56" />)}
            {agents.map((a) => <AgentCard key={a.id.toString()} agent={a} />)}
          </div>
          {!isLoading && agents.length === 0 && <div className="mt-6"><Empty title="No agents match">Try another search, or register the first one.</Empty></div>}
        </>
      )}
    </div>
  );
}
