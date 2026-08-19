"use client";

import { getSupabase } from "@/lib/supabase";

/**
 * The Authorization header for a call to one of our own API routes.
 *
 * Written once because the alternative is what was here before: three copies
 * of the same six lines, which is how a route ends up authenticated from one
 * screen and not from another. `/api/url-meta` was exactly that — it fetches an
 * arbitrary address on the caller's behalf, the same power `/api/fetch-url`
 * requires a token for, and it required nothing.
 *
 * Throws rather than returning an empty header: a request that quietly goes out
 * unauthenticated gets a 401 the caller has to explain, and "not signed in" is
 * the honest version of that.
 */
export async function authHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return { ...(extra as Record<string, string> | undefined), Authorization: `Bearer ${token}` };
}
