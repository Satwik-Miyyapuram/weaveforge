import { NextResponse } from "next/server";
import { blobRegistryForToken } from "@/storage/server/blob-api";
import { blobContentUrl } from "@/storage/server/blob-view-token";
import { clampTtlSeconds, MAX_SIGNED_URL_PATHS } from "@/storage/signed-url-limits";
import { blobFailure, tieredBlobToken } from "../_shared";

/**
 * Mint signed content URLs for a batch of blobs.
 *
 * Two round trips, not six hundred. The route used to call `registry.get` and
 * then `registry.recordAccess` once per path, and `recordAccess` was itself a
 * `get` followed by an `update` — so a full 200-path request bought ~600
 * PostgREST round trips and a lost-update race on every `access_count`.
 * `getMany` is one `in` query and `recordAccessMany` is one statement that
 * increments server-side (migration 0125).
 *
 * Ordering is preserved through the batched read by mapping over the request's
 * paths and looking each one up, rather than iterating whatever order the
 * database returned — the caller is handed one URL per path it sent, in the
 * order it sent them.
 */
export async function POST(request: Request) {
  const gate = await tieredBlobToken(request);
  if ("refusal" in gate) return gate.refusal;
  const token = gate.token;

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
    const uid = gate.userId;
    const registry = await blobRegistryForToken(token);
    const bucket = body.bucket;
    const records = await registry.getMany(bucket, body.paths);

    const urls: (string | null)[] = body.paths.map((path) => {
      const rec = records.get(path);
      if (!rec) return null;
      return blobContentUrl(
        origin,
        {
          uid,
          bucket,
          path,
          tier: rec.tier,
        },
        ttlSeconds,
      );
    });

    // Only the paths that resolved are counted, which is what the per-path
    // version did — and one statement covers all of them.
    const minted = body.paths.filter((path) => records.has(path));
    try {
      await registry.recordAccessMany(bucket, minted);
    } catch {
      /* shared viewers cannot update owner registry rows; a no-op, never a denial */
    }

    return NextResponse.json({ urls });
  } catch (err) {
    return blobFailure(err);
  }
}
