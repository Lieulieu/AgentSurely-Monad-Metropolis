"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useSdk } from "./sdk";

const REFRESH = 4_000; // Monad blocks are ~400ms; poll gently.

export function useAgents() {
  const sdk = useSdk();
  return useQuery({ queryKey: ["agents"], enabled: !!sdk, refetchInterval: REFRESH, queryFn: () => sdk!.listAgents() });
}

export function useAgent(id: bigint) {
  const sdk = useSdk();
  return useQuery({ queryKey: ["agent", id.toString()], enabled: !!sdk, refetchInterval: REFRESH, queryFn: () => sdk!.getAgent(id) });
}

/** ERC-8004 Reputation + Validation records this vault wrote for an agent. */
export function useErc8004(id: bigint) {
  const sdk = useSdk();
  return useQuery({ queryKey: ["erc8004", id.toString()], enabled: !!sdk, refetchInterval: 8_000, queryFn: () => sdk!.getErc8004Summary(id) });
}

export function useJobs(filter: { agentId?: bigint; client?: Address } = {}) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["jobs", filter.agentId?.toString(), filter.client],
    enabled: !!sdk,
    refetchInterval: REFRESH,
    queryFn: () => sdk!.listJobs(filter),
  });
}

export function useJob(id: bigint) {
  const sdk = useSdk();
  return useQuery({ queryKey: ["job", id.toString()], enabled: !!sdk, refetchInterval: 2_000, queryFn: () => sdk!.getJob(id) });
}

export function useBalance(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["balance", owner],
    enabled: !!sdk && !!owner,
    refetchInterval: REFRESH,
    queryFn: () => sdk!.tokenBalance(owner!),
  });
}

/** mUSD rewards held by a wallet (reward-only token). */
export function useRewardBalance(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["rewards", owner],
    enabled: !!sdk && !!owner,
    refetchInterval: 8_000,
    queryFn: () => sdk!.rewardBalance(owner!),
  });
}

/** USDC (money) + mUSD (rewards) balances of a wallet. */
export function useTokenBalances(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["balances", owner],
    enabled: !!sdk && !!owner,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [USDC, mUSD] = await Promise.all([sdk!.tokenBalance(owner!), sdk!.rewardBalance(owner!)]);
      return { USDC, mUSD };
    },
  });
}

/** Protocol-wide numbers for the landing page. */
export function useProtocolStats() {
  const agents = useAgents();
  const jobs = useJobs();
  const a = agents.data ?? [];
  const j = jobs.data ?? [];
  return {
    loading: agents.isLoading || jobs.isLoading,
    agents: a.length,
    bonded: a.reduce((s, x) => s + x.bond.total, 0n),
    verified: j.filter((x) => x.status === "Passed" || x.status === "Failed").length,
    slashed: a.reduce((s, x) => s + x.stats.slashed, 0n),
  };
}

/** Plan, expiry, limits, created/listed agents and active rentals of a wallet. */
export function useSubscription(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["subscription", owner],
    enabled: !!sdk && !!owner && !!sdk.addresses.SubscriptionManager,
    refetchInterval: 8_000,
    queryFn: () => sdk!.getSubscription(owner!),
  });
}

/** Rent per agent per 30 days + platform fee (bps). */
export function useRentTerms() {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["rentTerms"],
    enabled: !!sdk && !!sdk.addresses.SubscriptionManager,
    staleTime: 60_000,
    queryFn: () => sdk!.rentTerms(),
  });
}

/** Whether an agent is listed for rent right now and who created it. */
export function useListing(agentId?: bigint) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["listing", agentId?.toString()],
    enabled: !!sdk && agentId !== undefined && !!sdk.addresses.SubscriptionManager,
    refetchInterval: 8_000,
    queryFn: async () => {
      const [forRent, creator] = await Promise.all([sdk!.forRent(agentId!), sdk!.creatorOf(agentId!)]);
      return { forRent, creator };
    },
  });
}

export function usePlanPrices() {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["plans"],
    enabled: !!sdk && !!sdk.addresses.SubscriptionManager,
    staleTime: 60_000,
    queryFn: () => sdk!.planPrices(),
  });
}

/** upgrade-07: what a renter can run with an agent — creator playbooks (on-chain) first, then starter ones. */
export function usePlaybooks(agentId?: bigint, skills: string[] = []) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["playbooks", agentId?.toString(), skills.join(",")],
    enabled: !!sdk && agentId !== undefined,
    refetchInterval: 15_000,
    queryFn: () => sdk!.playbooksForAgent(agentId!, skills),
  });
}

/** All of an agent's on-chain playbooks, hidden ones included (owner view). */
export function useOwnerPlaybooks(agentId: bigint) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["playbooks-owner", agentId.toString()],
    enabled: !!sdk?.hasPlaybookMarket,
    refetchInterval: 15_000,
    queryFn: () => sdk!.getPlaybooks(agentId, { includeInactive: true }),
  });
}

/** Every active creator playbook across agents, most useful first. */
export function usePlaybookMarket() {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["playbook-market"],
    enabled: !!sdk?.hasPlaybookMarket,
    refetchInterval: 20_000,
    queryFn: () => sdk!.playbookMarket(),
  });
}

/** Can this wallet vote on the agent's playbooks (renter, not owner), and which ones did it vote already. */
export function usePlaybookVotes(agentId: bigint, indexes: number[], voter?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["playbook-votes", agentId.toString(), indexes.join(","), voter],
    enabled: !!sdk?.hasPlaybookMarket && !!voter && indexes.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [canVote, ...voted] = await Promise.all([
        sdk!.canVotePlaybook(voter!, agentId),
        ...indexes.map((i) => sdk!.votedUseful(agentId, i, voter!)),
      ]);
      return { canVote, voted: new Set(indexes.filter((_, k) => voted[k])) };
    },
  });
}

/** upgrade-08: JobBoard — jobs of a wallet (newest first). */
export function useBoardJobs(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["board-jobs", owner],
    enabled: !!sdk?.hasJobBoard && !!owner,
    refetchInterval: 10_000,
    queryFn: () => sdk!.listBoardJobs(owner!),
  });
}

export function useBoardJob(id?: bigint) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["board-job", id?.toString()],
    enabled: !!sdk?.hasJobBoard && id !== undefined,
    refetchInterval: 10_000,
    queryFn: () => sdk!.getBoardJob(id!),
  });
}

/** Wallet's job limits (plan) and open jobs. */
export function useJobLimits(owner?: Address) {
  const sdk = useSdk();
  return useQuery({
    queryKey: ["job-limits", owner],
    enabled: !!sdk?.hasJobBoard && !!owner,
    refetchInterval: 10_000,
    queryFn: () => sdk!.jobLimits(owner!),
  });
}
