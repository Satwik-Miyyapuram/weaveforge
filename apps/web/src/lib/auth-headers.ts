"use client";

import { getContainer } from "@/bootstrap";

/**
 * The Authorization header for a call to one of our own API routes.
 *
 * Written once because the alternative is what was here before: the same six
 * lines in four places, which is how a route ends up authenticated from one
 * screen and not from another. `/api/url-meta` was exactly that — it fetches an
 * arbitrary address on the caller's behalf, the same power `/api/fetch-url`
 * requires a token for, and it required nothing.
 *
 * The token comes from the auth port rather than from Supabase directly. That
 * is the app's own seam — everywhere else that needs a token reaches for
 * `auth.getAccessToken()` — and going around it here would make this file the
 * one place that knows which provider is behind the session.
 *
 * Throws rather than returning an empty header: a request that quietly goes out
 * unauthenticated gets a 401 the caller then has to explain, and "not signed
 * in" is the honest version of that.
 */
export async function authHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const token = await getContainer().auth.auth.getAccessToken();
  if (!token) throw new Error("Not signed in.");
  return { ...(extra as Record<string, string> | undefined), Authorization: `Bearer ${token}` };
}
