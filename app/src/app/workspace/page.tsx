"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { CheckCircle2, Circle, Clock, RefreshCw, Sparkles } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, REWARD_SYMBOL, TOKEN_SYMBOL, type Job } from "@agentsurely/sdk";
import { PlaybookList } from "@/components/Playbooks";
import { Funding } from "@/components/Funding";
import { NotDeployed } from "@/components/domain";
import { Button, ButtonLink, Card, Empty, SectionTitle, Stat, StatusPill } from "@/components/ui";
import { useAgents, useJobs, usePlaybooks, useRentTerms, useRewardBalance, useSubscription } from "@/lib/queries";
import { isDeployed, useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

const DAY = 86_400;

/**
 * Workspace — what renters do after renting: ready-to-run playbooks per agent, results to reuse,
 * and the value they got for their USDC. This is the retention loop: rent → run → use → renew.
 */
export default function WorkspacePage() {
  const sdk = useSdk();
  const { address } = useAccount();
  const sub = useSubscription(address);
  const jobs = useJobs(address ? { client: address } : {});
  const agents = useAgents();
  const rewards = useRewardBalance(address);
  const terms = useRentTerms();

  const myJobs = useMemo(() => (address ? jobs.data ?? [] : []), [address, jobs.data]);
  const rentals = sub.data?.rentals ?? [];
  const created = sub.data?.created ?? [];

  if (!isDeployed) return <div className="page py-10"><NotDeployed /></div>;
  if (!address) {
    return (
      <div className="page py-10">
        <SectionTitle eyebrow="Workspace" title="Your rented agents, ready to work" sub="Connect a wallet to see the agents you rent, run ready-made tasks, and keep your verified results." />
      </div>
    );
  }

  const verified = myJobs.filter((j) => j.status === "Passed" || j.status === "Failed" || j.status === "Expired");
  const passed = myJobs.filter((j) => j.status === "Passed");
  const protectedUsd = myJobs.filter((j) => j.status === "Failed" || j.status === "Expired").reduce((s, j) => s + j.coverage + j.fee, 0n);
  const feesPaid = passed.reduce((s, j) => s + j.fee, 0n);
  const nameOf = (id: bigint) => sdk?.catalogAgentFor(id)?.name ?? agents.data?.find((a) => a.id === id)?.profile.name ?? `Agent #${id}`;
  const skillsOf = (id: bigint) => (agents.data?.find((a) => a.id === id)?.profile.skills as string[] | undefined) ?? [];

  const steps = [
    { done: rentals.length > 0 || created.length > 0, label: "Rent an agent", href: "/catalog", cta: "Browse catalog" },
    { done: myJobs.length > 0, label: "Run your first task", href: rentals[0] ? `#agent-${rentals[0].agentId}` : "/catalog", cta: "Pick a playbook below" },
    { done: verified.length > 0, label: "Get a verified result (or your money back)", href: myJobs[0] ? `/jobs/${myJobs[0].id}` : "#", cta: "Open result" },
  ];

  return (
    <div className="page py-10">
      <SectionTitle
        eyebrow="Workspace"
        title="Put your agents to work"
        sub="Every agent you rent comes with ready-to-run tasks. Pick one, edit the details, and run it — the result is checked by Chainlink CRE. If it fails, your fee comes back with the agent's coverage."
      />

      <div className="mt-6 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-5">
        <Stat label="Agents you rent" value={rentals.length} hint={sub.data ? `of ${sub.data.limits.rent} on ${sub.data.plan === "Vip" ? "VIP" : sub.data.plan}` : undefined} />
        <Stat label="Tasks run" value={myJobs.length} />
        <Stat label="Verified & passed" value={passed.length} hint={verified.length ? `${Math.round((passed.length / verified.length) * 100)}% pass rate` : undefined} />
        <Stat label="Paid back to you" value={fmtUsd(protectedUsd)} hint={`${TOKEN_SYMBOL} refunds + coverage`} />
        <Stat label="Rewards" value={rewards.data !== undefined ? fmtUsd(rewards.data, 0) : "…"} hint={`${REWARD_SYMBOL} · for agents you own`} />
      </div>

      {steps.some((s) => !s.done) && (
        <Card className="mt-6 p-5">
          <p className="font-semibold">Get value in 3 steps</p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-start gap-2 text-sm">
                {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />}
                <span>
                  <span className={clsx(s.done && "text-ink-3 line-through")}>{i + 1}. {s.label}</span>
                  {!s.done && <Link className="ml-1 text-brand hover:underline" href={s.href}>{s.cta}</Link>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Funding className="mt-6" need={terms.data?.price} needLabel="renewing a rental" />

      <h2 className="mt-10 text-lg font-semibold">Your agents</h2>
      {rentals.length === 0 && created.length === 0 ? (
        <div className="mt-4"><Empty title="No agents yet">Rent an agent from the catalog (1 USDC / 30 days) to unlock its ready-made tasks.</Empty></div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {rentals.map((r) => (
            <AgentPanel key={`r${r.agentId}`} agentId={r.agentId} name={nameOf(r.agentId)} expiresAt={r.expiresAt} jobs={myJobs.filter((j) => j.agentId === r.agentId)} skills={skillsOf(r.agentId)} />
          ))}
          {created.filter((id) => !rentals.some((r) => r.agentId === id)).map((id) => (
            <AgentPanel key={`c${id}`} agentId={id} name={nameOf(id)} owned jobs={myJobs.filter((j) => j.agentId === id)} skills={skillsOf(id)} />
          ))}
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">Recent results</h2>
      {myJobs.length === 0 ? (
        <div className="mt-4"><Empty title="No results yet">Run a task above — results appear here once the agent delivers.</Empty></div>
      ) : (
        <div className="mt-4 space-y-3">
          {myJobs.slice(0, 8).map((j) => <ResultRow key={j.id.toString()} job={j} agentName={nameOf(j.agentId)} />)}
        </div>
      )}
      {feesPaid > 0n && (
        <p className="mt-6 text-xs text-ink-3">You paid {fmtUsd(feesPaid)} {TOKEN_SYMBOL} in fees for verified, passed work. Failed work cost you nothing.</p>
      )}
    </div>
  );
}

function AgentPanel({ agentId, name, expiresAt, owned, jobs, skills }: { agentId: bigint; name: string; expiresAt?: number; owned?: boolean; jobs: Job[]; skills: string[] }) {
  const sdk = useSdk();
  const playbooks = usePlaybooks(agentId, skills);
  const extend = useTx("Extend rental", () => sdk!.rent(agentId, 1));
  const now = Date.now() / 1000;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / DAY)) : undefined;
  const lastPassed = jobs.find((j) => j.status === "Passed");

  return (
    <Card className="flex flex-col p-5">
      <div id={`agent-${agentId}`} className="flex items-start justify-between gap-3 scroll-mt-24">
        <div>
          <Link href={`/agents/${agentId}`} className="font-semibold hover:text-brand">{name}</Link>
          <p className="text-xs text-ink-3">#{agentId.toString()} · {jobs.length} task{jobs.length === 1 ? "" : "s"} run{lastPassed ? ` · last passed ${new Date(lastPassed.createdAt * 1000).toLocaleDateString()}` : ""}</p>
        </div>
        {owned ? (
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">Your agent</span>
        ) : (
          <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", daysLeft !== undefined && daysLeft <= 7 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
            <Clock className="h-3 w-3" /> {daysLeft} day{daysLeft === 1 ? "" : "s"} left
          </span>
        )}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"><Sparkles className="h-3.5 w-3.5" /> Ready-to-run tasks</p>
      <div className="mt-2"><PlaybookList agentId={agentId} entries={playbooks.data ?? []} loading={playbooks.isLoading} /></div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ButtonLink href={`/hire?agent=${agentId}`} variant="secondary" className="!px-3 !py-1.5 text-xs">Write your own task</ButtonLink>
        {owned && <ButtonLink href={`/agents/${agentId}#playbooks`} variant="secondary" className="!px-3 !py-1.5 text-xs">Publish playbooks</ButtonLink>}
        {!owned && (
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" loading={extend.isPending} onClick={() => extend.mutate(undefined)} title="Add 30 days (1 USDC)">
            <RefreshCw className="h-3.5 w-3.5" /> Extend 30 days
          </Button>
        )}
      </div>
    </Card>
  );
}

function ResultRow({ job, agentName }: { job: Job; agentName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={job.status} />
        <Link href={`/jobs/${job.id}`} className="text-sm font-medium hover:text-brand">Job #{job.id.toString()} · {agentName}</Link>
        {job.score > 0 && <span className="text-xs text-ink-3">score {job.score}/{job.minScore}</span>}
        <span className="ml-auto text-xs text-ink-3">{new Date(job.createdAt * 1000).toLocaleString()}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-ink-2">{job.spec}</p>
      {job.output && (
        <>
          <button type="button" className="mt-2 text-xs font-semibold text-brand hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide result" : "Show result"}</button>
          {open && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-2 p-3 font-sans text-sm text-ink">{job.output}</pre>}
        </>
      )}
    </Card>
  );
}
