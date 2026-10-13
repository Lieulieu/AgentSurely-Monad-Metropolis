"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { CheckCircle2, ChevronDown, Clock, Pencil, Play, Trash2 } from "lucide-react";
import clsx from "clsx";
import { JobsTable } from "@/components/domain";
import { DomainBadge, firstTaskFor, JOB_PLAN_LIMITS } from "@/components/JobsBoard";
import { PlaybookList, runHref } from "@/components/Playbooks";
import { Address } from "@/components/Address";
import { Button, ButtonLink, Card, Empty, Skeleton, Stat } from "@/components/ui";
import { useAgents, useBoardJob, useJobLimits, useJobs, usePlaybooks, useSubscription } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

const DAY = 86_400;

export default function BoardJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <BoardJobView jobId={BigInt(id)} />
    </Suspense>
  );
}

/** A job (JobBoard): brief, team of rented agents with their first task, and the verified tasks run for it. */
function BoardJobView({ jobId }: { jobId: bigint }) {
  const sdk = useSdk();
  const search = useSearchParams();
  const { address } = useAccount();
  const job = useBoardJob(jobId);
  const agents = useAgents();
  const tasks = useJobs(job.data ? { client: job.data.owner } : {});
  const sub = useSubscription(address);
  const limits = useJobLimits(address);
  const [editing, setEditing] = useState(false);

  if (!sdk?.hasJobBoard) return <div className="page py-10"><Empty title="JobBoard not deployed">Run <code className="mono">npm run jobs:monad</code>.</Empty></div>;
  if (job.isLoading) return <div className="page py-10"><Skeleton className="h-64" /></div>;
  if (!job.data) return <div className="page py-10"><Empty title={`Job #${jobId} not found`} /></div>;

  const j = job.data;
  const isOwner = !!address && address.toLowerCase() === j.owner.toLowerCase();
  const domain = sdk.domains().find((d) => d.id === j.domain);
  const teamCatalog = j.agents.flatMap((a) => sdk.catalogAgentFor(a)?.id ?? []);
  const nameOf = (id: bigint) => sdk.catalogAgentFor(id)?.name ?? agents.data?.find((a) => a.id === id)?.profile.name ?? `Agent #${id}`;
  const jobTasks = (tasks.data ?? []).filter((t) => j.agents.includes(t.agentId) && t.createdAt >= j.createdAt);
  const passed = jobTasks.filter((t) => t.status === "Passed").length;
  const refunded = jobTasks.filter((t) => t.status === "Failed" || t.status === "Expired").length;
  const pending = jobTasks.filter((t) => t.status === "Open" || t.status === "Submitted").length;
  const plan = sub.data?.plan ?? "Free";
  const maxAgents = limits.data ? (limits.data.unlimited ? Infinity : limits.data.agentsPerJob) : JOB_PLAN_LIMITS[plan].agentsPerJob;
  const names = new Map((agents.data ?? []).map((a) => [a.id.toString(), a.profile.name]));

  return (
    <div className="page py-10">
      <Link href="/jobs?tab=mine" className="text-sm text-ink-3 hover:text-brand">← My jobs</Link>

      {search.get("created") && (
        <Card className="mt-4 flex items-center gap-3 border-ok bg-ok-soft p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" />
          <span>Job created and agents assigned. Run each agent&apos;s first task below — replace the &lt;placeholders&gt; first.</span>
        </Card>
      )}

      <Card className="mt-4 p-6">
        {editing ? (
          <EditJob jobId={j.id} initial={j} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <DomainBadge domainId={j.domain} />
              <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", j.open ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-3")}>{j.open ? "Open" : "Closed"}</span>
              <span className="text-xs text-ink-3">Job #{j.id.toString()} · created {new Date(j.createdAt * 1000).toLocaleDateString()} · by <Address value={j.owner} /></span>
              {isOwner && (
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <OpenToggle jobId={j.id} open={j.open} />
                </div>
              )}
            </div>
            <h1 className="mt-4 text-2xl font-semibold">{j.title}</h1>
            {j.brief && <p className="mt-2 whitespace-pre-wrap text-ink-2">{j.brief}</p>}
          </>
        )}
        <div className="mt-6 grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-4">
          <Stat label="Agents" value={j.agents.length} hint={isOwner && maxAgents !== Infinity ? `of ${maxAgents} on your plan` : undefined} />
          <Stat label="Tasks run" value={jobTasks.length} />
          <Stat label="Passed" value={passed} />
          <Stat label="Refunded" value={refunded} hint="failed → fee + coverage back" />
        </div>
      </Card>

      {isOwner && j.open && (
        <SlotCallout jobId={j.id} tasks={jobTasks.length} pending={pending} used={limits.data?.openJobs} max={limits.data?.unlimited ? undefined : limits.data?.jobs} />
      )}

      <h2 className="mt-10 text-lg font-semibold">Team</h2>
      {j.agents.length === 0 ? (
        <div className="mt-4"><Empty title="No agents on this job yet">{isOwner ? "Add one below." : null}</Empty></div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {j.agents.map((a) => (
            <TeamMember
              key={a.toString()}
              jobId={j.id}
              agentId={a}
              name={nameOf(a)}
              isOwner={isOwner}
              open={j.open}
              expiresAt={sub.data?.rentals.find((r) => r.agentId === a)?.expiresAt}
              ownAgent={!!sub.data?.created.includes(a)}
              firstTask={firstTaskFor(domain, teamCatalog, sdk.catalogAgentFor(a)?.id)}
              skills={(agents.data?.find((x) => x.id === a)?.profile.skills as string[] | undefined) ?? []}
            />
          ))}
        </div>
      )}
      {isOwner && j.open && <AddAgents jobId={j.id} current={j.agents} max={maxAgents} nameOf={nameOf} />}

      <h2 className="mt-10 text-lg font-semibold">Tasks for this job</h2>
      <div className="mt-4">
        {jobTasks.length ? <JobsTable jobs={jobTasks} agents={names} /> : <Empty title="No tasks yet">Run a first task from the team above. Results appear here once CRE verifies them.</Empty>}
      </div>
    </div>
  );
}

