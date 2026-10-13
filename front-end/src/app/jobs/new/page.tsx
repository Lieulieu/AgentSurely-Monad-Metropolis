"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, TOKEN_SYMBOL } from "@agentsurely/sdk";
import { Funding } from "@/components/Funding";
import { DomainIcon, JOB_PLAN_LIMITS, JobQuota, planLabel } from "@/components/JobsBoard";
import { NotDeployed } from "@/components/domain";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useAgents, useJobLimits, useRentTerms, useSubscription } from "@/lib/queries";
import { isDeployed, useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

const MAX = { title: 120, brief: 2000 };

export default function NewJobPage() {
  return (
    <Suspense>
      <NewJobForm />
    </Suspense>
  );
}

/**
 * Create a job. `?template=<id>` pre-fills domain, title, brief and the suggested team (catalog agents) and
 * shows the first task each agent will run; `?domain=<id>` starts an empty job in that domain.
 * On submit, agents the wallet doesn't rent yet are rented (1 USDC / 30 days each), then the job is created.
 */
function NewJobForm() {
  const sdk = useSdk();
  const router = useRouter();
  const params = useSearchParams();
  const { address, isConnected } = useAccount();
  const agents = useAgents();
  const sub = useSubscription(address);
  const limits = useJobLimits(address);
  const terms = useRentTerms();

  const found = useMemo(() => (sdk ? sdk.jobTemplate(params.get("template") ?? "") : undefined), [sdk, params]);
  const domains = sdk?.domains() ?? [];
  const [domainId, setDomainId] = useState(found?.domain.id ?? params.get("domain") ?? "finance");
  const [title, setTitle] = useState(found?.template.title ?? "");
  const [brief, setBrief] = useState(found?.template.brief ?? "");
  const [team, setTeam] = useState<bigint[]>([]);
  const [picker, setPicker] = useState("");

  // The SDK can load after the first render: fill the form from the template once it is known.
  useEffect(() => {
    if (!found) return;
    setDomainId(found.domain.id);
    setTitle((t) => t || found.template.title);
    setBrief((b) => b || found.template.brief);
  }, [found]);

  // Suggested team → ERC-8004 ids on this chain (once the SDK is ready).
  const suggested = useMemo(
    () => (found && sdk ? found.template.agents.map((c) => ({ catalogId: c, agentId: sdk.catalogAgentId(c) })) : []),
    [found, sdk]
  );
  useEffect(() => {
    if (suggested.length && team.length === 0) setTeam(suggested.flatMap((s) => (s.agentId !== undefined ? [s.agentId] : [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  const plan = sub.data?.plan ?? "Free";
  const l = limits.data ?? { ...JOB_PLAN_LIMITS[plan], openJobs: 0, unlimited: false };
  const maxAgents = l.unlimited ? Infinity : l.agentsPerJob;
  const jobsFull = !l.unlimited && l.openJobs >= l.jobs;

  const canHire = useQuery({
    queryKey: ["canHireMany", address, team.map(String).join(",")],
    enabled: !!sdk && !!address && team.length > 0,
    queryFn: async () => Promise.all(team.map((id) => sdk!.canHire(address!, id))),
  });
  const toRent = team.filter((_, i) => canHire.data && !canHire.data[i]);
  const price = terms.data?.price ?? 1_000_000n;
  const rentCost = price * BigInt(toRent.length);
  const rentSlotsLeft = sub.data ? sub.data.limits.rent - sub.data.rentals.length : Infinity;
  const rentBlocked = toRent.length > rentSlotsLeft;

  const nameOf = (id: bigint) => sdk?.catalogAgentFor(id)?.name ?? agents.data?.find((a) => a.id === id)?.profile.name ?? `Agent #${id}`;
  const taskOf = (id: bigint) => {
    const c = sdk?.catalogAgentFor(id)?.id;
    return c ? found?.template.tasks[c] : undefined;
  };
  const candidates = (agents.data ?? []).filter((a) => !team.includes(a.id));

  const create = useTx("Create job", async () => {
    const id = await sdk!.createBoardJob({ domain: domainId, title: title.trim(), brief: brief.trim(), agentIds: team });
    router.push(`/jobs/board/${id}?created=1`);
    return id;
  });

  if (!isDeployed) return <div className="page py-10"><NotDeployed /></div>;
  const domain = domains.find((d) => d.id === domainId);
  const tooLong = new TextEncoder().encode(title).length > MAX.title || new TextEncoder().encode(brief).length > MAX.brief;
  const disabled = !isConnected || !sdk?.hasJobBoard || jobsFull || rentBlocked || !title.trim() || tooLong || team.length > maxAgents;

  return (
    <div className="page py-10">
      <SectionTitle
        eyebrow={found ? `Suggested job · ${found.domain.name}` : "New job"}
        title={found ? "Review and create your job" : "Create a job"}
        sub={found ? "Everything is pre-filled from the suggestion. Replace the <placeholders> with your details — or create it as is and edit later." : "Describe the job and pick the agents who will work on it."}
      />
      <JobQuota className="mt-6" />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-6">
          <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
            <div>
              <p className="label">Domain</p>
              <div className="flex flex-wrap gap-2">
                {domains.map((d) => (
                  <button key={d.id} type="button" onClick={() => setDomainId(d.id)} className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", d.id === domainId ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2 hover:text-ink")}>
                    <DomainIcon icon={d.icon} className="h-4 w-4" /> {d.name}
                  </button>
                ))}
              </div>
              {!found && domain && (
                <p className="mt-2 text-xs text-ink-3">
                  Suggestions in {domain.name}:{" "}
                  {domain.jobs.map((j, i) => (
                    <span key={j.id}>{i > 0 && " · "}<Link className="text-brand hover:underline" href={`/jobs/new?template=${j.id}`}>{j.title.replace(/<[^>]*>/g, "…")}</Link></span>
                  ))}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-end justify-between">
                <label className="label" htmlFor="title">Job title</label>
                <span className="mb-1.5 text-xs text-ink-3">{title.length}/{MAX.title}</span>
              </div>
              <input id="title" className="input" required maxLength={MAX.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Investment research for <company>" />
            </div>

            <div>
              <div className="flex items-end justify-between">
                <label className="label" htmlFor="brief">Brief — goal, context, audience</label>
                <span className="mb-1.5 text-xs text-ink-3">{brief.length}/{MAX.brief}</span>
              </div>
              <textarea id="brief" rows={5} className="input" maxLength={MAX.brief} value={brief} onChange={(e) => setBrief(e.target.value)} />
            </div>

            <div>
              <div className="flex items-end justify-between">
                <p className="label">Team</p>
                <span className={clsx("mb-1.5 text-xs", team.length > maxAgents ? "text-bad" : "text-ink-3")}>{team.length}/{l.unlimited ? "∞" : maxAgents} agents · {planLabel(plan)}</span>
              </div>
              <ul className="divide-y divide-line rounded-sm border border-line">
                {team.length === 0 && <li className="p-3 text-sm text-ink-3">No agents yet — add at least one below.</li>}
                {team.map((id, i) => {
                  const rented = canHire.data?.[i];
                  const task = taskOf(id);
                  return (
                    <li key={id.toString()} className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{nameOf(id)} <span className="text-xs text-ink-3">#{id.toString()}</span></p>
                          <p className={clsx("text-xs", rented ? "text-ok" : "text-ink-3")}>
                            {rented === undefined ? "…" : rented ? <><Check className="inline h-3 w-3" /> already yours to use</> : `will be rented · ${fmtUsd(price)} ${TOKEN_SYMBOL} / 30 days`}
                          </p>
                        </div>
                        <button type="button" title="Remove" className="rounded-sm p-1 text-ink-3 hover:bg-surface-2 hover:text-bad" onClick={() => setTeam(team.filter((x) => x !== id))}><X className="h-4 w-4" /></button>
                      </div>
                      {task && (
                        <p className="mt-2 rounded-sm bg-surface-2 p-2 text-xs text-ink-2"><Sparkles className="mr-1 inline h-3 w-3 text-brand" />First task: {task}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {suggested.some((s) => s.agentId === undefined) && (
                <p className="mt-2 text-xs text-warn">Some suggested catalog agents aren&apos;t registered on this network yet — run <code className="mono">npm run catalog:register</code>.</p>
              )}
              <div className="mt-3 flex gap-2">
                <select className="input" value={picker} onChange={(e) => setPicker(e.target.value)} disabled={team.length >= maxAgents}>
                  <option value="">{team.length >= maxAgents ? `Plan limit: ${maxAgents} agents per job` : "Add another agent…"}</option>
                  {candidates.map((a) => <option key={a.id.toString()} value={a.id.toString()}>#{a.id.toString()} · {nameOf(a.id)}</option>)}
                </select>
                <Button type="button" variant="secondary" disabled={!picker || team.length >= maxAgents} onClick={() => { setTeam([...team, BigInt(picker)]); setPicker(""); }}>Add</Button>
              </div>
            </div>

            {isConnected && <Funding need={rentCost} needLabel={`renting ${toRent.length} agent${toRent.length === 1 ? "" : "s"}`} />}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={create.isPending} disabled={disabled}>
                {!isConnected ? "Connect a wallet first" : toRent.length ? `Rent ${toRent.length} & create job · ${fmtUsd(rentCost)} ${TOKEN_SYMBOL}` : "Create job"}
              </Button>
              {create.isPending && <span className="text-xs text-ink-3">Confirm {toRent.length ? `${toRent.length} rental${toRent.length === 1 ? "" : "s"}, then ` : ""}the job in your wallet…</span>}
            </div>
            {jobsFull && <p className="text-sm text-bad">Your {planLabel(plan)} plan allows {l.jobs} open job{l.jobs === 1 ? "" : "s"}. Close one or <Link className="text-brand" href="/pricing">upgrade</Link>.</p>}
            {rentBlocked && <p className="text-sm text-bad">Your plan can rent {rentSlotsLeft} more agent{rentSlotsLeft === 1 ? "" : "s"}. Remove some from the team or <Link className="text-brand" href="/pricing">upgrade</Link>.</p>}
            {!sdk?.hasJobBoard && <p className="text-sm text-warn">The JobBoard isn&apos;t deployed on this network yet (run <code className="mono">npm run jobs:monad</code>).</p>}
          </form>
        </Card>

        <aside className="space-y-4">
          <Card className="p-5">
            <p className="font-semibold">What happens next</p>
            <ol className="mt-3 space-y-2 text-sm text-ink-2">
              <li>1. Agents you don&apos;t rent yet are rented for 30 days (90% goes to their creators).</li>
              <li>2. The job is saved on-chain with its team.</li>
              <li>3. On the job page, run each agent&apos;s first task in one click — fee 0.1 {TOKEN_SYMBOL}, refunded with coverage if CRE fails it.</li>
            </ol>
          </Card>
          <Card className="p-5 text-sm">
            <p className="font-semibold">Plan limits</p>
            <table className="mt-3 w-full text-left">
              <thead className="text-xs text-ink-3"><tr><th className="font-medium">Plan</th><th className="font-medium">Jobs</th><th className="font-medium">Agents / job</th></tr></thead>
              <tbody>
                {(["Free", "Pro", "Vip"] as const).map((p) => (
                  <tr key={p} className={clsx(p === plan && "font-semibold text-brand")}>
                    <td className="py-1">{planLabel(p)}</td><td>{JOB_PLAN_LIMITS[p].jobs}</td><td>{JOB_PLAN_LIMITS[p].agentsPerJob}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </aside>
      </div>
    </div>
  );
}
