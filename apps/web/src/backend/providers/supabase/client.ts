import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (singleton). Used only by the Supabase backend provider.
 *
 * `dataUrl` points the REST calls somewhere other than the Supabase project —
 * a self-hosted PostgREST in front of your own Postgres. Auth, realtime and
 * storage stay on `url`, because those are Supabase services and only the data
 * API has a drop-in replacement.
 *
 * The session is unaffected: the token Supabase Auth issues is sent to whichever
 * REST endpoint is configured, and a PostgREST holding the same JWT secret
 * accepts it. That is what makes the switch a URL rather than a rewrite.
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
  dataUrl?: string,
): SupabaseClient {
  if (client) return client;
  client = createClient(url, anonKey, {
    ...(dataUrl && dataUrl !== url
      ? { global: { fetch: dataApiFetch(url, dataUrl) } }
      : {}),
  });
  return client;
}

/**
 * Send REST traffic to the data API and everything else to Supabase.
 *
 * supabase-js builds one base URL and appends `/rest/v1`, `/auth/v1`,
 * `/storage/v1` and so on. Rewriting at the fetch layer is what lets one client
 * serve both without maintaining a second client and a second session.
 */
function dataApiFetch(supabaseUrl: string, dataUrl: string): typeof fetch {
  const restPrefix = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const dataBase = dataUrl.replace(/\/$/, "");

  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(restPrefix)) return fetch(input, init);

    // PostgREST serves the tables at its root, so `/rest/v1` is dropped.
    const rewritten = `${dataBase}${href.slice(restPrefix.length)}`;
    return fetch(rewritten, typeof input === "string" || input instanceof URL ? init : input);
  };
}

export function resetSupabaseClientForTests(): void {
  client = null;
}
