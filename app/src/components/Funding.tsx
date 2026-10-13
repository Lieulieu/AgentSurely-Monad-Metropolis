"use client";

import { useAccount } from "wagmi";
import { AlertTriangle, Award, Droplets, ExternalLink } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, REWARD_SYMBOL, TOKEN_SYMBOL, USDC_FAUCET_URL } from "@agentsurely/sdk";
import { useTokenBalances } from "@/lib/queries";
import { useSdk } from "@/lib/sdk";
import { useTx } from "@/lib/tx";
import { Button } from "./ui";

/**
 * USDC faucet. Local chain: mints 20 MockStable USDC. Monad testnet: Circle's USDC can't be minted by a
 * contract call, so this opens faucet.circle.com (choose Monad Testnet · 20 USDC / 2h per address).
 */
export function UsdcFaucet({ compact, light }: { compact?: boolean; light?: boolean }) {
  const sdk = useSdk();
  const mint = useTx("USDC faucet", () => sdk!.faucet());
  if (!sdk) return null;
  const local = sdk.payTokens()[0]?.faucet === "contract";
  if (!local) {
    return (
      <a
        className={clsx("inline-flex items-center gap-1.5 font-semibold hover:underline", compact ? "text-xs" : "text-sm", light ? "text-white" : "text-brand")}
        href={USDC_FAUCET_URL}
        target="_blank"
        rel="noreferrer"
        title="Circle faucet — choose Monad Testnet, 20 USDC every 2 hours"
      >
        <Droplets className="h-4 w-4" /> Get 20 USDC <ExternalLink className="h-3 w-3" />
      </a>
    );
  }
  return (
    <Button type="button" variant={light ? "light" : "secondary"} className={compact ? "px-3 py-1.5 text-xs" : undefined} loading={mint.isPending} onClick={() => mint.mutate(undefined)}>
      <Droplets className="h-4 w-4" /> Get 20 USDC
    </Button>
  );
}

/**
 * Wallet funding strip: USDC balance (the money) with its faucet, mUSD rewards earned, and a red warning
 * when `need` USDC is more than the wallet holds — before a payment fails with 0xe450d38c.
 */
export function Funding({ need, needLabel = "this payment", className }: { need?: bigint; needLabel?: string; className?: string }) {
  const sdk = useSdk();
  const { address } = useAccount();
  const balances = useTokenBalances(address);
  if (!sdk || !address) return null;
  const usdc = balances.data?.USDC;
  const rewards = balances.data?.mUSD;
  const short = need !== undefined && usdc !== undefined && usdc < need;

  return (
    <div className={clsx("rounded-sm border border-line bg-surface-2 p-3 text-sm", className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span>
          <span className="text-ink-2">Balance </span>
          <b className="tabular-nums">{usdc !== undefined ? fmtUsd(usdc) : "…"}</b> {TOKEN_SYMBOL}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2" title={`${REWARD_SYMBOL} is a reward paid for every passed job — it is not used for payments`}>
          <Award className="h-4 w-4 text-warn" /> Rewards <b className="tabular-nums text-ink">{rewards !== undefined ? fmtUsd(rewards) : "…"}</b> {REWARD_SYMBOL}
        </span>
        <span className="ml-auto">
          <UsdcFaucet compact />
        </span>
      </div>
      {short && (
        <p className="mt-2 flex items-start gap-2 text-bad">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Not enough {TOKEN_SYMBOL} for {needLabel} (need {fmtUsd(need!)}, you have {fmtUsd(usdc!)}). Get free testnet USDC with the faucet above.
          </span>
        </p>
      )}
    </div>
  );
}
