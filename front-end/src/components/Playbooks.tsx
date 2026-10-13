"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { BadgeCheck, Eye, EyeOff, Pencil, Play, Plus, Sparkles, ThumbsUp } from "lucide-react";
import clsx from "clsx";
import type { OnchainPlaybook, Playbook, PlaybookEntry } from "@agentsurely/sdk";
import { useOwnerPlaybooks, usePlaybookVotes } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";
import { Button, ButtonLink, Card } from "./ui";

export const LIMITS = { title: 80, outcome: 200, template: 2000, active: 10 } as const;

export const runHref = (agentId: bigint, template: string) => `/hire?agent=${agentId}&spec=${encodeURIComponent(template)}`;

/** "By creator" (on-chain, voted) vs AgentSurely starter task. */
export function SourceBadge({ entry }: { entry: Pick<PlaybookEntry, "source"> }) {
  return entry.source === "creator" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand"><BadgeCheck className="h-3 w-3" /> by creator</span>
  ) : (
    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-3">starter</span>
  );
}

/** Renter's "useful" vote — one per wallet per playbook, renters only (enforced on-chain). */
export function UsefulButton({ p, voted, canVote }: { p: OnchainPlaybook; voted: boolean; canVote: boolean }) {
  const sdk = useSdk();
  const vote = useTx("Mark playbook useful", () => sdk!.markPlaybookUseful(p.agentId, p.index));
  const title = voted ? "You marked this useful" : canVote ? "Tell other renters this task worked for you" : "Rent this agent to vote";
  return (
    <button
      type="button"
      title={title}
      disabled={voted || !canVote || vote.isPending}
      onClick={() => vote.mutate(undefined)}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums transition",
        voted ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2",
        canVote && !voted && "hover:border-brand hover:text-brand",
        (!canVote || vote.isPending) && !voted && "opacity-60"
      )}
    >
      <ThumbsUp className="h-3 w-3" /> {p.useful + (vote.isSuccess && !voted ? 1 : 0)}
    </button>
  );
}

/** Ready-to-run tasks for one agent: Run fills /hire, creator playbooks can be voted useful. */
export function PlaybookList({ agentId, entries, loading }: { agentId: bigint; entries: PlaybookEntry[]; loading?: boolean }) {
  const { address } = useAccount();
  const [open, setOpen] = useState<string | null>(null);
  const indexes = entries.flatMap((e) => (e.onchain ? [e.onchain.index] : []));
  const votes = usePlaybookVotes(agentId, indexes, address);
  if (loading) return <div className="h-24 animate-pulse rounded-sm bg-surface-2" />;
  return (
    <ul className="divide-y divide-line rounded-sm border border-line">
      {entries.map((p) => {
        const key = `${p.source}-${p.onchain?.index ?? p.title}`;
        return (
          <li key={key} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === key ? null : key)}>
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{p.title} <SourceBadge entry={p} /></p>
                <p className="text-xs text-ink-3">You get: {p.outcome || "—"}</p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {p.onchain && <UsefulButton p={p.onchain} voted={!!votes.data?.voted.has(p.onchain.index)} canVote={!!votes.data?.canVote} />}
                <ButtonLink href={runHref(agentId, p.template)} className="!px-3 !py-1.5 text-xs"><Play className="h-3.5 w-3.5" /> Run</ButtonLink>
              </div>
            </div>
            {open === key && <pre className="mt-2 whitespace-pre-wrap rounded-sm bg-surface-2 p-2 font-sans text-xs text-ink-2">{p.template}</pre>}
          </li>
        );
      })}
    </ul>
  );
}

const EMPTY: Playbook = { title: "", outcome: "", template: "" };

