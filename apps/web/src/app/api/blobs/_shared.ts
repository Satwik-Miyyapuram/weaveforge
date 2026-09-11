import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { readStorageConfig } from "@/storage/config";
import { BlobAccessError } from "@/storage/server/blob-access";
import { formatError, formatErrorForResponse } from "@/lib/format-error";

/**
 * The gate every tiered-blob route passes before it reads the request: the
 * deployment stores blobs itself, and the caller is authenticated.
 *
 * The provider check stays first and stays a 503, so a deployment that does not
 * run the tiered store says so rather than reporting an auth failure for a
 * route that could not work anyway.
 *
 * Auth is `requireSdkUser` — the same helper `pdf-proxy`, `url-meta` and the
 * SDK routes use. These routes used to run their own `bearerToken()` plus
 * `userIdFromToken()` pair, which was a third variant of the same check and
 * differed from the other two in its status codes: a missing Supabase config
 * came back as `401 Not authenticated.` rather than the `500`/`503` the shared
 * helper answers, so an operator with a broken deployment was told to sign in
 * again. One helper, one set of codes.
 *
 * What the caller receives is the *access* token, not the header value: an SDK
 * API token (`tt_…`) is not a JWT, and the storage layer builds its Supabase
 * client from what it is given. `requireSdkUser` mints the JWT for an API token
 * and hands back the caller's own token otherwise.
 *
 * `userId` comes back with it so the routes do not repeat the `userIdFromToken`
 * round trip the helper has already made.
 */
export async function tieredBlobToken(
  request: Request,
): Promise<{ token: string; userId: string } | { refusal: NextResponse }> {
  const refusal = tieredProviderRefusal();
  if (refusal) return { refusal: refusal };
  const auth = await requireSdkUser(request);
  if (!auth.ok) return { refusal: auth.response };
  return { token: auth.accessToken, userId: auth.userId };
}

/**
 * The storage-provider gate on its own, or null when this deployment runs the
 * tiered store.
 *
 * Split out for the upload route, which needs the provider answer before it
 * checks the declared body size, and that before it authenticates. Reading a
 * `content-length` header costs nothing and needs no identity, so an upload a
 * client has already declared oversized is refused without resolving a token
 * first — and a deployment that does not run the tiered store still says so
 * rather than answering a size question about a route that could not work.
 * Routes with no body to weigh keep calling `tieredBlobToken`.
 */
export function tieredProviderRefusal(): NextResponse | null {
  if (readStorageConfig().provider !== "tiered") {
    return NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 });
  }
  return null;
}

/**
 * A blob failure told apart: a bad request, someone else's path, no session, or
 * a real fault.
 *
 * The guards in `storage/server/blob-access.ts` throw a `BlobAccessError`
 * carrying its own status, and that is what is branched on first. The message
 * checks below stay as a fallback for the plain `Error`s other layers still
 * throw ("Forbidden" from the content path's own guard, "Not authenticated."
 * from `userIdFromToken`) — they were the only signal available before, and
 * dropping them would turn a 403 into a 500 for anything outside this module.
 *
 * The status is decided from `formatError`, the display formatter, and the body
 * from `formatErrorForResponse`, the wire one: a database fault must not name a
 * table in the response, but it still has to be classified the same way as
 * before.
 */
export function blobFailure(err: unknown): NextResponse {
  const message = formatError(err);
  const status =
    err instanceof BlobAccessError
      ? err.status
      : message === "Not authenticated."
        ? 401
        : message.startsWith("Forbidden")
          ? 403
          : 500;
  return NextResponse.json({ error: formatErrorForResponse(err, "blobs") }, { status });
}
