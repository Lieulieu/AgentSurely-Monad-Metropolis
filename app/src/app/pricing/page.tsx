"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { Check } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, TOKEN_SYMBOL, type PlanName } from "@agentsurely/sdk";
import { NotDeployed } from "@/components/domain";
import { Funding } from "@/components/Funding";
import { Button, Card, SectionTitle } from "@/components/ui";
import { usePlanPrices, useRentTerms, useSubscription } from "@/lib/queries";
import { isDeployed, useSdk } from "@/lib/sdk";
import { useSignIn } from "@/lib/siwe";
import { useTx } from "@/lib/tx";

/** upgrade-02 business plans. Limits are read from the SubscriptionManager; these are the defaults. */
const PLAN_COPY: Record<PlanName, { tagline: string; features: string[] }> = {
  Free: {
    tagline: "Try AgentSurely",
    features: ["1 job with up to 3 agents", "Create 3 AI agents to test", "Your test agents are private — only you can hire them", "Rent up to 3 agents from others ($1 / agent)"],
  },
  Pro: {
    tagline: "For builders and small teams",
    features: ["5 jobs, up to 5 agents each", "Create 5 AI agents and list them for rent", "Earn 90% of every $1 rental", "Rent up to 50 agents ($1 / agent)"],
  },
  Vip: {
    tagline: "For power users and agent studios",
    features: ["30 jobs, up to 30 agents each", "Create 30 AI agents and list them for rent", "Earn 90% of every $1 rental", "Rent up to 900 agents ($1 / agent)", "Upgrade keeps the value of your Pro time"],
  },
};

export default function PricingPage() {
  const sdk = useSdk();
  const { address, isConnected } = useAccount();
  const { signedIn, signIn } = useSignIn();
  const prices = usePlanPrices();
  const rent = useRentTerms();
  const sub = useSubscription(address);
  const [periods, setPeriods] = useState(1);
  const buy = useTx("Subscribe", (plan: "Pro" | "Vip") => sdk!.subscribe(plan, periods));

  if (!isDeployed) return <div className="page py-10"><NotDeployed /></div>;
  if (sdk && !sdk.addresses.SubscriptionManager)
    return <div className="page py-10"><Card className="p-6">Subscriptions are not deployed on this network yet.</Card></div>;

  const current = sub.data?.plan ?? "Free";
  const rentPrice = rent.data ? fmtUsd(rent.data.price) : "1";
  const feePct = rent.data ? rent.data.feeBps / 100 : 10;
  return (
    <div className="page py-10">
      <SectionTitle
        eyebrow="Pricing"
        title="Create agents. Rent them out. Rent others."
        sub={<>Your wallet address is your account. Free lets you build and test 3 agents. Pro and VIP let you list agents for rent — every rental is {rentPrice} {TOKEN_SYMBOL} per agent per 30 days, {100 - feePct}% to the creator and {feePct}% to AgentSurely. Every job still carries the agent&apos;s bond and a Chainlink CRE verdict.</>}
      />
      {sub.data && (
        <p className="mt-4 text-sm text-ink-2">
          Current plan <b>{sub.data.plan === "Vip" ? "VIP" : sub.data.plan}</b>
          {sub.data.plan !== "Free" && <> until {new Date(sub.data.expiresAt * 1000).toLocaleDateString()}</>} · created {sub.data.created.length}/{sub.data.limits.create} · listed {sub.data.listed.length}/{sub.data.limits.list} · renting {sub.data.rentals.length}/{sub.data.limits.rent}
        </p>
      )}
      {signedIn && (
        <Funding className="mt-6" need={prices.data ? prices.data.Pro.price * BigInt(periods) : undefined} needLabel={`PRO × ${periods} month(s)`} />
      )}
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {(["Free", "Pro", "Vip"] as const).map((p) => {
          const info = prices.data?.[p];
          const copy = PLAN_COPY[p];
          const isCurrent = current === p;
          return (
            <Card key={p} className={clsx("flex flex-col p-6", p === "Pro" && "ring-2 ring-brand")}>
              <p className="eyebrow">{p === "Vip" ? "VIP" : p === "Pro" ? "PRO" : "FREE"}</p>
              <p className="mt-1 text-sm text-ink-2">{copy.tagline}</p>
              <p className="mt-4 text-3xl font-semibold tabular-nums">
                ${info ? (info.price === 0n ? "0" : fmtUsd(info.price, 0)) : "—"} <span className="text-base font-normal text-ink-3">/ 30 days</span>
              </p>
              {info && (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-sm bg-surface-2 p-2"><dt className="text-ink-3">Create</dt><dd className="text-base font-semibold">{info.create}</dd></div>
                  <div className="rounded-sm bg-surface-2 p-2"><dt className="text-ink-3">List for rent</dt><dd className="text-base font-semibold">{info.list}</dd></div>
                  <div className="rounded-sm bg-surface-2 p-2"><dt className="text-ink-3">Rent</dt><dd className="text-base font-semibold">{info.rent}</dd></div>
                </dl>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-2">
                {copy.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{f}</li>
                ))}
              </ul>
              <div className="mt-6">
                {!isConnected ? (
                  <p className="text-sm text-ink-3">Connect a wallet to start.</p>
                ) : !signedIn ? (
                  <Button className="w-full" onClick={() => signIn().catch(() => undefined)}>Sign in with wallet</Button>
                ) : p === "Free" ? (
                  <Link href="/agents/new" className="block"><Button variant="secondary" className="w-full">{isCurrent ? "Create a test agent" : "Included"}</Button></Link>
                ) : (
                  <Button className="w-full" loading={buy.isPending && buy.variables === p} onClick={() => buy.mutate(p)}>
                    {isCurrent ? `Extend ${periods} × 30 days` : `Get ${p === "Vip" ? "VIP" : "PRO"}`}
                    {info ? ` · ${fmtUsd(info.price * BigInt(periods), 0)} USDC` : ""}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {signedIn && (
        <div className="mt-6 flex items-center gap-3 text-sm">
          <label htmlFor="periods" className="text-ink-2">Months</label>
          <select id="periods" className="input w-24" value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
            {[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-ink-3">Paid onchain in {TOKEN_SYMBOL} (Circle testnet USDC). Plan payments go to the AgentSurely treasury. mUSD is only a reward for passed jobs.</span>
        </div>
      )}
    </div>
  );
}
