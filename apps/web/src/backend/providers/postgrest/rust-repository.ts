import type { ProjectContext } from "@/lib/parts-2";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EntityStamp,
  IAiAuditStore,
  IAiProposalStore,
  ICurrentUserProvider,
  IShareLinkRepository,
  IVaultPageManager,
  IVaultPageRepository,
  VaultPage,
} from "@weaveforge/core";
import type { RepoCtx, RepoQuery } from "@weaveforge/wasm";
import type { Resolved } from "./parts-1";

// --- rust-repository ---
/*
 * Repositories whose queries Rust plans (`crates/wf-core/src/repo_query.rs`, option 2 of
 * docs/building/core/data-access.md). Rust names the table, columns, filters and bodies,
 * and maps the rows; this is the one place that sends them.
 */

/** The supabase-js builder, seen only through the method names a query uses. */
type Chain = PromiseLike<Resolved<unknown> & { count?: number | null }> & Record<string, unknown>;

/** Calls builder method `method` on `b`; Rust names the method, so it is checked. */
function invoke(b: Chain, method: string, ...args: unknown[]): Chain {
  const fn = b[method];
  if (typeof fn !== "function") throw new Error(`Unknown query method ${method}`);
  return fn.apply(b, args) as Chain;
}

/** Method arguments as Rust reads them: bytes as number arrays, dates as ISO text. */
function argForRust(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(argForRust);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, argForRust(v)]));
  }
  return value;
}

/**
 * Local PGlite rows carry `Date`s and bytea as `Uint8Array`; Rust reads them as
 * PostgREST sends them: timestamps as ISO text, bytea as `\x` hex.
 */
function replyAsText(data: unknown): unknown {
  if (data instanceof Date) return data.toISOString();
  if (data instanceof Uint8Array) return `\\x${Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (Array.isArray(data)) return data.map(replyAsText);
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, replyAsText(v)]));
  }
  return data;
}

/** Sends one Rust-planned query and returns its rows, RPC result or count; throws the PostgREST error. */
export async function sendQuery(db: SupabaseClient, q: RepoQuery): Promise<unknown> {
  let b: Chain;
  if (q.rpc) {
    b = db.rpc(q.rpc, (q.body ?? {}) as Record<string, unknown>) as unknown as Chain;
  } else {
    const table = db.from(q.table) as unknown as Chain;
    if (q.count) b = invoke(table, "select", q.columns ?? "id", { count: "exact", head: true });
    else if (q.action === "select") b = invoke(table, "select", q.columns ?? "*");
    else if (q.action === "delete") b = invoke(table, "delete");
    else if (q.action === "upsert") {
      b = invoke(table, "upsert", q.body, { onConflict: q.onConflict, ignoreDuplicates: q.ignoreDuplicates });
    } else b = invoke(table, q.action, q.body);
    if (q.action !== "select" && q.columns !== undefined) b = invoke(b, "select", q.columns);
  }
  for (const f of q.filters) {
    if (f.op === "or") b = invoke(b, "or", f.value);
    else if (f.op === "not" || f.op === "filter") b = invoke(b, f.op, f.column, ...(f.value as unknown[]));
    else b = invoke(b, f.op, f.column, f.value);
  }
  for (const o of q.order) b = invoke(b, "order", o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  if (q.range) b = invoke(b, "range", q.range[0], q.range[1]);
  if (q.limit !== undefined) b = invoke(b, "limit", q.limit);
  if (q.single === "one") b = invoke(b, "single");
  else if (q.single === "maybe") b = invoke(b, "maybeSingle");
  const { data, error, count } = await b;
  if (error && q.soft) {
    const e = error as { code?: string; message?: string };
    return { error: { code: e.code ?? null, message: e.message ?? String(error) } };
  }
  if (error) throw error;
  if (q.count) return count ?? 0;
  return replyAsText(data ?? null);
}

/** The selected project and signed-in user, asked fresh on every call. */
export function projectUserCtx(project: ProjectContext, session?: ICurrentUserProvider): () => Promise<RepoCtx> {
  return async () => ({
    projectId: project.projectId ?? undefined,
    userId: (await session?.getCurrentUserId()) ?? undefined,
  });
}

/** The vault page repository, plus the stamp and by-id reads the cache and sharing use. */
export type RustVaultPageRepository = IVaultPageRepository & IVaultPageManager & {
  listStamps(): Promise<EntityStamp[]>;
  listByIds(ids: readonly string[]): Promise<VaultPage[]>;
};

/** `vault_pages` through the Rust step engine, scoped to the current project. */
export function rustVaultPageRepository(db: SupabaseClient, project: ProjectContext): RustVaultPageRepository {
  return rustRepository<RustVaultPageRepository>(db, "vault_pages", ["getById", "listStamps", "listByIds", "list", "listSummaries", "getTree", "titleTaken", "save", "delete", "add", "update", "remove"], projectUserCtx(project));
}

/** The share-link repository. Rust returns `redeem`'s `dekWrap` as a number array. */
export function rustShareLinkRepository(db: SupabaseClient): IShareLinkRepository {
  const repo = rustRepository<IShareLinkRepository>(db, "share_links", [
    "getById",
    "listForResource",
    "save",
    "delete",
    "redeem",
  ]);
  return {
    ...repo,
    redeem: async (tokenHash) => {
      const link = await repo.redeem(tokenHash);
      return link && { ...link, dekWrap: link.dekWrap && Uint8Array.from(link.dekWrap) };
    },
  };
}

/** The AI proposal and audit stores, scoped to the open project and signed-in user. */
export function rustAiStores(db: SupabaseClient, project: ProjectContext, session: ICurrentUserProvider) {
  const ctx = projectUserCtx(project, session);
  return {
    proposals: rustRepository<IAiProposalStore>(db, "ai_proposals", ["save", "claimPending", "getById", "listPending"], ctx),
    audit: rustRepository<IAiAuditStore & { countAccepted(): Promise<number> }>(
      db,
      "ai_audit",
      ["save", "countAccepted"],
      ctx,
    ),
  };
}

/** More steps than any method needs: a step function that never finishes is a bug. */
const MAX_REPO_STEPS = 64;

/**
 * A repository whose methods Rust runs: each call asks `repoStep` what to send, sends it,
 * and asks again with the replies until Rust returns a value or an error.
 */
export function rustRepository<T extends object>(
  db: SupabaseClient,
  name: string,
  methods: readonly (keyof T & string)[],
  ctx: () => RepoCtx | Promise<RepoCtx> = () => ({}),
): T {
  const repo: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of methods) {
    repo[method] = async (...args: unknown[]) => {
      const context: RepoCtx = {
        ...(await ctx()),
        now: new Date().toISOString(),
        idSeed: crypto.randomUUID(),
      };
      const replies: unknown[] = [];
      const rustArgs = args.map(argForRust);
      for (let i = 0; i < MAX_REPO_STEPS; i++) {
        const step = readyCore().repoStep(name, method, rustArgs, context, replies);
        if (step.kind === "done") return step.value;
        if (step.kind === "fail") {
          const error = new Error(step.message);
          if (step.name) error.name = step.name;
          throw error;
        }
        replies.push(...(await Promise.all(step.queries.map((q) => sendQuery(db, q)))));
      }
      throw new Error(`${name}.${method} did not finish in ${MAX_REPO_STEPS} steps`);
    };
  }
  return repo as T;
}
