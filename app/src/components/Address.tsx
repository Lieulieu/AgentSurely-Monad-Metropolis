"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { shortAddr } from "@agentsurely/sdk";
import clsx from "clsx";

export function Address({ value, full, className }: { value: string; full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={clsx("mono inline-flex items-center gap-1.5 text-ink-2 hover:text-brand", className)}
    >
      <span className={full ? "break-all text-left" : undefined}>{full ? value : shortAddr(value)}</span>
      {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-ok" /> : <Copy className="h-3.5 w-3.5 shrink-0 opacity-50" />}
    </button>
  );
}
