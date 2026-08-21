/**
 * Bounds on what one signed-url request may ask for.
 *
 * Both numbers arrive in the request body, and neither was checked: a caller
 * could ask for any number of paths — one registry round-trip each — and for a
 * lifetime of any length. The minted URL carries its own signature and is
 * readable by anyone holding it, so a long TTL turns a leaked link into a
 * permanent one. The cap is generous next to real batches (a note's images, a
 * paper's attachments) and still bounds both.
 */
export const MAX_SIGNED_URL_PATHS = 200;

export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 3600;

/** The requested lifetime, brought inside the allowed range. */
export function clampTtlSeconds(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return MAX_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(requested)));
}
