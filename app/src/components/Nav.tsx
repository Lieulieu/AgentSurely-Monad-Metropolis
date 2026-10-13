"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Award, Droplets, ExternalLink, KeyRound, LogOut, Menu, Wallet, X } from "lucide-react";
import clsx from "clsx";
import { fmtUsd, REWARD_SYMBOL, shortAddr, TOKEN_SYMBOL, USDC_FAUCET_URL } from "@agentsurely/sdk";
import { activeChain } from "@/lib/wagmi";
import { useSdk } from "@/lib/sdk";
import { useBalance, useRewardBalance, useSubscription } from "@/lib/queries";
import { useSignIn } from "@/lib/siwe";
import { useTx } from "@/lib/tx";
import { Wordmark } from "./Logo";
import { Button } from "./ui";

/** Shown in the bar on large screens; everything else lives in the hamburger menu. */
const primary = [
  { href: "/catalog", label: "Catalog" },
  { href: "/jobs", label: "Jobs" },
  { href: "/workspace", label: "Workspace" },
  { href: "/playbooks", label: "Playbooks" },
  { href: "/agents", label: "Agents" },
];
const secondary = [
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "How it works" },
];

const isActive = (path: string, href: string) => path === href || (href !== "/" && path.startsWith(href));

/**
 * Navbar: logo · main links (lg+) · one wallet action · hamburger.
 * The hamburger holds the network, balances, plan, faucet, sign-in/out and the secondary links
 * (plus all links on small screens), so the bar never overflows.
 */
export function Nav() {
  const path = usePathname();
  const dark = path === "/";
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(false), toggle.current?.focus());
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !toggle.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <header className={clsx("sticky top-0 z-40 border-b backdrop-blur", dark ? "border-night-line bg-night/80" : "border-line bg-surface/85")}>
      <div className="page relative flex h-16 items-center gap-4">
        <Link href="/" aria-label="AgentSurely home" className="shrink-0">
          <Wordmark dark={dark} />
        </Link>
        <nav className="hidden min-w-0 items-center gap-0.5 lg:flex" aria-label="Main">
          {primary.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "whitespace-nowrap rounded-sm px-2.5 py-2 text-sm font-medium transition",
                dark
                  ? isActive(path, l.href) ? "text-white" : "text-white/60 hover:text-white"
                  : isActive(path, l.href) ? "text-brand" : "text-ink-2 hover:text-ink"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <WalletAction dark={dark} />
          <button
            ref={toggle}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="nav-menu"
            onClick={() => setOpen(!open)}
            className={clsx(
              "grid h-10 w-10 place-items-center rounded-sm border transition",
              dark ? "border-night-line text-white hover:bg-white/10" : "border-line bg-surface text-ink hover:border-brand/40 hover:text-brand",
              open && (dark ? "bg-white/10" : "border-brand/40 text-brand")
            )}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open && (
          <div
            ref={panel}
            id="nav-menu"
            className="absolute right-4 top-[calc(100%+8px)] max-h-[calc(100vh-88px)] w-[calc(100vw-32px)] overflow-y-auto rounded-sm border border-line bg-surface p-2 text-ink shadow-lg sm:w-80"
          >
            <AccountSection />
            <nav aria-label="Menu" className="py-1">
              <div className="lg:hidden">
                {primary.map((l) => <MenuLink key={l.href} href={l.href} label={l.label} active={isActive(path, l.href)} />)}
                <hr className="my-1 border-line" />
              </div>
              {secondary.map((l) => <MenuLink key={l.href} href={l.href} label={l.label} active={isActive(path, l.href)} />)}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

function MenuLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={clsx("block rounded-sm px-3 py-2 text-sm font-medium", active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
      {label}
    </Link>
  );
}

/** The single wallet button kept in the bar: connect, switch network, sign in, or the short address. */
function WalletAction({ dark }: { dark?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();
  const { signedIn, signIn, isPending: signing } = useSignIn();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (!isConnected) {
    return (
      <Button variant={dark ? "light" : "primary"} loading={isPending} onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: activeChain.id })}>
        <Wallet className="h-4 w-4" /> <span className="hidden sm:inline">Connect wallet</span><span className="sm:hidden">Connect</span>
      </Button>
    );
  }
  if (chainId !== activeChain.id) {
    return (
      <Button variant="danger" onClick={() => switchChain({ chainId: activeChain.id })}>
        Switch<span className="hidden sm:inline"> to {activeChain.name}</span>
      </Button>
    );
  }
  if (!signedIn) {
    return (
      <Button variant={dark ? "light" : "primary"} loading={signing} onClick={() => signIn().catch(() => undefined)} title="Sign in with your wallet (free, no gas)">
        <KeyRound className="h-4 w-4" /> Sign in
      </Button>
    );
  }
  return (
    <span className={clsx("hidden items-center gap-2 rounded-sm border px-3 py-2 text-sm sm:inline-flex", dark ? "border-night-line text-white" : "border-line bg-surface text-ink")}>
      <span className="h-2 w-2 rounded-full bg-ok" />
      <span className="mono">{shortAddr(address!)}</span>
    </span>
  );
}

