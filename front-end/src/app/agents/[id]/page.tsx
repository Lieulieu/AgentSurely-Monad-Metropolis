"use client";

import { use, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ArrowRight } from "lucide-react";
import { fmtPct, fmtUsd, toUnits, TOKEN_SYMBOL } from "@agentsurely/sdk";
import { AgentAvatar, BondMeter, JobsTable, Reputation } from "@/components/domain";
import { Address } from "@/components/Address";
import { Button, ButtonLink, Card, Empty, Skeleton, Stat } from "@/components/ui";
import { useAgent, useErc8004, useJobs, useListing, usePlaybooks, useSubscription } from "@/lib/queries";
import { PlaybookEditor, PlaybookList } from "@/components/Playbooks";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agentId = BigInt(id);
  const { data: agent, isLoading, error } = useAgent(agentId);
  const jobs = useJobs({ agentId });
  const { address } = useAccount();
  const isOwner = !!agent && !!address && agent.owner.toLowerCase() === address.toLowerCase();

  if (isLoading) return <div className="page py-10"><Skeleton className="h-64" /></div>;
  if (error || !agent) return <div className="page py-10"><Empty title={`Agent #${id} not found`} /></div>;

  const total = agent.stats.passed + agent.stats.failed + agent.stats.expired;
  const skills = (agent.profile.skills as string[] | undefined) ?? [];

  return (
    <div className="page py-10">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-start gap-4">
              <AgentAvatar name={agent.profile.name} id={agent.id} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold">{agent.profile.name}</h1>
                  <Reputation bps={agent.reputationBps} jobs={total} />
                </div>
                <p className="mt-1 text-sm text-ink-3">ERC-8004 agent #{agent.id.toString()} · owner <Address value={agent.owner} /></p>
                {agent.profile.description && <p className="mt-3 text-ink-2">{String(agent.profile.description)}</p>}
                {skills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {skills.map((s) => <span key={s} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-2">{s}</span>)}
                  </div>
                )}
              </div>
              <ButtonLink href={`/hire?agent=${agent.id}`}>Hire <ArrowRight className="h-4 w-4" /></ButtonLink>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6 border-t border-line pt-6 sm:grid-cols-5">
              <Stat label="Pass rate" value={total ? fmtPct(agent.reputationBps) : "—"} hint={`${total} verified jobs`} />
              <Stat label="Passed / failed" value={`${agent.stats.passed} / ${agent.stats.failed + agent.stats.expired}`} />
              <Stat label="Earned" value={fmtUsd(agent.stats.earned)} hint={TOKEN_SYMBOL} />
              <Stat label="Slashed" value={fmtUsd(agent.stats.slashed)} hint={TOKEN_SYMBOL} />
              <Stat label="Rewards" value={fmtUsd(agent.rewardsEarned)} hint="mUSD · per passed job" />
            </div>
          </Card>

          <div id="playbooks" className="scroll-mt-24">
            <h2 className="mb-1 text-lg font-semibold">What you can run with this agent</h2>
            <p className="mb-3 text-sm text-ink-2">Ready-to-run tasks. Creator playbooks are published on-chain and voted by renters.</p>
            {isOwner ? <PlaybookEditor agentId={agent.id} /> : <AgentPlaybooks agentId={agent.id} skills={skills} />}
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold">Job history</h2>
            {jobs.data && jobs.data.length > 0 ? <JobsTable jobs={jobs.data} /> : <Empty title="No jobs yet">Hire this agent to create its first bonded job.</Empty>}
          </div>
        </div>

        <aside className="w-full space-y-6 lg:w-[360px]">
          <Card className="p-6">
            <p className="eyebrow">Performance bond</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{fmtUsd(agent.bond.total)} <span className="text-base font-normal text-ink-3">{TOKEN_SYMBOL}</span></p>
            <div className="mt-4"><BondMeter agent={agent} /></div>
            <p className="mt-4 text-xs text-ink-3">Coverage is locked per job and returned when the CRE verdict passes. Withdrawals wait 24h and stay slashable.</p>
          </Card>
          <Erc8004Card agentId={agent.id} />
          {isOwner && <OwnerPanel agentId={agent.id} available={agent.bond.available} pending={agent.bond.pendingWithdraw} unlockAt={agent.bond.unlockAt} />}
          {isOwner && <ListingPanel agentId={agent.id} />}
        </aside>
      </div>
    </div>
  );
}

function AgentPlaybooks({ agentId, skills }: { agentId: bigint; skills: string[] }) {
  const books = usePlaybooks(agentId, skills);
  return <PlaybookList agentId={agentId} entries={books.data ?? []} loading={books.isLoading} />;
}

