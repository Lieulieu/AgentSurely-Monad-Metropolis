import clsx from "clsx";
import { Bot, Braces, CheckCheck, FileSignature, Radio, Scale } from "lucide-react";

const nodes = [
  { icon: Radio, title: "Log trigger", body: "SurelyVault emits ResultSubmitted on Monad", chip: "EVM" },
  { icon: Braces, title: "EVM read", body: "getJobForVerification → spec, output, hashes", chip: "EVM" },
  { icon: CheckCheck, title: "Deterministic checks", body: "State, keccak(spec/output), length", chip: "DON" },
  { icon: Bot, title: "LLM judge", body: "Rubric score 0–100, median across nodes", chip: "HTTP" },
  { icon: FileSignature, title: "Signed report", body: "abi.encode(jobId, score, reportHash, reason)", chip: "DON" },
  { icon: Scale, title: "onReport", body: "Forwarder → vault: pay agent or slash bond", chip: "EVM" },
];

/** The CRE workflow, drawn as the orchestration layer between Monad and the LLM. */
export function Pipeline({ dark }: { dark?: boolean }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {nodes.map((n, i) => (
        <li
          key={n.title}
          className={clsx(
            "relative min-w-0 break-words rounded border p-4",
            dark ? "border-night-line bg-night-2/80 text-white" : "border-line bg-surface"
          )}
        >
          <div className="flex items-center justify-between">
            <span className={clsx("grid h-9 w-9 place-items-center rounded-sm", dark ? "bg-brand/20 text-brand-bright" : "bg-brand-soft text-brand")}>
              <n.icon className="h-[18px] w-[18px]" />
            </span>
            <span className={clsx("mono rounded px-1.5 py-0.5 text-[10px]", dark ? "bg-white/5 text-white/50" : "bg-surface-2 text-ink-3")}>
              {String(i + 1).padStart(2, "0")} · {n.chip}
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold">{n.title}</p>
          <p className={clsx("mt-1 text-xs leading-relaxed", dark ? "text-white/55" : "text-ink-2")}>{n.body}</p>
        </li>
      ))}
    </ol>
  );
}
