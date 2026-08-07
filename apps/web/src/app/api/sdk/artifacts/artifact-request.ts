/**
 * Validating an artifact upload, apart from the route that performs it.
 *
 * Separate so the rules can be tested without a Supabase client, a token, or a
 * network: every one of them is a rule about a string, and the route's job is
 * only to apply them before it writes.
 */

/**
 * Largest artifact accepted.
 *
 * This endpoint takes base64 in a JSON body, which means the bytes are held in
 * memory twice — once encoded, once decoded — before anything is written. It is
 * for the outputs of an experiment: a plot, a metrics dump, a config. Model
 * weights belong in object storage the user owns, not in a JSON request.
 */
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

/** Base64 is four characters per three bytes, so the body runs a third larger. */
export const MAX_BODY_BYTES = Math.ceil(MAX_ARTIFACT_BYTES * (4 / 3)) + 4096;

/** Path segments are `{userId}/{experimentId}/{name}`, so a segment holds no slash. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export type ArtifactRequestResult =
  | { ok: true; experimentId: string; name: string; contentType: string; bytes: Buffer }
  | { ok: false; status: number; error: string };

function badRequest(error: string, status = 400): ArtifactRequestResult {
  return { ok: false, status, error };
}

/**
 * A storage key segment that cannot escape its prefix.
 *
 * The upload path is built by joining three segments, so a name containing a
 * slash or a `..` would write outside the caller's own folder — into another
 * user's, given the right value. An allowlist rather than a blocklist: the set
 * of characters a filename needs is small, and everything outside it is easier
 * to refuse than to reason about.
 */
export function isSafeSegment(value: unknown): value is string {
  return typeof value === "string" && SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

/**
 * Decoded length of a base64 string, without decoding it.
 *
 * The point of checking first: decoding is what allocates, so a body claiming
 * to hold a gigabyte must be refused before the allocation, not after.
 */
export function base64ByteLength(value: string): number {
  const trimmed = value.replace(/=+$/, "");
  return Math.floor((trimmed.length * 3) / 4);
}

/**
 * Whether a body is worth reading at all.
 *
 * `Content-Length` is a claim by the client and cannot be trusted to be
 * accurate — but it can be trusted when it admits to being too large, which is
 * enough to reject the common case before buffering anything.
 */
export function exceedsDeclaredLimit(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

export function parseArtifactRequest(body: unknown): ArtifactRequestResult {
  if (!body || typeof body !== "object") return badRequest("Invalid JSON body.");

  const { experimentId, name, contentType, dataBase64 } = body as Record<string, unknown>;

  if (!experimentId || !name || !dataBase64) {
    return badRequest("Body must include experimentId, name, dataBase64.");
  }
  if (!isSafeSegment(experimentId)) {
    return badRequest("experimentId must be a plain identifier with no path separators.");
  }
  if (!isSafeSegment(name)) {
    return badRequest(
      "name must be 1-128 characters of letters, digits, dot, dash or underscore, with no path separators.",
    );
  }
  if (typeof dataBase64 !== "string") return badRequest("dataBase64 must be a string.");

  if (base64ByteLength(dataBase64) > MAX_ARTIFACT_BYTES) {
    return badRequest(
      `Artifact exceeds the ${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)} MB limit.`,
      413,
    );
  }

  const bytes = Buffer.from(dataBase64, "base64");
  // Re-checked after decoding: the estimate assumes well-formed base64, and a
  // string that is not gets silently dropped rather than rejected by Buffer.
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    return badRequest(
      `Artifact exceeds the ${Math.round(MAX_ARTIFACT_BYTES / 1024 / 1024)} MB limit.`,
      413,
    );
  }
  if (bytes.byteLength === 0) return badRequest("dataBase64 decoded to no bytes.");

  return {
    ok: true,
    experimentId,
    name,
    // Never echoed back to a browser as a document; an artifact is downloaded,
    // and a caller-supplied type is not a reason to let one render inline.
    contentType: typeof contentType === "string" && contentType.trim() ? contentType : "application/octet-stream",
    bytes,
  };
}
