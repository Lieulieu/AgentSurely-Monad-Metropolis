"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { fmtUsd, TOKEN_SYMBOL } from "@agentsurely/sdk";
import { Address } from "@/components/Address";
import { JobTimeline, ScoreGauge } from "@/components/domain";
import { Button, Card, Empty, Skeleton, StatusPill } from "@/components/ui";
import { useAgent, useJob } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: job, isLoading, error } = useJob(BigInt(id));
  const agent = useAgent(job?.agentId ?? 0n);
  const { address } = useAccount();

  if (isLoading) return <div className="page py-10"><Skeleton className="h-96" /></div>;
  if (error || !job) return <div className="page py-10"><Empty title={`Task #${id} not found`} /></div>;

  const now = Date.now() / 1000;
  const isAgentOwner = !!address && agent.data?.owner.toLowerCase() === address.toLowerCase();
  const expired = job.status === "Open" && now > job.deadline;

  return (
    <div className="page py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Task <span className="mono text-xl text-ink-3">#{job.id.toString()}</span></h1>
        <StatusPill status={job.status} />
        <span className="text-sm text-ink-3">
          for <Link href={`/agents/${job.agentId}`} className="font-medium text-brand hover:underline">{agent.data?.profile.name ?? `agent #${job.agentId}`}</Link>
        </span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="p-6">
            <p className="eyebrow">Task</p>
            <p className="mt-2 whitespace-pre-wrap text-ink">{job.spec}</p>
            <Hash label="spec hash" value={job.specHash} />
          </Card>

          <Card className="p-6">
            <p className="eyebrow">Agent output</p>
            {job.output ? (
              <>
                <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-sm bg-surface-2 p-4 font-sans text-sm leading-relaxed text-ink">{job.output}</pre>
                <Hash label="output hash" value={job.outputHash} />
                {address && job.client.toLowerCase() === address.toLowerCase() && <NextSteps output={job.output} agentId={job.agentId} status={job.status} />}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-3">Not delivered yet · deadline {new Date(job.deadline * 1000).toLocaleString()}</p>
            )}
            {isAgentOwner && job.status === "Open" && !expired && <SubmitBox jobId={job.id} />}
          </Card>
          {job.status === "Open" && <WaitingHelp jobId={job.id} agentId={job.agentId} spec={job.spec ?? ""} deadline={job.deadline} expired={expired} />}
        </div>

        <aside className="space-y-6">
          <Card className="p-6">
            <p className="eyebrow">CRE verdict</p>
            <div className="mt-4"><ScoreGauge score={job.score} min={job.minScore} status={job.status} /></div>
            {job.verdictReason && <p className="mono mt-4 rounded-sm bg-surface-2 p-3 text-xs text-ink-2">{job.verdictReason}</p>}
            {job.reportHash !== `0x${"0".repeat(64)}` && <Hash label="report hash" value={job.reportHash} />}
            {job.validationRequestHash && job.validationRequestHash !== `0x${"0".repeat(64)}` && <Hash label="ERC-8004 validation" value={job.validationRequestHash} />}
          </Card>

          <Card className="p-6">
            <JobTimeline job={job} />
          </Card>

          <Card className="divide-y divide-line text-sm">
            <Row k="Fee (escrow)" v={`${fmtUsd(job.fee)} ${TOKEN_SYMBOL}`} />
            <Row k="Coverage locked" v={`${fmtUsd(job.coverage)} ${TOKEN_SYMBOL}`} />
            <Row k="Deadline" v={new Date(job.deadline * 1000).toLocaleString()} />
            <div className="flex justify-between gap-4 px-5 py-3"><span className="text-ink-3">Client</span><Address value={job.client} /></div>
          </Card>

          <ClientActions jobId={job.id} canExpire={expired} canRefund={job.status === "Submitted" && now > job.submittedAt + 3600} />
        </aside>
      </div>
    </div>
  );
}

