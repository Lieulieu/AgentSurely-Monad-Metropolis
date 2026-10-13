"use client";

import Link from "next/link";
import clsx from "clsx";
import { ArrowUpRight, Check, Clock, Cpu, FileCheck2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { fmtPct, fmtUsd, TOKEN_SYMBOL, type Agent, type Job } from "@agentsurely/sdk";
import { StatusPill } from "./ui";

export function AgentAvatar({ name, id, size = "md" }: { name: string; id: bigint; size?: "md" | "lg" }) {
  const hue = Number(id * 47n % 360n);
  const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+|(?=[A-Z])/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div
      className={clsx("grid shrink-0 place-items-center rounded-sm font-semibold text-white", size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm")}
      style={{ background: `linear-gradient(135deg, rgb(var(--brand)), hsl(${hue} 70% 55%))` }}
    >
      {initials || "AG"}
    </div>
  );
}

/** Stacked bar: locked (backing open jobs) · queued withdrawal · available. */
export function BondMeter({ agent, compact }: { agent: Agent; compact?: boolean }) {
  const { total, locked, pendingWithdraw, available } = agent.bond;
  const pct = (v: bigint) => (total === 0n ? 0 : Number((v * 10_000n) / total) / 100);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="bg-brand" style={{ width: `${pct(locked)}%` }} title="Locked as coverage" />
        <div className="bg-warn" style={{ width: `${pct(pendingWithdraw)}%` }} title="Queued withdrawal" />
        <div className="bg-brand/25" style={{ width: `${pct(available)}%` }} title="Available" />
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <Legend className="bg-brand" label="Locked" value={fmtUsd(locked)} />
          <Legend className="bg-brand/25" label="Available" value={fmtUsd(available)} />
          {pendingWithdraw > 0n && <Legend className="bg-warn" label="Withdrawing" value={fmtUsd(pendingWithdraw)} />}
        </div>
      )}
    </div>
  );
}
function Legend({ className, label, value }: { className: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("h-2 w-2 rounded-full", className)} />
      {label} <span className="font-medium tabular-nums text-ink">{value}</span>
    </span>
  );
}

export function AgentCard({ agent }: { agent: Agent }) {
  const total = agent.stats.passed + agent.stats.failed + agent.stats.expired;
  const skills = (agent.profile.skills as string[] | undefined) ?? [];
  return (
    <Link href={`/agents/${agent.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-brand/40">
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.profile.name} id={agent.id} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-semibold">
            <span className="truncate">{agent.profile.name}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100" />
          </p>
          <p className="mono text-ink-3">ERC-8004 #{agent.id.toString()}</p>
        </div>
        <Reputation bps={agent.reputationBps} jobs={total} />
      </div>
      {skills.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {skills.slice(0, 4).map((s) => (
            <span key={s} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-2">{s}</span>
          ))}
        </div>
      )}
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <p className="text-xs text-ink-3">Bond</p>
          <p className="font-semibold tabular-nums">{fmtUsd(agent.bond.total, 2)} <span className="text-xs font-normal text-ink-3">{TOKEN_SYMBOL}</span></p>
        </div>
        <div>
          <p className="text-xs text-ink-3">Max coverage now</p>
          <p className="font-semibold tabular-nums">{fmtUsd(agent.bond.available, 2)} <span className="text-xs font-normal text-ink-3">{TOKEN_SYMBOL}</span></p>
        </div>
      </div>
      <div className="mt-3"><BondMeter agent={agent} compact /></div>
    </Link>
  );
}

export function Reputation({ bps, jobs }: { bps: number; jobs: number }) {
  if (jobs === 0) return <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-3">New</span>;
  const good = bps >= 8000;
  const bad = bps < 5000;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", good ? "bg-ok-soft text-ok" : bad ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
      {good ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {fmtPct(bps)} · {jobs}
    </span>
  );
}

/** Half-circle 0-100 gauge with the pass threshold marked. */
export function ScoreGauge({ score, min, status }: { score?: number; min: number; status: Job["status"] }) {
  const done = status === "Passed" || status === "Failed";
  const value = done ? score ?? 0 : 0;
  const r = 70;
  const arc = Math.PI * r;
  const angle = (p: number) => Math.PI * (1 - p / 100);
  const mx = 90 + r * Math.cos(angle(min));
  const my = 90 - r * Math.sin(angle(min));
  const color = !done ? "rgb(var(--line))" : status === "Passed" ? "rgb(var(--ok))" : "rgb(var(--bad))";
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 180 100" className="w-full">
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="rgb(var(--surface-2))" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M20 90 A70 70 0 0 1 160 90"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(arc * value) / 100} ${arc}`}
          style={{ transition: "stroke-dasharray .8s ease" }}
        />
        <line x1={mx} y1={my} x2={90 + (r - 16) * Math.cos(angle(min))} y2={90 - (r - 16) * Math.sin(angle(min))} stroke="rgb(var(--ink))" strokeWidth="2" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-3xl font-semibold tabular-nums">{done ? value : "—"}</p>
        <p className="text-xs text-ink-3">score · pass ≥ {min}</p>
      </div>
    </div>
  );
}

