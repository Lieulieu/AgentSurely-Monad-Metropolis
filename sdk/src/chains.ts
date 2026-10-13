import { defineChain } from "viem";
import { hardhat, monadTestnet } from "viem/chains";

export { monadTestnet, hardhat };

/** Local Hardhat node (chainId 31337). */
export const localhost = defineChain({ ...hardhat, name: "Localhost" });

export const supportedChains = [monadTestnet, localhost] as const;

export const explorerTx = (chainId: number, hash: string) =>
  chainId === monadTestnet.id ? `${monadTestnet.blockExplorers?.default.url}/tx/${hash}` : undefined;
