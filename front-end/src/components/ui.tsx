import clsx from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { JobStatus } from "@agentsurely/sdk";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "light";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover shadow-sm",
  secondary: "border border-line bg-surface text-ink hover:border-brand/40 hover:text-brand",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-bad/30 bg-bad-soft text-bad hover:bg-bad hover:text-white",
  light: "bg-white text-night hover:bg-brand-soft",
};
const base =
  "inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button className={clsx(base, variants[variant], className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={clsx(base, variants[variant], className)} {...rest} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, sub, className }: { eyebrow?: string; title: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
      {sub && <p className="mt-2 max-w-2xl text-ink-2">{sub}</p>}
    </div>
  );
}

const statusStyle: Record<JobStatus, string> = {
  None: "bg-surface-2 text-ink-3",
  Open: "bg-brand-soft text-brand",
  Submitted: "bg-warn-soft text-warn",
  Passed: "bg-ok-soft text-ok",
  Failed: "bg-bad-soft text-bad",
  Expired: "bg-bad-soft text-bad",
  Refunded: "bg-surface-2 text-ink-2",
};
const statusLabel: Record<JobStatus, string> = {
  None: "—",
  Open: "In progress",
  Submitted: "Verifying",
  Passed: "Passed · paid",
  Failed: "Failed · slashed",
  Expired: "Expired · slashed",
  Refunded: "Refunded",
};

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", statusStyle[status])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full bg-current", status === "Submitted" && "animate-pulse")} />
      {statusLabel[status]}
    </span>
  );
}

export function Stat({ label, value, hint, dark }: { label: string; value: ReactNode; hint?: string; dark?: boolean }) {
  return (
    <div>
      <p className={clsx("text-xs font-medium uppercase tracking-wider", dark ? "text-white/50" : "text-ink-3")}>{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular-nums", dark ? "text-white" : "text-ink")}>{value}</p>
      {hint && <p className={clsx("mt-0.5 text-xs", dark ? "text-white/40" : "text-ink-3")}>{hint}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-sm bg-surface-2", className)} />;
}
