/**
 * Browser network failures, which arrive as a bare TypeError.
 *
 * "Failed to fetch" (Chrome), "NetworkError when attempting to fetch
 * resource." (Firefox) and "Load failed" (Safari) all mean the same thing:
 * the request never reached a server, so there is no status and no body to
 * report. Shown raw it reads like a bug in the app rather than something the
 * reader can act on.
 */
const NETWORK_FAILURES = ["failed to fetch", "networkerror", "load failed"];

function networkFailureMessage(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("dynamically imported module")) {
    return "Could not load part of the app. This usually means a new version was deployed while this tab was open — reload the page.";
  }
  if (!NETWORK_FAILURES.some((phrase) => lower.includes(phrase))) return null;
  // The client names the host it was going to (see providers/supabase/client),
  // and this app talks to two of them — keep it, because "which one" is the
  // whole of what a reader can pass on to whoever can fix it.
  const host = /\(could not reach ([^)]+)\)/.exec(message)?.[1];
  const what = host ? `Could not reach ${host}.` : "Could not reach the server.";
  return `${what} The request never left this browser, so check your connection, VPN, or any extension blocking it, then try again.`;
}
/** Extract a human-readable message from unknown thrown values (incl. Supabase/PostgREST). */
export function formatError(err: unknown): string {
  if (err == null) return "Something went wrong.";

  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed && trimmed !== "[object Object]" ? trimmed : "Something went wrong.";
  }

  if (err instanceof Error) {
    const trimmed = err.message?.trim();
    if (trimmed && trimmed !== "[object Object]") return networkFailureMessage(trimmed) ?? trimmed;
  }

  if (typeof err === "object") {
    const record = err as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) {
      const trimmed = message.trim();
      // supabase-js hands a failed fetch back as a plain object, so the network
      // wording has to be reachable from here too, not only from Error.
      return networkFailureMessage(trimmed) ?? trimmed;
    }
    if (message != null && typeof message === "object") return formatError(message);

    const code = typeof record.code === "string" ? record.code : null;
    const details = typeof record.details === "string" ? record.details : null;
    const hint = typeof record.hint === "string" ? record.hint : null;
    const errorField = record.error;
    if (errorField != null && errorField !== err) {
      const nested = formatError(errorField);
      if (nested !== "Something went wrong.") return nested;
    }

    const parts: string[] = [];
    if (typeof message === "string" && message.trim()) parts.push(message.trim());
    if (details) parts.push(details);
    if (hint) parts.push(hint);
    if (code) parts.push(`(${code})`);
    if (parts.length > 0) {
      const text = parts.join(" — ");
      if (text.includes("api_tokens") || code === "PGRST205" || code === "42P01") {
        return `${text}. Run supabase db push (migration 0061) if API tokens are not set up yet.`;
      }
      return text;
    }
  }

  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}" && json !== "null") return json;
  } catch {
    /* ignore */
  }

  return "Something went wrong.";
}

/** Parse a fetch response body; empty or invalid JSON becomes a safe object. */
export async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { data: parsed };
  } catch {
    return { error: text.slice(0, 300) || `Request failed (${res.status}).` };
  }
}

// ---------------------------------------------------------------------------
// The wire formatter.
//
// `formatError` above is the *display* formatter: it is what the UI shows the
// person whose own data is in the message, in their own browser, and its whole
// point is to be specific — "permission denied for table user_settings" is a
// bad thing to hide from the person who owns the database it names. It is the
// right thing to hand a `<p class="error">` and the wrong thing to hand a
// response body.
//
// So there are two, and this is the second. Everything a route puts in
// `{ error: ... }` goes through `formatErrorForResponse`, which keeps the
// caller's own mistakes legible and replaces the server's internals with
// something that says the same thing without naming a table, a constraint or a
// column.
//
// What actually leaked before this: a PostgREST failure reaches a route as
// `{ message, details, hint, code }` and routes returned `error.message`
// verbatim (or `formatError(error)`, which for that shape *is* the message).
// Raw Postgres text includes `duplicate key value violates unique constraint
// "api_tokens_token_hash_idx"`, `new row violates row-level security policy for
// table "experiment_metric_points"` and `relation "user_settings" does not
// exist` — schema names, and in the unique-violation case the key value itself,
// i.e. the caller's own token hash. The `message — details — hint (code)` join
// the review cites is real but is only reached for an error with no `message`
// at all; the leak does not depend on it. That join is still the display
// formatter's job and is unchanged.
// ---------------------------------------------------------------------------

