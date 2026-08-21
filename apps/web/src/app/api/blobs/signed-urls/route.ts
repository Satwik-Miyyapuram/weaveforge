import { NextResponse } from "next/server";
import { bearerToken, blobRegistryForToken, userIdFromToken } from "@/storage/server/blob-api";
import { blobContentUrl } from "@/storage/server/blob-view-token";
import { readStorageConfig } from "@/storage/config";
import { formatError } from "@/lib/format-error";
import { clampTtlSeconds, MAX_SIGNED_URL_PATHS } from "@/storage/signed-url-limits";

export async function POST(request: Request) {
  if (readStorageConfig().provider !== "tiered") {
    return NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 });
  }
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { bucket?: string; paths?: string[]; ttlSeconds?: number };
  try {
    body = (await request.json()) as { bucket?: string; paths?: string[]; ttlSeconds?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.bucket || !Array.isArray(body.paths)) {
    return NextResponse.json({ error: "bucket and paths are required." }, { status: 400 });
  }
  if (body.paths.length > MAX_SIGNED_URL_PATHS) {
    return NextResponse.json(
      { error: `At most ${MAX_SIGNED_URL_PATHS} paths per request.` },
      { status: 400 },
    );
  }

  const ttlSeconds = clampTtlSeconds(body.ttlSeconds);
  const origin = new URL(request.url).origin;

  try {
    const uid = await userIdFromToken(token);
    const registry = await blobRegistryForToken(token);
    const bucket = body.bucket;
    const urls: (string | null)[] = new Array(body.paths.length).fill(null);
    await Promise.all(
      body.paths.map(async (path, index) => {
        const rec = await registry.get(bucket, path);
        if (!rec) {
          urls[index] = null;
          return;
        }
        urls[index] = blobContentUrl(
          origin,
          {
            uid,
            bucket,
            path,
            tier: rec.tier,
          },
          ttlSeconds,
        );
        try {
          await registry.recordAccess(bucket, path);
        } catch {
          /* shared viewers cannot update owner registry rows */
        }
      }),
    );
    return NextResponse.json({ urls });
  } catch (err) {
    const message = formatError(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
