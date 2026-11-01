import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Where the hosted page reaches a relay route (`/api/arxiv`, `/api/pdf-proxy`, …).
 *
 * With `NEXT_PUBLIC_RELAY_URL` set, a browser goes to the axum relay
 * (`apps/relay`); unset, it stays on the Next routes of its own origin. The
 * shells always keep their in-process relay, so the bare path is theirs.
 */
export function relayUrl(path: string): string {
  const base = relayBase();
  return base ? `${base}${path}` : path;
}

/** The relay route path inside `url`, so same-origin checks also accept a relay URL. */
export function relayPath(url: string): string {
  const base = relayBase();
  return base && url.startsWith(`${base}/`) ? url.slice(base.length) : url;
}

function relayBase(): string | null {
  // Spelled out in full so Next inlines it into the client bundle.
  const base = process.env.NEXT_PUBLIC_RELAY_URL?.trim().replace(/\/+$/, "");
  return base && desktop() === null ? base : null;
}
