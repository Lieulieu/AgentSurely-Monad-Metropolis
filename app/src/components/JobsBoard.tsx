"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Cpu, GraduationCap, Landmark, Scale, ShoppingBag, Sprout, Users, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import type { Domain, JobTemplate, PlanName } from "@agentsurely/sdk";
import { useJobLimits, useSubscription } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { ButtonLink, Card } from "./ui";

/** Plan limits for jobs (mirrors JobBoard defaults; the contract is the source of truth). */
export const JOB_PLAN_LIMITS: Record<PlanName, { jobs: number; agentsPerJob: number }> = {
  Free: { jobs: 1, agentsPerJob: 3 },
  Pro: { jobs: 5, agentsPerJob: 5 },
  Vip: { jobs: 30, agentsPerJob: 30 },
};

const ICONS: Record<string, LucideIcon> = {
  landmark: Landmark,
  "graduation-cap": GraduationCap,
  sprout: Sprout,
  "shopping-bag": ShoppingBag,
  cpu: Cpu,
  scale: Scale,
};

export const planLabel = (p: PlanName) => (p === "Vip" ? "VIP" : p === "Pro" ? "PRO" : "Free");

export function DomainIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? Users;
  return <Icon className={className} />;
}

export function DomainBadge({ domainId }: { domainId: string }) {
  const sdk = useSdk();
  const d = sdk?.domains().find((x) => x.id === domainId);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">
      {d && <DomainIcon icon={d.icon} className="h-3.5 w-3.5" />} {d?.name ?? domainId}
    </span>
  );
}

/** "Free · 0/1 jobs · up to 3 agents per job" with an upgrade link. */
export function JobQuota({ className }: { className?: string }) {
  const sdk = useSdk();
  const { address } = useAccount();
  const sub = useSubscription(address);
  const limits = useJobLimits(address);
  // Wallet state is only known in the browser: render it after mount to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const plan = sub.data?.plan ?? "Free";
  const l = limits.data ?? { ...JOB_PLAN_LIMITS[plan], openJobs: 0, unlimited: false };
  const full = !l.unlimited && l.openJobs >= l.jobs;
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-6 gap-y-2 rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm", className)}>
      {!mounted ? (
        <span className="text-ink-3">…</span>
      ) : !address ? (
        <span className="text-ink-2">Connect a wallet to create jobs.</span>
      ) : (
        <>
          <span>Plan <b>{planLabel(plan)}</b></span>
          <span>{l.unlimited ? "Unlimited jobs (platform wallet)" : <>Open jobs <b className={clsx("tabular-nums", full && "text-bad")}>{l.openJobs}/{l.jobs}</b></>}</span>
          {!l.unlimited && <span>Up to <b>{l.agentsPerJob}</b> agents per job</span>}
          {!sdk?.hasJobBoard && <span className="text-warn">JobBoard not deployed on this network yet</span>}
        </>
      )}
      <span className="ml-auto text-xs text-ink-3">Free 1 job × 3 agents · PRO 5 × 5 · VIP 30 × 30 · <Link className="text-brand" href="/pricing">plans</Link></span>
    </div>
  );
}

export function DomainCard({ d, active, onClick }: { d: Domain; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "card flex flex-col items-start gap-2 p-4 text-left transition hover:border-brand",
        active && "border-brand ring-1 ring-brand"
      )}
    >
      <span className={clsx("grid h-9 w-9 place-items-center rounded-sm", active ? "bg-brand text-white" : "bg-brand-soft text-brand")}>
        <DomainIcon icon={d.icon} className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-semibold">{d.name}</span>
        <span className="block text-xs text-ink-3">{d.vi} · {d.jobs.length} ready jobs</span>
      </span>
    </button>
  );
}

/** A suggested job: pre-filled brief + suggested agents; "Use this job" opens the pre-filled form. */
export function JobTemplateCard({ t }: { t: JobTemplate }) {
  const sdk = useSdk();
  const names = t.agents.map((id) => sdk?.catalog().find((a) => a.id === id)?.name ?? id);
  return (
    <Card className="flex flex-col p-5">
      <p className="font-semibold">{t.title}</p>
      <p className="mt-2 line-clamp-3 text-sm text-ink-2">{t.brief}</p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">Suggested team · {t.agents.length} agents</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {names.map((n) => <span key={n} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-2">{n}</span>)}
      </div>
      <div className="mt-auto flex items-center gap-3 pt-5">
        <ButtonLink href={`/jobs/new?template=${t.id}`} className="!px-3 !py-1.5 text-xs">Use this job</ButtonLink>
        <span className="text-xs text-ink-3">≈ {t.agents.length} USDC rent / 30 days</span>
      </div>
    </Card>
  );
}

/**
 * First task for an agent on a job: from the domain template whose suggested team overlaps the job's team
 * most and has a task for this agent. Undefined → show the agent's playbooks instead.
 */
export function firstTaskFor(domain: Domain | undefined, teamCatalogIds: string[], catalogId: string | undefined): string | undefined {
  if (!domain || !catalogId) return undefined;
  const ranked = domain.jobs
    .filter((j) => j.tasks[catalogId])
    .map((j) => ({ j, overlap: j.agents.filter((a) => teamCatalogIds.includes(a)).length }))
    .sort((a, b) => b.overlap - a.overlap);
  return ranked[0]?.j.tasks[catalogId];
}
