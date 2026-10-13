import { formatUnits, parseUnits } from "viem";

export const TOKEN_DECIMALS = 6;
/** Money on AgentSurely: USDC (bonds, fees, coverage, plans, rentals). */
export const TOKEN_SYMBOL = "USDC";
/** Reward-only token paid by the vault for passed jobs. */
export const REWARD_SYMBOL = "mUSD";
/** Circle's testnet faucet (choose Monad Testnet · 20 USDC / 2h per address). */
export const USDC_FAUCET_URL = "https://faucet.circle.com/";

export const toUnits = (v: string | number) => parseUnits(String(v), TOKEN_DECIMALS);
export const fromUnits = (v: bigint) => Number(formatUnits(v, TOKEN_DECIMALS));
export const fmtUsd = (v: bigint, digits = 2) =>
  fromUnits(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
export const fmtPct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Parses an ERC-8004 agent URI (data:application/json, https://, ipfs://) into a profile. */
export function parseAgentUri(uri: string): { name: string; [k: string]: unknown } {
  try {
    if (uri.startsWith("data:application/json")) {
      const raw = uri.slice(uri.indexOf(",") + 1);
      const json = uri.includes(";base64,") ? atob(raw) : decodeURIComponent(raw);
      const p = JSON.parse(json);
      return { name: String(p.name ?? "Unnamed agent"), ...p };
    }
  } catch {
    /* fall through */
  }
  return { name: uri.split("/").pop() || "Unnamed agent", uri };
}

export const agentUri = (profile: Record<string, unknown>) =>
  `data:application/json,${encodeURIComponent(JSON.stringify(profile))}`;
