/**
 * Validating a relay envelope's request, apart from the route that accepts it.
 *
 * Same split as `sdk/artifacts/artifact-request.ts`, and for the same two
 * reasons: a Next.js App Router `route.ts` may only export route handlers and
 * route config, so rules exported beside the handler fail the production
 * build's route type check; and a rule about a string is testable without a
 * token, a Supabase client or a network.
 */

/**
 * Largest envelope accepted, in base64 characters.
 *
 * The relay carries an encrypted JSON request, and both of its fields are
 * base64 — so one character is one byte on the wire, and measuring the payload
 * directly avoids serialising it only to count UTF-16 units. `validEnvelope`
 * has used this number since the route was written; it is named here so the
 * body cap below can be derived from it rather than guessed at.
 */
export const MAX_ENVELOPE_CHARS = 64_000;

/**
 * Body cap, checked against `Content-Length` before `request.json()` runs.
 *
 * The envelope is the only large field, so the envelope cap plus room for the
 * JSON scaffolding around it is the whole body. Anything past that is refused
 * unread — `json()` buffers the entire request before it parses, and the
 * envelope was only ever bounded *after* that buffer existed.
 */
export const MAX_BODY_BYTES = MAX_ENVELOPE_CHARS + 4_096;

/** Whether a declared body size is past the cap; an absent header is not a claim. */
export function exceedsDeclaredLimit(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

/**
 * Canonical UUID text, the shape Postgres stores.
 *
 * `session_id` and `id` are `uuid` columns. Sending free text to one does not
 * store it: PostgREST answers `22P02 invalid input syntax for type uuid`, which
 * the route then reported as a 500 with that message — a client mistake
 * presented as a server fault, and an internal error string handed back to the
 * caller. Checking the shape here turns it into the 400 it always was.
 *
 * Deliberately the plain canonical form and not a version check: Postgres
 * accepts the nil UUID and any hex grouping, and a client that generated one
 * with a library this code has never seen should not be refused for it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** An encrypted envelope: two base64 strings whose combined width is capped. */
export interface RelayEnvelope {
  iv: string;
  ciphertext: string;
}

export function validEnvelope(value: unknown): value is RelayEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as RelayEnvelope;
  if (typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string") return false;
  return envelope.iv.length + envelope.ciphertext.length <= MAX_ENVELOPE_CHARS;
}