type Step = { key: string; label: string; detail: string; icon: typeof Check; state: "done" | "active" | "todo" | "bad" };

export function JobTimeline({ job }: { job: Job }) {
  const s = job.status;
  const failed = s === "Failed" || s === "Expired";
  const steps: Step[] = [
    { key: "hire", label: "Hired", detail: `Fee escrowed, ${fmtUsd(job.coverage)} ${TOKEN_SYMBOL} of bond locked`, icon: FileCheck2, state: "done" },
    {
      key: "submit",
      label: s === "Expired" ? "Deadline missed" : "Output delivered",
      detail: s === "Open" ? "Waiting for the agent" : s === "Expired" ? "Agent did not deliver in time" : "Hash committed onchain · ResultSubmitted emitted",
      icon: s === "Expired" ? X : Clock,
      state: s === "Open" ? "active" : s === "Expired" ? "bad" : "done",
    },
    {
      key: "verify",
      label: "Chainlink CRE verification",
      detail: s === "Submitted" ? "Log trigger → EVM read → checks → LLM judge (DON median) → signed report" : s === "Refunded" ? "Verifier window elapsed" : "DON-signed verdict delivered via onReport",
      icon: Cpu,
      state: s === "Submitted" ? "active" : s === "Open" || s === "Expired" ? "todo" : "done",
    },
    {
      key: "settle",
      label: s === "Passed" ? "Agent paid" : failed ? "Bond slashed to client" : s === "Refunded" ? "Fee refunded" : "Settlement",
      detail: s === "Passed" ? `${fmtUsd(job.fee)} ${TOKEN_SYMBOL} released to the agent + mUSD reward` : failed ? `${fmtUsd(job.coverage + job.fee)} ${TOKEN_SYMBOL} sent to the client` : "Pay or slash, automatically",
      icon: failed ? ShieldAlert : ShieldCheck,
      state: s === "Passed" || s === "Refunded" ? "done" : failed ? "bad" : "todo",
    },
  ];
  return (
    <ol className="relative space-y-6">
      {steps.map((st, i) => (
        <li key={st.key} className="relative flex gap-4">
          {i < steps.length - 1 && (
            <span className={clsx("absolute left-[15px] top-9 h-[calc(100%-4px)] w-px", st.state === "done" ? "bg-brand" : "bg-line")} />
          )}
          <span
            className={clsx(
              "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2",
              st.state === "done" && "border-brand bg-brand text-white",
              st.state === "active" && "border-warn bg-warn-soft text-warn",
              st.state === "todo" && "border-line bg-surface text-ink-3",
              st.state === "bad" && "border-bad bg-bad text-white"
            )}
          >
            <st.icon className={clsx("h-4 w-4", st.state === "active" && "animate-pulse")} />
          </span>
          <div className="pt-1">
            <p className={clsx("text-sm font-semibold", st.state === "todo" && "text-ink-3")}>{st.label}</p>
            <p className="text-sm text-ink-2">{st.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function JobsTable({ jobs, agents }: { jobs: Job[]; agents?: Map<string, string> }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 text-right font-medium">Fee</th>
              <th className="px-4 py-3 text-right font-medium">Coverage</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {jobs.map((j) => (
              <tr key={j.id.toString()} className="transition hover:bg-brand-soft/40">
                <td className="px-4 py-3">
                  <Link href={`/jobs/${j.id}`} className="mono font-medium text-brand hover:underline">#{j.id.toString()}</Link>
                </td>
                <td className="max-w-[320px] truncate px-4 py-3 text-ink-2">
                  <Link href={`/jobs/${j.id}`}>{j.spec}</Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/agents/${j.agentId}`} className="hover:text-brand">{agents?.get(j.agentId.toString()) ?? `#${j.agentId}`}</Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(j.fee)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(j.coverage)}</td>
                <td className="px-4 py-3"><StatusPill status={j.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NotDeployed() {
  return (
    <div className="card border-warn/40 bg-warn-soft/60 p-5 text-sm text-ink-2">
      <p className="font-semibold text-ink">Contracts not found for this network</p>
      <p className="mt-1">
        Run <code className="mono rounded bg-surface px-1.5 py-0.5">npm run deploy:local</code> (or <code className="mono rounded bg-surface px-1.5 py-0.5">deploy:monad</code>) and restart the app.
      </p>
    </div>
  );
}
