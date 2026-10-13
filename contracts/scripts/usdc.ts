/** Circle's USDC on Monad testnet (monad-crypto/token-list + developers.circle.com · 6 decimals). */
export const MONAD_TESTNET_USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

/** USDC_ADDRESS env → known testnet USDC → a fresh MockStable (local dev). */
export async function resolveUsdc(chainId: number, deploy: (name: string, args?: unknown[]) => Promise<string>) {
  if (process.env.USDC_ADDRESS) return process.env.USDC_ADDRESS;
  if (chainId === 10143) return MONAD_TESTNET_USDC;
  return deploy("MockStable", ["USD Coin (local mock)", "USDC", 6]);
}