/** Owner tools: publish, edit, hide/show playbooks in the PlaybookRegistry (max 10 visible). */
export function PlaybookEditor({ agentId }: { agentId: bigint }) {
  const sdk = useSdk();
  const books = useOwnerPlaybooks(agentId);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const toggle = useTx("Update playbook", (p: OnchainPlaybook) => sdk!.setPlaybookActive(agentId, p.index, !p.active));
  if (!sdk?.hasPlaybookMarket) {
    return (
      <Card className="p-5 text-sm text-ink-2">
        The playbook market isn&apos;t deployed on this network yet. Run <code className="mono">npm run playbooks:monad</code> to enable it.
      </Card>
    );
  }
  const list = books.data ?? [];
  const active = list.filter((p) => p.active).length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-brand" /> Your playbooks</p>
          <p className="text-xs text-ink-3">Show renters what to run with this agent. {active}/{LIMITS.active} visible · stored on-chain · renters vote them useful.</p>
        </div>
        {editing !== "new" && (
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" disabled={active >= LIMITS.active} onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> New playbook
          </Button>
        )}
      </div>
      {editing === "new" && <PlaybookForm agentId={agentId} onDone={() => setEditing(null)} />}
      {list.length === 0 && editing !== "new" && <p className="mt-4 text-sm text-ink-2">No playbooks yet. Renters see AgentSurely starter tasks until you publish your own.</p>}
      <ul className="mt-4 space-y-3">
        {list.map((p) => (
          <li key={p.index} className={clsx("rounded-sm border border-line p-3", !p.active && "opacity-60")}>
            {editing === p.index ? (
              <PlaybookForm agentId={agentId} existing={p} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.title} {!p.active && <span className="text-xs text-ink-3">(hidden)</span>}</p>
                  <p className="text-xs text-ink-3">You get: {p.outcome || "—"} · <ThumbsUp className="inline h-3 w-3" /> {p.useful} useful</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="secondary" className="!px-2 !py-1 text-xs" title="Edit" onClick={() => setEditing(p.index)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="secondary" className="!px-2 !py-1 text-xs" title={p.active ? "Hide from renters" : "Show to renters"} loading={toggle.isPending && toggle.variables?.index === p.index} disabled={!p.active && active >= LIMITS.active} onClick={() => toggle.mutate(p)}>
                    {p.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlaybookForm({ agentId, existing, onDone }: { agentId: bigint; existing?: OnchainPlaybook; onDone: () => void }) {
  const sdk = useSdk();
  const [form, setForm] = useState<Playbook>(existing ? { title: existing.title, outcome: existing.outcome, template: existing.template } : EMPTY);
  const save = useTx(existing ? "Edit playbook" : "Publish playbook", async () => {
    const p = { title: form.title.trim(), outcome: form.outcome.trim(), template: form.template.trim() };
    if (existing) await sdk!.editPlaybook(agentId, existing.index, p);
    else await sdk!.publishPlaybook(agentId, p);
    onDone();
  });
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const over = bytes(form.title) > LIMITS.title || bytes(form.outcome) > LIMITS.outcome || bytes(form.template) > LIMITS.template;
  const field = (k: keyof Playbook, label: string, max: number, rows?: number, placeholder?: string) => (
    <div>
      <div className="flex items-end justify-between">
        <label className="label" htmlFor={`pb-${k}`}>{label}</label>
        <span className={clsx("mb-1.5 text-xs", bytes(form[k]) > max ? "text-bad" : "text-ink-3")}>{bytes(form[k])}/{max}</span>
      </div>
      {rows ? (
        <textarea id={`pb-${k}`} rows={rows} className="input" placeholder={placeholder} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      ) : (
        <input id={`pb-${k}`} className="input" placeholder={placeholder} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      )}
    </div>
  );
  return (
    <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      {field("title", "Task name", LIMITS.title, undefined, "Weekly competitor brief")}
      {field("outcome", "What the renter gets", LIMITS.outcome, undefined, "5 bullet points with sources and one recommendation")}
      {field("template", "Task template (renters edit the <details> before running)", LIMITS.template, 4, "Summarise this week's news about <company> for a busy founder…")}
      <div className="flex gap-2">
        <Button type="submit" className="!px-3 !py-1.5 text-xs" loading={save.isPending} disabled={over || !form.title.trim() || !form.template.trim()}>{existing ? "Save" : "Publish on-chain"}</Button>
        <Button type="button" variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
