"use client";

import { useMemo } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { AgentSurelyClient } from "@agentsurely/sdk";
import type { PublicClient } from "viem";
import { CHAIN_ID } from "./wagmi";

export const isDeployed = AgentSurelyClient.isDeployed(CHAIN_ID);

/** SDK bound to the active chain; writes are enabled once a wallet is connected. */
export function useSdk() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: CHAIN_ID });
  return useMemo(() => {
    if (!publicClient || !isDeployed) return null;
    return new AgentSurelyClient({
      publicClient: publicClient as PublicClient,
      walletClient: walletClient as never,
    });
  }, [publicClient, walletClient]);
}
