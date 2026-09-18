/**
 * Node-side pieces of the showcase seed: loading chart PNGs from
 * apps/web/public/showcase/ and a blob store for the seeder.
 *
 * Blobs go through the deployed app's own `/api/blobs/*` routes as the demo
 * user when storage is tiered (R2 behind the app's server credentials), and
 * straight to Supabase Storage with the service role otherwise. The seeder
 * itself lives in apps/web/src/features/showcase and is shared with the
 * desktop build.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ASSETS = resolve(__dir, "../../apps/web/public/showcase");

function chartPath(kind) {
  return join(SHOWCASE_ASSETS, `${kind}.png`);
}

function blobProvider() {
  return process.env.NEXT_PUBLIC_BLOB_PROVIDER ?? process.env.BLOB_PROVIDER ?? "supabase";
}

/**
 * A `ShowcaseBlobStore` for the seeder: `upload(bucket, path, blob, contentType)`.
 *
 * `session` is `{ accessToken, appUrl }` for a signed-in demo user; required
 * when the deployment is tiered, ignored otherwise.
 */
export function seedBlobStore(admin, session) {
  const tiered = blobProvider() === "tiered";
  if (tiered && !session?.accessToken) {
    throw new Error("Tiered storage: sign in as the demo user to upload through the app (see seedUserSession).");
  }
  return {
    async upload(bucket, path, blob, contentType = "application/octet-stream") {
      if (tiered) {
        const form = new FormData();
        form.set("bucket", bucket);
        form.set("path", path);
        form.set("file", blob, path.split("/").pop() ?? "file");
        form.set("contentType", contentType);
        const res = await fetch(`${session.appUrl.replace(/\/$/, "")}/api/blobs/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(`upload ${bucket}/${path}: ${body.error ?? res.status}`);
        }
        return;
      }
      const bytes = Buffer.from(await blob.arrayBuffer());
      const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
  };
}

/** Load PNG bytes for a showcase chart; generates assets if missing. */
export function loadShowcaseChart(kind) {
  let path = chartPath(kind);
  if (!existsSync(path)) {
    ensureShowcaseAssets();
    path = chartPath(kind);
  }
  if (!existsSync(path)) {
    throw new Error(`Missing showcase chart "${kind}" — run: python scripts/generate-showcase-charts.py`);
  }
  return readFileSync(path);
}

/** Generate apps/web/public/showcase/*.png when matplotlib is available. */
export function ensureShowcaseAssets() {
  const sample = chartPath("attention-arch");
  if (existsSync(sample)) return true;

  const script = resolve(__dir, "../generate-showcase-charts.py");
  const py = process.platform === "win32" ? "python" : "python3";
  const run = spawnSync(py, [script], { encoding: "utf8", cwd: resolve(__dir, "..") });
  if (run.status !== 0) {
    console.warn(
      "  Could not generate showcase charts (install matplotlib: pip install matplotlib numpy).",
    );
    if (run.stderr?.trim()) console.warn(`  ${run.stderr.trim().split("\n").pop()}`);
    return false;
  }
  return existsSync(sample);
}
