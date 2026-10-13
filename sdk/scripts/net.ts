/**
 * Outbound HTTPS for the CLI scripts (LLM calls).
 * - Honors HTTPS_PROXY / HTTP_PROXY (Node's built-in fetch ignores them).
 * - Turns Node's opaque "fetch failed" into the real cause + a hint, and can
 *   run a quick network diagnosis (DNS, TCP 443, TLS) for a host.
 */
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;

const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "localhost,127.0.0.1,::1")
  .split(",")
  .map((h) => h.trim().replace(/^\*?\./, ""))
  .filter(Boolean);

function bypassProxy(url: string): boolean {
  const host = new URL(url).hostname;
  return noProxy.some((h) => host === h || host.endsWith("." + h));
}

export async function netFetch(url: string, init: RequestInit): Promise<Response> {
  if (!proxy || bypassProxy(url)) return fetch(url, init);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require("undici") as { fetch: typeof fetch; ProxyAgent: new (u: string) => unknown };
  return undici.fetch(url, { ...init, dispatcher: new undici.ProxyAgent(proxy) } as RequestInit);
}

export function explainFetchError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? "";
  const detail = `${err.message ?? e}${err.cause ? ` — ${code} ${err.cause.message ?? ""}`.trimEnd() : ""}`;
  const hints: Record<string, string> = {
    ENOTFOUND: "DNS cannot resolve the host: check internet/DNS, VPN, or a hosts-file block.",
    EAI_AGAIN: "DNS timeout: check internet/DNS.",
    ECONNREFUSED: "Connection refused: a firewall or proxy is blocking it. If you use a proxy, set HTTPS_PROXY=http://host:port.",
    ECONNRESET: "Connection reset: usually a firewall/antivirus/ISP filter. Try another network or a VPN; with a proxy set HTTPS_PROXY.",
    ETIMEDOUT: "Timed out: network blocks the host. Try another network or VPN; with a proxy set HTTPS_PROXY.",
    UND_ERR_CONNECT_TIMEOUT: "Timed out: network blocks the host. Try another network or VPN; with a proxy set HTTPS_PROXY.",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS certificate not trusted (antivirus/corporate HTTPS inspection). Run: set NODE_OPTIONS=--use-system-ca",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate not trusted (antivirus/corporate HTTPS inspection). Run: set NODE_OPTIONS=--use-system-ca",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate not trusted (antivirus/corporate HTTPS inspection). Run: set NODE_OPTIONS=--use-system-ca",
    CERT_HAS_EXPIRED: "TLS certificate expired/invalid: check the PC clock, or antivirus HTTPS inspection.",
  };
  return hints[code] ? `${detail}\n  → ${hints[code]}` : detail;
}

/** DNS → TCP 443 → TLS handshake, one line each. */
export async function diagnose(host: string): Promise<void> {
  console.log(`  Network check for ${host}${proxy ? ` (proxy ${proxy})` : ""}:`);
  try {
    const a = await dns.lookup(host, { all: true });
    console.log(`    DNS  ✔ ${a.map((x) => x.address).slice(0, 3).join(", ")}`);
  } catch (e) {
    console.log(`    DNS  ✖ ${(e as { code?: string }).code ?? e}`);
    return;
  }
  if (proxy) return;
  const step = (name: string, run: (done: (err?: Error) => void) => void) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        console.log(`    ${name} ✖ timeout (8s)`);
        resolve(false);
      }, 8000);
      run((err) => {
        clearTimeout(timer);
        console.log(err ? `    ${name} ✖ ${(err as { code?: string }).code ?? ""} ${err.message}` : `    ${name} ✔`);
        resolve(!err);
      });
    });
  const tcp = await step("TCP ", (done) => {
    const s = net.connect(443, host, () => (s.end(), done()));
    s.on("error", done);
  });
  if (!tcp) return;
  const ok = await step("TLS ", (done) => {
    const s = tls.connect({ host, port: 443, servername: host }, () => (s.end(), done()));
    s.on("error", done);
  });
  if (ok) return;
  // Show who issued the certificate Node rejected (read-only: handshake only, nothing is sent).
  await new Promise<void>((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      let c = s.getPeerCertificate(true) as tls.DetailedPeerCertificate | undefined;
      const chain: string[] = [];
      for (let i = 0; c && i < 5; i++) {
        chain.push(String(c.issuer?.O || c.issuer?.CN || "?"));
        if (!c.issuerCertificate || c.issuerCertificate === c) break;
        c = c.issuerCertificate;
      }
      console.log(`    cert issued by: ${[...new Set(chain)].join(" → ")}`);
      console.log("    (a name like an antivirus or company proxy means HTTPS inspection on this PC)");
      s.end();
      resolve();
    });
    s.on("error", () => resolve());
    setTimeout(resolve, 8000);
  });
}
