import { http, type HttpTransport } from "viem";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() that spaces requests out (public Monad RPC allows ~15 req/s) and
 * retries when the node answers "requests limited to N/sec" or HTTP 429.
 * One limiter per call — share it between the clients of one process.
 */
export function throttledFetch(requestsPerSecond = 8, maxRetries = 6): typeof fetch {
  const gap = 1000 / requestsPerSecond;
  let next = 0;
  const f = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const at = Math.max(now, next);
      next = at + gap;
      if (at > now) await sleep(at - now);
      const res = await fetch(input, init);
      const limited = res.status === 429 || (res.ok && /limited to \d+\/sec|rate limit/i.test(await res.clone().text()));
      if (!limited || attempt >= maxRetries) return res;
      await sleep(400 * 2 ** attempt);
    }
  };
  return f as typeof fetch;
}

/** viem http transport with the throttled fetch and retries. */
export function rateLimitedHttp(url?: string, requestsPerSecond = 8): HttpTransport {
  return http(url, { fetchFn: throttledFetch(requestsPerSecond), retryCount: 3, retryDelay: 500 });
}