/** Network, address, balances, plan, faucet and sign-in/out — inside the hamburger menu. */
function AccountSection() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const sdk = useSdk();
  const bal = useBalance(address);
  const rewards = useRewardBalance(address);
  const sub = useSubscription(address);
  const faucet = useTx("Faucet", () => sdk!.faucet());
  const { signedIn, signIn, signOut, isPending: signing } = useSignIn();
  const externalFaucet = !!sdk && sdk.payTokens()[0]?.faucet !== "contract";

  return (
    <div className="rounded-sm bg-surface-2 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-ink-2">
        <span className="h-2 w-2 rounded-full bg-ok" /> {activeChain.name}
        {isConnected && <span className="mono ml-auto text-ink">{shortAddr(address!)}</span>}
      </p>
      {!isConnected ? (
        <p className="mt-2 text-sm text-ink-2">Connect a wallet to rent agents and create jobs.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-sm bg-surface p-2">
              <dt className="text-xs text-ink-3">Balance</dt>
              <dd className="font-semibold tabular-nums">{bal.data !== undefined ? fmtUsd(bal.data, 2) : "…"} {TOKEN_SYMBOL}</dd>
            </div>
            <div className="rounded-sm bg-surface p-2" title="mUSD rewards earned from passed tasks">
              <dt className="flex items-center gap-1 text-xs text-ink-3"><Award className="h-3 w-3 text-warn" /> Rewards</dt>
              <dd className="font-semibold tabular-nums">{rewards.data !== undefined ? fmtUsd(rewards.data, 0) : "…"} {REWARD_SYMBOL}</dd>
            </div>
          </dl>
          {sub.data && (
            <Link href="/pricing" className="mt-2 block rounded-sm bg-surface p-2 text-xs text-ink-2 hover:text-brand">
              Plan <b className="text-ink">{sub.data.plan === "Vip" ? "VIP" : sub.data.plan}</b> · {sub.data.created.length}/{sub.data.limits.create} created · {sub.data.rentals.length}/{sub.data.limits.rent} rented
            </Link>
          )}
          <div className="mt-3 grid gap-2">
            {externalFaucet ? (
              <a href={USDC_FAUCET_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-sm font-semibold hover:border-brand/40 hover:text-brand" title="Choose Monad Testnet · 20 USDC every 2 hours">
                <Droplets className="h-4 w-4" /> Get 20 test USDC <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <Button variant="secondary" loading={faucet.isPending} onClick={() => faucet.mutate(undefined)}>
                <Droplets className="h-4 w-4" /> Mint 20 test USDC
              </Button>
            )}
            {!signedIn && (
              <Button loading={signing} onClick={() => signIn().catch(() => undefined)}>
                <KeyRound className="h-4 w-4" /> Sign in (free, no gas)
              </Button>
            )}
            <Button variant="secondary" onClick={() => (signOut(), disconnect())}>
              <LogOut className="h-4 w-4" /> {signedIn ? "Sign out & disconnect" : "Disconnect"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
