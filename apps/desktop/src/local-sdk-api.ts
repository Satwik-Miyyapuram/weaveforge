import { LOCAL_USER_ID } from "@weaveforge/core";

import type { LocalApiRequest, LocalApiResponse } from "./local-api";

/**
 * The Python SDK's `/api/sdk/*` routes, answered from the local database.
 *
 * The SDK already speaks one protocol: a bearer token and a handful of JSON
 * routes on a base URL. A copy of the app with no server has a database and a
 * loopback port, so the cheapest way to let `weaveforge.track(...)` write into
 * it is to answer the routes it already calls rather than to grow a second
 * backend in Python. Point `WEAVEFORGE_API_URL` at the local API and the SDK
 * cannot tell the difference — same client, same repositories, same tests.
 *
 * Deliberately narrower than the web routes:
 *
 * - There is one user here, so `whoami` is a constant and there is no RLS to
 *   apply — the database this talks to holds nobody else's rows.
 * - Metric points are inserted as they arrive. The web route downsamples
 *   because it is protecting shared storage from a thousand clients; a local
 *   file is one person's, and the `experiment_metrics` view already collapses
 *   a re-ingest onto its primary key.
 * - Artifacts are absent. They are blobs, and blobs belong to the blob store,
 *   not to a route that only knows how to run SQL.
 */

/** What the local database accepts as a bound value. */
type SdkParam = string | number | boolean | null;

/** The one thing this file needs: something that runs SQL. */
export type SdkQuery = (
  sql: string,
  params: SdkParam[],
) => Promise<{ ok: true; value: unknown[] } | { ok: false; message: string }>;

export const SDK_PREFIX = "/api/sdk/";

/**
 * Columns an experiment row may carry. An allowlist rather than "whatever was
 * posted": the body names its own columns, and an unchecked name would be
 * interpolated into SQL.
 */
const EXPERIMENT_COLUMNS = [
  "id",
  "project_id",
  "name",
  "hypothesis",
  "status",
  "repo_url",
  "commit_sha",
  "branch",
  "run_command",
  "config",
  "metrics",
  "artifacts",
  "result_note",
  "started_at",
  "finished_at",
  "related_paper",
  "created_at",
] as const;

/** Columns whose value is JSON, and so is sent as text and cast on the way in. */
const JSON_COLUMNS = new Set(["config", "metrics", "artifacts"]);

function json(status: number, value: unknown): LocalApiResponse {
  return { status, contentType: "application/json", body: JSON.stringify(value) };
}

function bad(status: number, error: string): LocalApiResponse {
  return json(status, { error });
}

function parseBody(request: LocalApiRequest): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(request.body ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A value the database can bind, or its JSON text when it is neither. */
function bind(value: unknown): SdkParam {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

async function saveExperiment(query: SdkQuery, row: Record<string, unknown>): Promise<LocalApiResponse> {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return bad(400, "Experiment must include id.");

  const columns: string[] = ["user_id"];
  const placeholders: string[] = ["$1"];
  const params: SdkParam[] = [LOCAL_USER_ID];

  for (const column of EXPERIMENT_COLUMNS) {
    if (!(column in row)) continue;
    params.push(bind(row[column]));
    columns.push(column);
    placeholders.push(`$${params.length}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`);
  }
  if (!columns.includes("id")) return bad(400, "Experiment must include id.");

  // `name` is not null in the schema, and an update that only carries new
  // metrics has no name to send. Every column but `id` is overwritten by what
  // arrived, so a partial save keeps whatever the row already held.
  const assignments = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  const sql =
    `insert into experiments (${columns.join(", ")}) values (${placeholders.join(", ")}) ` +
    `on conflict (id) do update set ${assignments} returning *`;
  const saved = await query(sql, params);
  if (!saved.ok) return bad(500, saved.message);
  return json(200, { experiment: saved.value[0] ?? null });
}

async function appendMetrics(query: SdkQuery, body: Record<string, unknown>): Promise<LocalApiResponse> {
  const points = body.points;
  if (!Array.isArray(points)) return bad(400, "Body must be { points: [...] }.");
  if (points.length === 0) return json(200, { ok: true, received: 0, stored: 0 });

  const values: string[] = [];
  const params: SdkParam[] = [LOCAL_USER_ID];
  for (const raw of points as Record<string, unknown>[]) {
    const step = Number(raw.step ?? 0);
    const value = Number(raw.value);
    if (!Number.isFinite(step) || !Number.isFinite(value)) {
      return bad(400, `A point needs a finite step and value, got ${JSON.stringify(raw)}.`);
    }
    params.push(bind(raw.experiment_id), bind(raw.metric), step, value, bind(raw.wall_time));
    const first = params.length - 4;
    values.push(`($1, $${first}, $${first + 1}, $${first + 2}, $${first + 3}, $${first + 4})`);
  }

  const written = await query(
    "insert into experiment_metrics (user_id, experiment_id, metric, step, value, wall_time) values " +
      values.join(", "),
    params,
  );
  if (!written.ok) return bad(500, written.message);

  // The same heartbeat the web route keeps: a run that is sending numbers is
  // running, whatever an earlier crash left the row saying.
  const ids = [...new Set(points.map((p) => bind((p as Record<string, unknown>).experiment_id)))].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length) {
    await query(
      "update experiments set started_at = now(), status = 'running' " +
        `where status in ('running', 'abandoned') and id in (${ids.map((_, i) => `$${i + 1}`).join(", ")})`,
      ids,
    );
  }
  return json(200, { ok: true, received: points.length, stored: points.length });
}

/**
 * Answer an `/api/sdk/*` request, or return `null` when the path is not one.
 *
 * Authentication happened before this was called: the local API's bearer token
 * is the same token for every route it serves.
 */
export async function routeSdkRequest(
  query: SdkQuery,
  request: LocalApiRequest,
  url: URL,
  path: string,
): Promise<LocalApiResponse | null> {
  if (!path.startsWith(SDK_PREFIX)) return null;
  const route = path.slice(SDK_PREFIX.length).replace(/\/$/, "");

  if (route === "whoami") {
    return json(200, { userId: LOCAL_USER_ID, email: null, fullName: null });
  }

  if (route === "projects") {
    const name = url.searchParams.get("name")?.trim();
    if (!name) return bad(400, "Missing project name.");
    const found = await query("select id from projects where name = $1 limit 1", [name]);
    if (!found.ok) return bad(500, found.message);
    const row = found.value[0] as { id?: string } | undefined;
    return json(200, { projectId: row?.id ?? null });
  }

  if (route === "experiments") {
    if (request.method === "GET" || request.method === "DELETE") {
      const id = url.searchParams.get("id")?.trim();
      if (!id) return bad(400, "Missing experiment id.");
      if (request.method === "GET") {
        const found = await query("select * from experiments where id = $1 limit 1", [id]);
        if (!found.ok) return bad(500, found.message);
        return json(200, { experiment: found.value[0] ?? null });
      }
      const gone = await query("delete from experiments where id = $1 returning id", [id]);
      if (!gone.ok) return bad(500, gone.message);
      if (!gone.value.length) return bad(404, "Experiment not found.");
      return json(200, { ok: true });
    }
    if (request.method !== "POST") return bad(405, "That method is not served here.");
    const body = parseBody(request);
    if (!body) return bad(400, "Invalid JSON body.");
    return saveExperiment(query, body);
  }

  if (route === "metrics") {
    if (request.method !== "POST") return bad(405, "That method is not served here.");
    const body = parseBody(request);
    if (!body) return bad(400, "Invalid JSON body.");
    return appendMetrics(query, body);
  }

  return bad(404, "No such route.");
}