/**
 * The SQLSTATE classes PostgreSQL actually defines.
 *
 * A SQLSTATE is five characters — a two-character class and a three-character
 * subclass — and the class is *not* always numeric: `XX000` is `internal_error`,
 * `P0001` is a `raise exception` from a function, `HV000` is foreign-data
 * wrapper. A digits-only test would therefore pass `XX000` straight through to
 * the caller unsanitised, which is the leak this formatter exists to close, so
 * the classes are listed rather than pattern-matched.
 *
 * The list is Appendix A of the PostgreSQL manual. A code whose class is not
 * here is not treated as a database error — which is what keeps Node's own
 * errno codes out. They are also five uppercase letters (`EPERM`, `EBADF`,
 * `ENXIO`, `EPIPE`), and classifying one as a database error would hide a
 * filesystem message behind "Something went wrong on the server."
 */
const SQLSTATE_CLASSES = new Set([
  "00", "01", "02", "03", "08", "09", "0A", "0B", "0F", "0L", "0P", "0Z",
  "20", "21", "22", "23", "24", "25", "26", "27", "28", "2B", "2D", "2F",
  "34", "38", "39", "3B", "3D", "3F", "40", "42", "44",
  "53", "54", "55", "57", "58", "72",
  "F0", "HV", "P0", "XX",
]);

/** A PostgreSQL SQLSTATE, or a PostgREST-invented code (`PGRST205`). */
function databaseCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const raw = (err as { code?: unknown }).code;
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (!code) return null;
  if (code.startsWith("PGRST")) return code;
  if (code.length === 5 && SQLSTATE_CLASSES.has(code.slice(0, 2))) return code;
  return null;
}

/**
 * The database refusals that are the caller's to fix, in the caller's terms.
 *
 * Class-level rather than message-level, deliberately: the raw text is what
 * leaks, so the replacement is chosen from the code alone and never quotes the
 * original. `42501` is both "permission denied" and a row-level-security
 * refusal — Postgres reports a policy rejection as `42501` — which is why the
 * wording is about permission rather than about the schema.
 */
const CALLER_FAULT_MESSAGES: Record<string, string> = {
  "23502": "A required field was missing.",
  "23503": "That refers to a record that no longer exists.",
  "23505": "That value is already in use.",
  "23514": "One of the values sent was not accepted.",
  "22P02": "One of the values sent was in the wrong format.",
  "42501": "You do not have permission to do that.",
};

/**
 * Codes that mean "this deployment has not run its migrations".
 *
 * `42P01` is undefined_table and `PGRST205` is PostgREST's "not in the schema
 * cache" — the two ways a missing migration presents itself.
 *
 * The hint is kept, deliberately, because it is the one case where the generic
 * message is actively unhelpful to the only person who can act on it: an
 * operator who has just deployed and forgotten `supabase db push` sees a 500 on
 * every request and needs to be told why. What is *not* kept is the table name
 * — the existing hint in `formatError` says "if API tokens are not set up yet",
 * which names a table to whoever is holding the response. The reworded version
 * says the same useful thing without it. Every route that reaches this formatter
 * has already required a bearer token, so this is not an unauthenticated
 * disclosure either way, but it costs nothing to say it without the table.
 */
const MIGRATION_INCOMPLETE = new Set(["42P01", "PGRST205"]);

const MIGRATION_HINT =
  "The server is missing a database migration; run supabase db push and try again.";

/** The hidden detail, in a form a log reader can use. */
function describeForLog(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

/**
 * The message a route may put in a response body.
 *
 * Anything the database produced is replaced: the full error is logged (the
 * convention in this codebase is `console.error` — see `error-boundary-parts`)
 * and the caller gets the SQLSTATE's safe wording plus the code itself. The
 * code is kept because it is the single most useful debugging token for the SDK
 * caller and names nothing: "You do not have permission to do that. (42501)" is
 * actionable, and `42501` says no more than the sentence does.
 *
 * Anything else — a validation error, a config message, a network failure, a
 * deliberate refusal thrown by this application — is already written for a
 * reader and passes through unchanged. That is the half the SDK needs: a
 * `MemberValidationError` still explains itself, and `Server is missing
 * SUPABASE_JWT_SECRET` still reads as the 503 it is.
 */
export function formatErrorForResponse(err: unknown, context = "api"): string {
  const code = databaseCode(err);
  if (code === null) return formatError(err);

  const safe = MIGRATION_INCOMPLETE.has(code) ? MIGRATION_HINT : CALLER_FAULT_MESSAGES[code];
  console.error(`[${context}] database error ${code}: ${describeForLog(err)}`);
  return `${safe ?? "Something went wrong on the server."} (${code})`;
}
