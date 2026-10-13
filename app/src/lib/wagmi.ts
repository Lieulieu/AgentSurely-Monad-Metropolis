import { http, createConfig } from "wagmi";
import { injected } from "@wagmi/core";
import { localhost, monadTestnet, rateLimitedHttp } from "@agentsurely/sdk";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? monadTestnet.id);
export const activeChain = CHAIN_ID === localhost.id ? localhost : monadTestnet;
const rpc = process.env.NEXT_PUBLIC_RPC_URL || undefined;
const isLocal = activeChain.id === localhost.id;

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  // Public Monad RPC allows ~15 req/s: throttle, and fold parallel reads into one Multicall3 call.
  transports: { [activeChain.id]: isLocal ? http(rpc) : rateLimitedHttp(rpc, 8) } as Record<number, ReturnType<typeof http>>,
  batch: isLocal ? undefined : { multicall: true },
  ssr: true,
});
