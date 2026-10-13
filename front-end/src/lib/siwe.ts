"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { verifyMessage, type Address } from "viem";
import { activeChain } from "./wagmi";

/** EIP-4361 "Sign-In with Ethereum" message. The wallet address is the account. */
export function siweMessage(address: Address, nonce: string, issuedAt: string) {
  const host = typeof window !== "undefined" ? window.location.host : "agentsurely.app";
  const uri = typeof window !== "undefined" ? window.location.origin : "https://agentsurely.app";
  return [
    `${host} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to AgentSurely. This only proves you own this wallet — it costs no gas and moves no funds.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${activeChain.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

type Session = { address: Address; message: string; signature: `0x${string}` };
const KEY = "agentsurely.siwe";

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Wallet sign-in state for the connected address (session kept in sessionStorage). */
export function useSignIn() {
  const { address } = useAccount();
  const { signMessageAsync, isPending } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = load();
    if (!s || !address || s.address.toLowerCase() !== address.toLowerCase()) return setSession(null);
    verifyMessage({ address: s.address, message: s.message, signature: s.signature })
      .then((ok) => setSession(ok ? s : null))
      .catch(() => setSession(null));
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address) return;
    const nonce = Math.random().toString(36).slice(2, 12);
    const message = siweMessage(address, nonce, new Date().toISOString());
    const signature = await signMessageAsync({ message });
    if (!(await verifyMessage({ address, message, signature }))) throw new Error("Signature check failed");
    const s = { address, message, signature };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* private mode: session lasts for this page only */
    }
    setSession(s);
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
  }, []);

  return { signedIn: !!session, signIn, signOut, isPending };
}
