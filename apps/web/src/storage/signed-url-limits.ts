/**
 * Bounds on what one signed-url request may ask for.
 *
 * Both numbers arrive in the request body, and neither was checked: a caller
 * could ask for any number of paths — one registry round-trip each — and for a
 * lifetime of any length. The minted URL carries its own signature and is
 * readable by anyone holding it, so a long TTL turns a leaked link into a
 * permanent one. The cap is generous next to real batches (a note's images, a
 * paper's attachments) and still bounds both. The relay enforces both
 * (wf-core `storage::blob_access`); the client batches by the path cap.
 */
export const MAX_SIGNED_URL_PATHS = 200;

