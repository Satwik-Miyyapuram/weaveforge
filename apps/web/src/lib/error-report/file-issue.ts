import { checkUrlReachable, pinnedFetch } from "@/backend/net/safe-fetch";

/**
 * Creating one GitHub issue, on the pinned path.
 *
 * Extracted from the route so it can be driven without a session — the way
 * `url-meta` splits its shaping from its gate. The interesting half is that this
 * is the only outbound request in the app that carries a token with **write**
 * access somewhere, and it goes through `checkUrlReachable` + `pinnedRequest`
 * rather than `fetch`: the guard resolves the name, checks every address, and
 * `pinnedFetch` then dials that address while still presenting
 * `api.github.com` as the TLS name and the `Host` header.
 *
 * `resolve` is injected for the same reason `safe-fetch` injects it: a test
 * supplies its own and never touches DNS.
 */

export interface FileIssueInput {
  repo: string;
  token: string;
  title: string;
  body: string;
  /** How the destination's name becomes addresses. Real DNS in production. */
  resolve?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
}

export type FileIssueResult =
  | { ok: true; url: string | null; number: number | null }
  | { ok: false; reason: "unreachable" | "refused"; status: number };

export async function fileIssue(input: FileIssueInput): Promise<FileIssueResult> {
  const url = new URL(`https://api.github.com/repos/${input.repo}/issues`);

  const reachable = await checkUrlReachable(url, input.resolve);
  if (!reachable.ok) {
    // Logged with the kind, not returned: which address was refused is a detail
    // about the network this deployment is on.
    console.error(`[report-issue] refusing to post: ${reachable.kind}`);
    return { ok: false, reason: "unreachable", status: 502 };
  }

  const response = await pinnedFetch({
    url,
    address: reachable.address,
    family: reachable.family,
    timeoutMs: input.timeoutMs ?? 15_000,
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "weaveforge-error-report",
    },
    body: JSON.stringify({ title: input.title, body: input.body }),
  });

  if (!response.ok) {
    console.error(`[report-issue] GitHub answered ${response.status}`);
    return { ok: false, reason: "refused", status: response.status };
  }

  const created = (await response.json()) as { html_url?: string; number?: number };
  return { ok: true, url: created.html_url ?? null, number: created.number ?? null };
}
