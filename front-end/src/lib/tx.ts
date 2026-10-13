"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";

/** Wraps a write in a mutation with toasts and cache refresh. */
export function useTx<TArgs, TResult>(label: string, fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onMutate: () => toast.push({ kind: "info", text: `${label}… confirm in your wallet` }),
    onSuccess: () => {
      toast.push({ kind: "ok", text: `${label} confirmed` });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.push({ kind: "bad", text: humanError(e) }),
  });
}

/** Friendly text for custom errors of the AgentSurely contracts. */
const ERRORS: Record<string, string> = {
  JobLimitReached: "Your plan's job limit is reached — close a job or upgrade",
  AgentLimitReached: "Your plan's agents-per-job limit is reached — upgrade for more",
  CannotHireAgent: "Rent this agent first (1 USDC / 30 days)",
  AgentAlreadyOnJob: "This agent is already on the job",
  RentLimitReached: "Your plan's rental limit is reached — upgrade to rent more agents",
  NotListed: "This agent isn't listed for rent",
  ERC20InsufficientBalance: "Not enough USDC — use the faucet",
  TooManyActive: "Maximum 10 visible playbooks per agent",
  AlreadyVoted: "You already marked this playbook useful",
  NotRenter: "Only renters of this agent can vote",
};

export function humanError(e: Error): string {
  let cause: unknown = e;
  for (let i = 0; i < 6 && cause; i++) {
    const name = (cause as { data?: { errorName?: string } }).data?.errorName;
    if (name) return ERRORS[name] ?? name;
    cause = (cause as { cause?: unknown }).cause;
  }
  const m = (e as { shortMessage?: string }).shortMessage ?? e.message;
  if (/User rejected|denied/i.test(m)) return "Transaction rejected in wallet";
  const custom = m.match(/reverted with the following reason:\s*\n?(.+)|error\s+(\w+)\(/);
  return (custom?.[1] ?? custom?.[2] ?? m).slice(0, 160);
}
