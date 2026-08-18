"use client";

import { getSupabase } from "@/lib/supabase";
import { desktop } from "@/lib/desktop-bridge";

/**
 * Fetching something from a third-party site on the reader's behalf.
 *
 * There is exactly one interface and two ways of satisfying it, which is the
 * whole point: a browser has to go through our server, because the site is a
 * different origin and CORS forbids reading it; the desktop app has no such
 * barrier and no server, so its main process does the same fetch directly using
 * the same guard. Callers ask for a title or a picture and never learn which
 * happened.
 */
export interface OutboundFetch {
  /** The title a site would want shown when somebody links to it. */
  title(url: string): Promise<{ title: string; url: string }>;
  /** The picture behind an image URL, ready to store. */
  image(url: string): Promise<{ blob: Blob; url: string }>;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return { Authorization: `Bearer ${token}` };
}

/** Reads the error a route reported, falling back to something a person can act on. */
async function failure(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return new Error(body.error);
  } catch {
    // A non-JSON error body is not worth reporting verbatim.
  }
  return new Error(fallback);
}

const viaServer: OutboundFetch = {
  async title(url) {
    const response = await fetch(`/api/fetch-url?as=title&url=${encodeURIComponent(url)}`, {
      headers: await authHeaders(),
    });
    if (!response.ok) throw await failure(response, "That page could not be read.");
    return (await response.json()) as { title: string; url: string };
  },

  async image(url) {
    const response = await fetch(`/api/fetch-url?as=image&url=${encodeURIComponent(url)}`, {
      headers: await authHeaders(),
    });
    if (!response.ok) throw await failure(response, "That image could not be downloaded.");
    return { blob: await response.blob(), url };
  },
};

/**
 * The desktop implementation, when there is one.
 *
 * The bridge hands back plain data — a string, or bytes and a type — because
 * only structured-cloneable values cross the Electron boundary. Turning bytes
 * back into a `Blob` here keeps that detail out of every caller.
 */
function viaDesktop(): OutboundFetch | null {
  const bridge = desktop();
  if (!bridge) return null;
  return {
    title: (url) => bridge.fetchTitle(url),
    async image(url) {
      const result = await bridge.fetchImage(url);
      return { blob: new Blob([result.bytes], { type: result.contentType }), url: result.url };
    },
  };
}

/** Whichever way this build can reach the internet. */
export function outboundFetch(): OutboundFetch {
  return viaDesktop() ?? viaServer;
}

/** True when a fetch needs no server round trip, so a caller can say so. */
export function fetchesDirectly(): boolean {
  return desktop() !== null;
}