/** While a task waits for the agent: who delivers it, what happens next, and how the client gets paid back. */
function WaitingHelp({ jobId, agentId, spec, deadline, expired }: { jobId: bigint; agentId: bigint; spec: string; deadline: number; expired: boolean }) {
  const sdk = useSdk();
  const catalogAgent = sdk?.catalogAgentFor(agentId);
  const placeholders = spec.match(/<[^<>\n]{1,40}>/g);
  const hoursLeft = Math.max(0, Math.round((deadline - Date.now() / 1000) / 3600));
  if (expired) {
    return (
      <Card className="border-bad p-5 text-sm">
        <p className="font-semibold text-bad">The agent missed the deadline</p>
        <p className="mt-1 text-ink-2">Use <b>Deadline missed — claim coverage</b> on the right: your fee and the agent&apos;s coverage are paid to you and the agent&apos;s bond is slashed.</p>
      </Card>
    );
  }
  return (
    <Card className="p-5 text-sm">
      <p className="font-semibold">What happens next · about {hoursLeft} h left</p>
      <ol className="mt-2 space-y-1.5 text-ink-2">
        <li>1. {catalogAgent
          ? <>{catalogAgent.name} is a catalog agent: the AgentSurely operator&apos;s runner writes the answer with an LLM and submits it. Operator command: <code className="mono">scripts\run-cre-monad.cmd settle {jobId.toString()}</code></>
          : <>The agent&apos;s owner delivers the answer on this page (or with <code className="mono">sdk.submitResult</code>).</>}</li>
        <li>2. Chainlink CRE scores the answer. Pass → the agent is paid; fail → your fee and the coverage come back to you.</li>
        <li>3. If nobody delivers before the deadline, you can claim fee + coverage here.</li>
      </ol>
      {placeholders && (
        <p className="mt-3 rounded-sm bg-warn-soft p-3 text-warn">
          The task still contains {placeholders.join(", ")}. The agent can&apos;t guess what you meant, so the answer will be generic and is likely to fail verification (you would be refunded). Next time, replace the placeholders before running.
        </p>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 px-5 py-3"><span className="text-ink-3">{k}</span><span className="text-right font-medium">{v}</span></div>;
}

function Hash({ label, value }: { label: string; value: string }) {
  return <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">{label} <Address value={value} /></p>;
}

function SubmitBox({ jobId }: { jobId: bigint }) {
  const sdk = useSdk();
  const [text, setText] = useState("");
  const submit = useTx("Submit output", (t: string) => sdk!.submitResult(jobId, t));
  return (
    <div className="mt-4 border-t border-line pt-4">
      <label className="label" htmlFor="out">Deliver output (you own this agent)</label>
      <textarea id="out" rows={5} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the agent's result…" />
      <Button className="mt-2" disabled={text.trim().length < 10} loading={submit.isPending} onClick={() => submit.mutate(text)}>Submit for CRE verification</Button>
    </div>
  );
}

function ClientActions({ jobId, canExpire, canRefund }: { jobId: bigint; canExpire: boolean; canRefund: boolean }) {
  const sdk = useSdk();
  const expire = useTx("Claim coverage", () => sdk!.claimExpired(jobId));
  const refund = useTx("Refund", () => sdk!.refundUnverified(jobId));
  if (!canExpire && !canRefund) return null;
  return (
    <Card className="p-5">
      {canExpire && <Button variant="danger" className="w-full" loading={expire.isPending} onClick={() => expire.mutate(undefined)}>Deadline missed — claim coverage</Button>}
      {canRefund && <Button variant="secondary" className="w-full" loading={refund.isPending} onClick={() => refund.mutate(undefined)}>Verifier timed out — refund fee</Button>}
    </Card>
  );
}

/** After a result: use it, then keep the agent working (sustainable value for renters). */
function NextSteps({ output, agentId, status }: { output: string; agentId: bigint; status: string }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([output], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `agentsurely-agent-${agentId}-result.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mt-4 rounded-sm border border-line p-4 text-sm">
      <p className="font-semibold">Next steps</p>
      <p className="mt-1 text-ink-2">
        {status === "Passed"
          ? "Verified by Chainlink CRE — use it with confidence."
          : status === "Failed" || status === "Expired"
            ? "This result failed verification — your fee was refunded and you received the agent's coverage."
            : "Waiting for the verdict. You can already copy the draft."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => navigator.clipboard.writeText(output).then(() => setCopied(true))}>{copied ? "Copied" : "Copy result"}</Button>
        <Button variant="secondary" onClick={download}>Download .md</Button>
        <Link className="inline-flex items-center rounded-sm px-3 text-sm font-semibold text-brand hover:underline" href={`/workspace#agent-${agentId}`}>Run another task with this agent →</Link>
      </div>
    </div>
  );
}
