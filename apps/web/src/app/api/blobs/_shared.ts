import { NextResponse } from "next/server";
import { bearerToken } from "@/storage/server/blob-api";
import { readStorageConfig } from "@/storage/config";
import { formatError } from "@/lib/format-error";

/**
 * The two checks every tiered-blob route makes before it reads the request:
 * the deployment stores blobs itself, and the caller brought a token.
 */
export function tieredBlobToken(request: Request): { token: string } | { refusal: NextResponse } {
  if (readStorageConfig().provider !== "tiered") {
    return { refusal: NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 }) };
  }
  const token = bearerToken(request);
  if (!token) return { refusal: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  return { token };
}

/** A blob failure told apart: someone else's path, no session, or a real fault. */
export function blobFailure(err: unknown): NextResponse {
  const message = formatError(err);
  const status = message.startsWith("Forbidden") ? 403 : message === "Not authenticated." ? 401 : 500;
  return NextResponse.json({ error: message }, { status });
}
