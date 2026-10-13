"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { BoardJob } from "@agentsurely/sdk";
import { JobsTable, NotDeployed } from "@/components/domain";
import { DomainBadge, DomainCard, DomainIcon, JobQuota, JobTemplateCard } from "@/components/JobsBoard";
import { ButtonLink, Card, Empty, SectionTitle, Skeleton } from "@/components/ui";
import { useAgents, useBoardJobs, useJobs } from "@/lib/queries";
import { isDeployed, useSdk } from "@/lib/sdk";

const TABS = [
  { id: "domains", label: "Start a job" },
  { id: "mine", label: "My jobs" },
  { id: "tasks", label: "All tasks" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function JobsPage() {
  return (
    <Suspense>
      <JobsHub />
    </Suspense>
  );
}

/**
 * Jobs hub (upgrade-08):
 *   Start a job — 6 domains where AI agents are rented most → suggested jobs → pre-filled creation form
 *   My jobs     — the wallet's jobs on the JobBoard (team of rented agents per job)
 *   All tasks   — every bonded, CRE-verified task in SurelyVault (the previous Jobs list)
 */
function JobsHub() {
  const sdk = useSdk();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "domains";
  const domains = sdk?.domains() ?? [];
  const domainId = params.get("domain") ?? domains[0]?.id;
  const domain = domains.find((d) => d.id === domainId);
  const go = (q: Record<string, string>) => router.replace(`/jobs?${new URLSearchParams({ tab, ...(domainId ? { domain: domainId } : {}), ...q })}`, { scroll: false });

  return (
    <div className="page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle
          eyebrow="Jobs"
          title="Put a team of AI agents on a job"
          sub="Pick a domain, start from a suggested job, and the agents you need are rented and assigned in one go. Every task they run is bonded and verified by Chainlink CRE — fail and you are paid back."
        />
        <ButtonLink href="/jobs/new"><Plus className="h-4 w-4" /> Create a job</ButtonLink>
      </div>

      <JobQuota className="mt-6" />

      <div className="mt-6 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go({ tab: t.id })}
            className={clsx("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.id ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!isDeployed ? (
        <div className="mt-8"><NotDeployed /></div>
      ) : tab === "domains" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {domains.map((d) => <DomainCard key={d.id} d={d} active={d.id === domainId} onClick={() => go({ domain: d.id })} />)}
          </div>
          {domain && (
            <section className="mt-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-sm bg-brand text-white"><DomainIcon icon={domain.icon} className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold">{domain.name} <span className="font-normal text-ink-3">· {domain.vi}</span></h2>
                  <p className="text-sm text-ink-2">{domain.demand}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {domain.jobs.map((t) => <JobTemplateCard key={t.id} t={t} />)}
              </div>
              <p className="mt-4 text-sm text-ink-3">
                Something else in {domain.name.toLowerCase()}? <Link className="text-brand hover:underline" href={`/jobs/new?domain=${domain.id}`}>Create your own job</Link>.
              </p>
            </section>
          )}
        </>
      ) : tab === "mine" ? (
        <MyJobs />
      ) : (
        <AllTasks />
      )}
    </div>
  );
}

function MyJobs() {
  const sdk = useSdk();
  const { address } = useAccount();
  const jobs = useBoardJobs(address);
  const agents = useAgents();
  const nameOf = (id: bigint) => sdk?.catalogAgentFor(id)?.name ?? agents.data?.find((a) => a.id === id)?.profile.name ?? `#${id}`;
  if (!address) return <div className="mt-6"><Empty title="Connect a wallet">Your jobs are stored on-chain under your wallet.</Empty></div>;
  if (!sdk?.hasJobBoard) return <div className="mt-6"><Empty title="JobBoard not deployed">Run <code className="mono">npm run jobs:monad</code> to enable jobs on this network.</Empty></div>;
  if (jobs.isLoading) return <Skeleton className="mt-6 h-40" />;
  if (!jobs.data?.length) {
    return (
      <div className="mt-6">
        <Empty title="No jobs yet">
          Start from a suggested job in the <Link className="text-brand" href="/jobs?tab=domains">domains</Link> — the form is pre-filled and the agents are rented for you.
        </Empty>
      </div>
    );
  }
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {jobs.data.map((j) => <BoardJobCard key={j.id.toString()} j={j} names={j.agents.map(nameOf)} />)}
    </div>
  );
}

function BoardJobCard({ j, names }: { j: BoardJob; names: string[] }) {
  return (
    <Link href={`/jobs/board/${j.id}`} className="card block p-5 transition hover:border-brand">
      <div className="flex flex-wrap items-center gap-2">
        <DomainBadge domainId={j.domain} />
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", j.open ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-3")}>{j.open ? "Open" : "Closed"}</span>
        <span className="ml-auto text-xs text-ink-3">Job #{j.id.toString()}</span>
      </div>
      <p className="mt-3 font-semibold">{j.title}</p>
      <p className="mt-1 line-clamp-2 text-sm text-ink-2">{j.brief}</p>
      <p className="mt-3 text-xs text-ink-3">{names.length} agent{names.length === 1 ? "" : "s"}: {names.join(", ") || "none yet"}</p>
    </Link>
  );
}

const FILTERS = ["All", "Open", "Submitted", "Passed", "Failed"] as const;

function AllTasks() {
  const { address } = useAccount();
  const [mine, setMine] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const { data, isLoading } = useJobs(mine && address ? { client: address } : {});
  const agents = useAgents();
  const names = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id.toString(), a.profile.name])), [agents.data]);
  const tasks = (data ?? []).filter((j) => filter === "All" || j.status === filter || (filter === "Failed" && j.status === "Expired"));
  return (
    <>
      <Card className="mt-6 p-4 text-sm text-ink-2">
        A <b>task</b> is one piece of work given to one agent: the fee is held in escrow and the agent&apos;s bond is locked until the Chainlink CRE verdict lands.
      </Card>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={clsx("rounded-full px-3 py-1.5 text-sm font-medium transition", filter === f ? "bg-ink text-white" : "bg-surface text-ink-2 ring-1 ring-line hover:text-ink")}>
            {f === "Submitted" ? "Verifying" : f}
          </button>
        ))}
        {address && (
          <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[rgb(var(--brand))]" /> Only my tasks
          </label>
        )}
      </div>
      <div className="mt-4">
        {isLoading ? <Skeleton className="h-64" /> : tasks.length ? <JobsTable jobs={tasks} agents={names} /> : <Empty title="No tasks here yet" />}
      </div>
    </>
  );
}