function TeamMember(p: { jobId: bigint; agentId: bigint; name: string; isOwner: boolean; open: boolean; expiresAt?: number; ownAgent: boolean; firstTask?: string; skills: string[] }) {
  const sdk = useSdk();
  const [more, setMore] = useState(false);
  const books = usePlaybooks(more ? p.agentId : undefined, p.skills);
  const remove = useTx("Remove agent", () => sdk!.removeJobAgent(p.jobId, p.agentId));
  const extend = useTx("Extend rental", () => sdk!.rent(p.agentId, 1));
  const daysLeft = p.expiresAt ? Math.max(0, Math.ceil((p.expiresAt - Date.now() / 1000) / DAY)) : undefined;
  const run = (spec: string) => `${runHref(p.agentId, spec)}&job=${p.jobId}`;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/agents/${p.agentId}`} className="font-semibold hover:text-brand">{p.name}</Link>
          <p className="text-xs text-ink-3">#{p.agentId.toString()}</p>
        </div>
        {p.isOwner && (
          p.ownAgent ? (
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">Your agent</span>
          ) : daysLeft !== undefined ? (
            <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", daysLeft <= 7 ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
              <Clock className="h-3 w-3" /> {daysLeft} day{daysLeft === 1 ? "" : "s"} left
            </span>
          ) : (
            <span className="rounded-full bg-bad-soft px-2.5 py-0.5 text-xs font-semibold text-bad">Rental expired</span>
          )
        )}
      </div>

      {p.firstTask ? (
        <div className="mt-4 rounded-sm border border-line p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">First task</p>
          <p className="mt-1 text-sm text-ink-2">{p.firstTask}</p>
          {p.isOwner && <ButtonLink href={run(p.firstTask)} className="mt-3 !px-3 !py-1.5 text-xs"><Play className="h-3.5 w-3.5" /> Run first task</ButtonLink>}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Pick a ready-made task below or write your own.</p>
      )}

      <button type="button" className="mt-3 inline-flex items-center gap-1 self-start text-xs font-semibold text-brand hover:underline" onClick={() => setMore(!more)}>
        More tasks for this agent <ChevronDown className={clsx("h-3.5 w-3.5 transition", more && "rotate-180")} />
      </button>
      {more && <div className="mt-2"><PlaybookList agentId={p.agentId} entries={books.data ?? []} loading={books.isLoading} /></div>}

      {p.isOwner && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <ButtonLink href={`/hire?agent=${p.agentId}&job=${p.jobId}`} variant="secondary" className="!px-3 !py-1.5 text-xs">Write a task</ButtonLink>
          {!p.ownAgent && <Button variant="secondary" className="!px-3 !py-1.5 text-xs" loading={extend.isPending} onClick={() => extend.mutate(undefined)}>Extend 30 days</Button>}
          {p.open && <Button variant="secondary" className="ml-auto !px-3 !py-1.5 text-xs" loading={remove.isPending} onClick={() => remove.mutate(undefined)} title="Remove from this job (the rental stays)"><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      )}
    </Card>
  );
}

/** Finished jobs should be closed: it frees a job slot of the plan (Free has only one). */
function SlotCallout({ jobId, tasks, pending, used, max }: { jobId: bigint; tasks: number; pending: number; used?: number; max?: number }) {
  const sdk = useSdk();
  const close = useTx("Close job", () => sdk!.setBoardJobOpen(jobId, false));
  if (tasks === 0) return null;
  const slots = max !== undefined && used !== undefined ? ` (${used}/${max} job slots used)` : "";
  if (pending > 0) {
    return (
      <Card className="mt-4 flex items-start gap-3 p-4 text-sm text-ink-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span>{pending} task{pending === 1 ? " is" : "s are"} still waiting for the agent or for Chainlink CRE. Open a task to see who delivers it; past its deadline you can claim fee + coverage. When everything is settled, close the job to free its slot{slots}.</span>
      </Card>
    );
  }
  return (
    <Card className="mt-4 flex flex-wrap items-center gap-3 border-ok p-4 text-sm">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" />
      <span className="flex-1">All {tasks} task{tasks === 1 ? "" : "s"} are settled. Done with this job? Close it to free a job slot{slots} — results and rentals stay, and you can reopen it later.</span>
      <Button loading={close.isPending} onClick={() => close.mutate(undefined)}>Close job &amp; free slot</Button>
    </Card>
  );
}

function OpenToggle({ jobId, open }: { jobId: bigint; open: boolean }) {
  const sdk = useSdk();
  const toggle = useTx(open ? "Close job" : "Reopen job", () => sdk!.setBoardJobOpen(jobId, !open));
  return (
    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" loading={toggle.isPending} onClick={() => toggle.mutate(undefined)} title={open ? "Closing frees a job slot of your plan" : "Needs a free job slot"}>
      {open ? "Close job" : "Reopen"}
    </Button>
  );
}

function EditJob({ jobId, initial, onDone }: { jobId: bigint; initial: { domain: string; title: string; brief: string }; onDone: () => void }) {
  const sdk = useSdk();
  const [f, setF] = useState(initial);
  const save = useTx("Update job", async () => {
    await sdk!.updateBoardJob(jobId, { domain: f.domain, title: f.title.trim(), brief: f.brief.trim() });
    onDone();
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <div>
        <label className="label" htmlFor="d">Domain</label>
        <select id="d" className="input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })}>
          {(sdk?.domains() ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="t">Title</label>
        <input id="t" className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="b">Brief</label>
        <textarea id="b" rows={5} className="input" maxLength={2000} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} disabled={!f.title.trim()}>Save</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function AddAgents({ jobId, current, max, nameOf }: { jobId: bigint; current: bigint[]; max: number; nameOf: (id: bigint) => string }) {
  const sdk = useSdk();
  const agents = useAgents();
  const [pick, setPick] = useState("");
  const add = useTx("Add agent to job", (id: bigint) => sdk!.addJobAgents(jobId, [id]));
  const full = current.length >= max;
  const options = (agents.data ?? []).filter((a) => !current.includes(a.id));
  return (
    <Card className="mt-4 flex flex-wrap items-center gap-3 p-4">
      <p className="text-sm font-medium">Add an agent</p>
      <select className="input max-w-sm flex-1" value={pick} onChange={(e) => setPick(e.target.value)} disabled={full}>
        <option value="">{full ? `Plan limit reached: ${max} agents per job` : "Choose an agent (rented automatically if needed)…"}</option>
        {options.map((a) => <option key={a.id.toString()} value={a.id.toString()}>#{a.id.toString()} · {nameOf(a.id)}</option>)}
      </select>
      <Button variant="secondary" disabled={!pick || full} loading={add.isPending} onClick={() => { add.mutate(BigInt(pick)); setPick(""); }}>Add</Button>
      {full && <Link href="/pricing" className="text-sm text-brand">Upgrade for more</Link>}
    </Card>
  );
}
