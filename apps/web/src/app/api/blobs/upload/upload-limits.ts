/**
 * Bounds on what one blob upload may carry.
 *
 * Apart from the route that applies them, for two reasons: a Next.js App Router
 * `route.ts` may only export route handlers and route config, so a constant
 * exported beside the handler fails the production build's route type check;
 * and the rules are then testable without a tiered storage config, a token or a
 * Supabase client — see `sdk/artifacts/artifact-request.ts` for the same split.
 */

/**
 * Largest blob accepted.
 *
 * This route carries images and experiment artifacts (`paper-images`,
 * `vault-assets`, `report-images`, `experiment-artifacts`). A 25 MB ceiling
 * matches the artifact route next door, which is the sibling upload path and
 * the one whose shape this route is being brought in line with.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Room for the multipart envelope around the file.
 *
 * `request.formData()` buffers the whole body, so the only check that can
 * happen before anything is allocated is on the declared `Content-Length` —
 * and that length covers the boundaries and the `bucket`/`path`/`contentType`
 * fields, not just the file. Refusing on the raw file limit would reject a
 * perfectly legal upload whose file lands a few hundred bytes under the cap.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** The declared body size past which the request is refused unread. */
export const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES;

/**
 * Whether a body is worth reading at all.
 *
 * `Content-Length` is a claim by the client and cannot be trusted to be
 * accurate — but it can be trusted when it admits to being too large, which is
 * enough to reject the common case before buffering anything. A body that
 * declares nothing (chunked transfer) is not refused here; it is caught by the
 * file check after parsing, which is the second half of the same rule.
 */
export function exceedsDeclaredLimit(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}
