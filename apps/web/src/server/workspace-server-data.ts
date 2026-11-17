/**
 * Lowering a workspace's tier removes its server-side copies (modes-093 section 8).
 *
 * `DELETE /api/workspaces/{id}/server-data?epoch=N` authenticates the caller with
 * their own bearer token and records a tombstone at epoch N. The tombstone is
 * written through the `record_workspace_tombstone` RPC, which keeps the highest
 * epoch, so a replayed lower epoch cannot reopen the workspace.
 *
 * Credential purge is not done here yet: no client writes `workspace:{id}`
 * entries to `credentials_enc` on main, so there is nothing to remove.
 */

export type AuthenticatedUser = { userId: string };

export type TombstoneCall = {
  userId: string;
  workspaceId: string;
  epoch: number;
  bearer: string;
};

export type ServerDataDeps = {
  /** Resolves a bearer token to its user, or null when the token is rejected. */
  authenticate: (bearer: string) => Promise<AuthenticatedUser | null>;
  /** Writes the tombstone as the caller (RLS applies). Throws on failure. */
  recordTombstone: (call: TombstoneCall) => Promise<void>;
};

/** An upload is stale when it carries an epoch below the workspace's tombstone. */
export function isUploadStale(tombstoneEpoch: number | null, uploadEpoch: number): boolean {
  return tombstoneEpoch !== null && uploadEpoch < tombstoneEpoch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match?.[1] ?? null;
}

function parseEpoch(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function handleWorkspaceServerDataDelete(
  request: Request,
  workspaceId: string,
  deps: ServerDataDeps,
): Promise<Response> {
  const bearer = bearerOf(request);
  if (!bearer) return json(401, { error: "Sign in to change server copies." });
  const user = await deps.authenticate(bearer);
  if (!user) return json(401, { error: "Sign in to change server copies." });

  const epoch = parseEpoch(new URL(request.url).searchParams.get("epoch"));
  if (epoch === null) return json(400, { error: "epoch must be a non-negative integer." });

  try {
    await deps.recordTombstone({ userId: user.userId, workspaceId, epoch, bearer });
  } catch {
    return json(500, { error: "Could not record the workspace tombstone." });
  }
  return json(200, { ok: true, workspaceId, epoch });
}

export type PostgrestConfig = {
  /** Self-hosted PostgREST base URL (NEXT_PUBLIC_DATA_URL). */
  dataUrl: string;
  /** Supabase auth base URL (NEXT_PUBLIC_SUPABASE_URL). */
  authUrl: string;
  /** Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY). */
  anonKey: string;
};

/** Checks a bearer token with Supabase auth; null when Supabase rejects it. */
export function createTokenAuthenticator(config: Pick<PostgrestConfig, "authUrl" | "anonKey">) {
  return async (bearer: string): Promise<AuthenticatedUser | null> => {
    const res = await fetch(`${config.authUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: config.anonKey, authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === "string" ? { userId: body.id } : null;
  };
}

/** Records the tombstone through PostgREST as the caller, so RLS scopes the write. */
export function createTombstoneRecorder(config: Pick<PostgrestConfig, "dataUrl" | "anonKey">) {
  return async ({ workspaceId, epoch, bearer }: TombstoneCall): Promise<void> => {
    const res = await fetch(`${config.dataUrl.replace(/\/$/, "")}/rpc/record_workspace_tombstone`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_workspace_id: workspaceId, p_epoch: epoch }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`record_workspace_tombstone failed: ${res.status}`);
  };
}