function Erc8004Card({ agentId }: { agentId: bigint }) {
  const sdk = useSdk();
  const { data } = useErc8004(agentId);
  const a = sdk?.addresses;
  if (!a?.ReputationRegistry && !a?.ValidationRegistry) return null;
  return (
    <Card className="p-6">
      <p className="eyebrow">ERC-8004 record</p>
      <p className="mt-1 text-sm text-ink-2">Every verdict is written to the agent&apos;s public ERC-8004 registries by the vault, so other apps can read it.</p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Feedback" value={data ? data.feedbackCount : "—"} hint={data?.feedbackCount ? `avg score ${Math.round(data.averageScore)}` : "Reputation Registry"} />
        <Stat label="Validations" value={data ? data.validations : "—"} hint={data?.validations ? `avg ${data.averageValidation}/100` : "Validation Registry"} />
      </div>
      <div className="mt-4 space-y-1 text-xs text-ink-3">
        {a.ReputationRegistry && <p className="flex flex-wrap items-center gap-2">Reputation <Address value={a.ReputationRegistry} /></p>}
        {a.ValidationRegistry && <p className="flex flex-wrap items-center gap-2">Validation <Address value={a.ValidationRegistry} /></p>}
      </div>
    </Card>
  );
}

function OwnerPanel({ agentId, available, pending, unlockAt }: { agentId: bigint; available: bigint; pending: bigint; unlockAt: number }) {
  const sdk = useSdk();
  const [amount, setAmount] = useState("0.5");
  const deposit = useTx("Deposit bond", (v: string) => sdk!.depositBond(agentId, toUnits(v)));
  const request = useTx("Request withdrawal", (v: string) => sdk!.requestWithdraw(agentId, toUnits(v)));
  const withdraw = useTx("Withdraw", () => sdk!.withdraw(agentId));
  const unlocked = useMemo(() => Date.now() / 1000 >= unlockAt, [unlockAt]);

  return (
    <Card className="p-6">
      <p className="font-semibold">Manage bond</p>
      <p className="mt-1 text-sm text-ink-2">You own this agent.</p>
      <label className="label mt-4" htmlFor="amt">Amount ({TOKEN_SYMBOL})</label>
      <input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button loading={deposit.isPending} onClick={() => deposit.mutate(amount)}>Deposit</Button>
        <Button variant="secondary" loading={request.isPending} disabled={available === 0n} onClick={() => request.mutate(amount)}>Withdraw</Button>
      </div>
      {pending > 0n && (
        <div className="mt-4 rounded-sm bg-warn-soft p-3 text-sm">
          <p>{fmtUsd(pending)} {TOKEN_SYMBOL} queued · {unlocked ? "ready" : `unlocks ${new Date(unlockAt * 1000).toLocaleString()}`}</p>
          <Button className="mt-2 w-full" variant="secondary" disabled={!unlocked} loading={withdraw.isPending} onClick={() => withdraw.mutate(undefined)}>Claim withdrawal</Button>
        </div>
      )}
    </Card>
  );
}

/** upgrade-02: count the agent against your plan and list it for rent ($1 / 30 days, 90% to you). */
function ListingPanel({ agentId }: { agentId: bigint }) {
  const sdk = useSdk();
  const { address } = useAccount();
  const sub = useSubscription(address);
  const listing = useListing(agentId);
  const register = useTx("Add to plan", () => sdk!.registerWithPlan(agentId));
  const setListed = useTx("Update listing", (on: boolean) => sdk!.setListed(agentId, on));
  if (!sdk?.addresses.SubscriptionManager || !sub.data) return null;
  const registered = sub.data.created.includes(agentId);
  const isListed = sub.data.listed.includes(agentId);
  const { limits } = sub.data;
  return (
    <Card className="p-6">
      <p className="font-semibold">Rent out</p>
      <p className="mt-1 text-sm text-ink-2">
        Created {sub.data.created.length}/{limits.create} · listed {sub.data.listed.length}/{limits.list} on your {sub.data.plan === "Vip" ? "VIP" : sub.data.plan} plan.
      </p>
      {!registered ? (
        <Button className="mt-4 w-full" loading={register.isPending} disabled={sub.data.created.length >= limits.create} onClick={() => register.mutate(undefined)}>
          Add to my plan
        </Button>
      ) : isListed ? (
        <>
          <p className="mt-3 text-sm">{listing.data?.forRent ? "Listed — others can rent it for $1 / 30 days." : "Listed, but paused: your plan no longer covers all listings."}</p>
          <Button className="mt-3 w-full" variant="secondary" loading={setListed.isPending} onClick={() => setListed.mutate(false)}>Unlist</Button>
        </>
      ) : sub.data.listed.length < limits.list ? (
        <Button className="mt-4 w-full" loading={setListed.isPending} onClick={() => setListed.mutate(true)}>List for rent · $1 / 30 days</Button>
      ) : (
        <ButtonLink href="/pricing" variant="secondary" className="mt-4 w-full">Listing needs PRO (5) or VIP (30)</ButtonLink>
      )}
    </Card>
  );
}
