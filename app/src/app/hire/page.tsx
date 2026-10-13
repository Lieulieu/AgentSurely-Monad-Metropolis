"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, fromUnits, toUnits, TOKEN_SYMBOL } from "@agentsurely/sdk";
import { AgentAvatar, NotDeployed, Reputation } from "@/components/domain";
import { Button, Card, SectionTitle } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAgents, useBoardJob, useListing, usePlaybooks } from "@/lib/queries";
import { Funding } from "@/components/Funding";
import { isDeployed, useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

const TEMPLATES = [
  "Summarise Monad's parallel execution model in 5 bullet points for a non-technical reader.",
  "Translate this product description into Vietnamese, keeping a friendly tone: 'Hire AI agents that put money behind their work.'",
  "Review this Solidity function for reentrancy risks and explain in 3 sentences: function withdraw() external { (bool ok,) = msg.sender.call{value: bal[msg.sender]}(\"\"); bal[msg.sender] = 0; }",
];

export default function HirePage() {
  return (
    <Suspense>
      <HireForm />
    </Suspense>
  );
}

function HireForm() {
  const params = useSearchParams();
  const router = useRouter();
  const sdk = useSdk();
  const { isConnected, address } = useAccount();
  const { data: agents } = useAgents();
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  const [spec, setSpec] = useState(params.get("spec") ?? TEMPLATES[0]);
  const [fee, setFee] = useState("0.1");
  const [coverage, setCoverage] = useState(0.25);
  const [hours, setHours] = useState("24");
  const [minScore, setMinScore] = useState(70);
  const [runAnyway, setRunAnyway] = useState(false);
  const placeholders = spec.match(/<[^<>\n]{1,40}>/g);

  useEffect(() => {
    if (!agentId && agents?.length) setAgentId(agents[0].id.toString());
  }, [agents, agentId]);

  const agent = useMemo(() => agents?.find((a) => a.id.toString() === agentId), [agents, agentId]);
  const catalogAgent = useMemo(() => (agentId ? sdk?.catalogAgentFor(BigInt(agentId)) : undefined), [sdk, agentId]);
  const gate = useQuery({
    queryKey: ["canHire", address, agentId],
    enabled: !!sdk && !!address && !!agentId,
    queryFn: () => sdk!.canHire(address!, BigInt(agentId)),
  });
  const listing = useListing(agentId ? BigInt(agentId) : undefined);
  const jobParam = params.get("job");
  const boardJob = useBoardJob(jobParam ? BigInt(jobParam) : undefined);
  const books = usePlaybooks(agentId ? BigInt(agentId) : undefined, (agent?.profile.skills as string[] | undefined) ?? []);
  const blocked = gate.data === false;
  const rentIt = useTx("Rent agent", () => sdk!.rent(BigInt(agentId), 1));
  const maxCoverage = agent ? Math.floor(fromUnits(agent.bond.available) * 100) / 100 : 0; // USDC, 2 decimals
  useEffect(() => {
    if (agent && coverage > maxCoverage) setCoverage(maxCoverage);
  }, [agent, maxCoverage, coverage]);

  const hire = useTx("Hire agent", async () => {
    const jobId = await sdk!.hire({
      agentId: BigInt(agentId),
      spec: spec.trim(),
      fee: toUnits(fee || "0"),
      coverage: toUnits(coverage.toFixed(2)),
      deadline: Math.floor(Date.now() / 1000) + Number(hours) * 3600,
      minScore,
    });
    router.push(`/jobs/${jobId}`);
    return jobId;
  });

  if (!isDeployed) return <div className="page py-10"><NotDeployed /></div>;

  return (
    <div className="page py-10">
      <SectionTitle eyebrow="New job" title="Run a task with your agent" sub="Pick a ready-made task or write your own. If the CRE verifier scores the output below your threshold, your fee and the agent's coverage are paid to you." />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-6">
          {jobParam && boardJob.data && (
            <p className="mb-6 rounded-sm bg-brand-soft px-3 py-2 text-sm text-brand">
              Task for job <Link className="font-semibold hover:underline" href={`/jobs/board/${jobParam}`}>#{jobParam} · {boardJob.data.title}</Link>
            </p>
          )}
          <form className="grid gap-6" onSubmit={(e) => { e.preventDefault(); hire.mutate(undefined); }}>
            {isConnected && (
              <Funding
                need={(fee ? toUnits(fee) : 0n) + (blocked && listing.data?.forRent ? 1_000_000n : 0n)}
                needLabel={blocked && listing.data?.forRent ? "the rental + job fee" : "the job fee"}
              />
            )}
            <div>
              <label className="label" htmlFor="agent">Agent</label>
              <select id="agent" className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {(agents ?? []).map((a) => (
                  <option key={a.id.toString()} value={a.id.toString()}>
                    #{a.id.toString()} · {a.profile.name} — {fmtUsd(a.bond.available, 2)} {TOKEN_SYMBOL} available
                  </option>
                ))}
              </select>
              {blocked ? (
                <div className="mt-2 text-sm text-bad">
                  {listing.data?.forRent ? (
                    <>You need to rent this agent first — 1 USDC / 30 days (90% goes to its creator).{" "}
                      <Button type="button" variant="secondary" loading={rentIt.isPending} onClick={() => rentIt.mutate(undefined)}>Rent for 30 days</Button>{" "}
                      <Link className="text-brand" href="/pricing">Rental limit reached? Upgrade</Link></>
                  ) : (
                    <>This agent isn&apos;t listed for rent. Only its creator can hire it (test agent).</>
                  )}
                </div>
              ) : catalogAgent ? (
                <p className="mt-2 text-xs text-ink-3">Catalog agent ({catalogAgent.tier}) · ported from {catalogAgent.source.project} ({catalogAgent.source.license})</p>
              ) : null}
            </div>
            <div>
              <div className="flex items-end justify-between">
                <label className="label" htmlFor="spec">Task</label>
                <span className="mb-1.5 text-xs text-ink-3">{spec.length}/4096</span>
              </div>
              <textarea id="spec" rows={5} maxLength={4096} required className={clsx("input", placeholders && "!border-warn")} value={spec} onChange={(e) => setSpec(e.target.value)} />
              {placeholders && (
                <div className="mt-2 rounded-sm bg-warn-soft p-3 text-sm text-warn">
                  Replace {placeholders.slice(0, 4).join(", ")}{placeholders.length > 4 ? "…" : ""} with your details — the agent can&apos;t guess them and a generic answer is likely to fail CRE verification.
                  <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                    <input type="checkbox" checked={runAnyway} onChange={(e) => setRunAnyway(e.target.checked)} className="accent-[rgb(var(--brand))]" /> Run anyway
                  </label>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {/* Playbooks: what this agent is good at — one click fills the task (edit the example details). */}
                {(books.data ?? []).map((p) => (
                  <button type="button" key={`${p.source}-${p.onchain?.index ?? p.title}`} title={`${p.source === "creator" ? "By the agent's creator · " : ""}You get: ${p.outcome}`} onClick={() => setSpec(p.template)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-brand hover:text-brand">
                    {p.source === "creator" && <span className="mr-1 text-brand">●</span>}{p.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="fee">Fee to agent ({TOKEN_SYMBOL})</label>
                <input id="fee" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="hours">Deadline (hours)</label>
                <input id="hours" className="input" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
            </div>
            <Range id="coverage" label="Coverage if it fails" value={coverage} min={0.05} max={Math.max(0.05, maxCoverage)} step={0.05} onChange={setCoverage} suffix={` ${TOKEN_SYMBOL}`} hint={`Up to ${maxCoverage.toLocaleString()} — the agent's free bond`} />
            <Range id="min" label="Minimum score to pass" value={minScore} min={1} max={100} step={1} onChange={setMinScore} suffix=" / 100" hint="LLM-judge rubric: correctness 40 · completeness 30 · constraints 20 · clarity 10" />
            <Button type="submit" disabled={!isConnected || !agent || maxCoverage < 0.05 || blocked || (!!placeholders && !runAnyway)} loading={hire.isPending} className="sm:justify-self-start">
              {isConnected ? "Hire & lock coverage" : "Connect a wallet first"}
            </Button>
          </form>
        </Card>

        <aside className="space-y-4">
          {agent && (
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <AgentAvatar name={agent.profile.name} id={agent.id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{agent.profile.name}</p>
                  <p className="mono text-ink-3">#{agent.id.toString()}</p>
                </div>
                <Reputation bps={agent.reputationBps} jobs={agent.stats.passed + agent.stats.failed + agent.stats.expired} />
              </div>
            </Card>
          )}
          <Card className="overflow-hidden">
            <div className="grid-night p-5 text-white">
              <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-brand-bright" /> Your protection</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{(coverage + Number(fee || 0)).toFixed(2)} <span className="text-base font-normal text-white/50">{TOKEN_SYMBOL}</span></p>
              <p className="mt-1 text-sm text-white/55">paid to you if the agent fails or misses the deadline</p>
            </div>
            <dl className="divide-y divide-line text-sm">
              <Row k="You pay now" v={`${Number(fee || 0).toLocaleString()} ${TOKEN_SYMBOL} (escrow)`} />
              <Row k="Agent bond locked" v={`${coverage.toFixed(2)} ${TOKEN_SYMBOL}`} />
              <Row k="Pass threshold" v={`${minScore}/100`} />
              <Row k="Verifier" v="Chainlink CRE · surely-judge" />
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function Range(p: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix: string; hint: string }) {
  return (
    <div>
      <div className="flex items-end justify-between">
        <label className="label" htmlFor={p.id}>{p.label}</label>
        <span className="mb-1.5 text-sm font-semibold tabular-nums">{p.value.toLocaleString()}{p.suffix}</span>
      </div>
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" />
      <p className="mt-1 text-xs text-ink-3">{p.hint}</p>
    </div>
  );
}
