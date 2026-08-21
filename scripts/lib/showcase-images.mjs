import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const __dir = dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ASSETS = resolve(__dir, "../assets/showcase");
const PAPER_IMAGE_PREFIX = "paperimg:";
const ARTIFACT_EXPIRES_S = 10 * 365 * 24 * 3600;
/** R2/S3 SigV4 presigned URLs are capped at 7 days. */
const R2_ARTIFACT_EXPIRES_S = 7 * 24 * 3600 - 60;
const PAPER_IMAGES_BUCKET = "paper-images";

/** Escape alt text for markdown image syntax. */
function escapeAlt(alt) {
  const s = String(alt).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "image";
  return s.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function paperImageMarkdown(path, alt = "image") {
  return `![${escapeAlt(alt)}](${PAPER_IMAGE_PREFIX}${path})`;
}

function chartPath(kind) {
  return join(SHOWCASE_ASSETS, `${kind}.png`);
}

function blobProvider() {
  return process.env.NEXT_PUBLIC_BLOB_PROVIDER ?? process.env.BLOB_PROVIDER ?? "supabase";
}

function r2ClientConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
    }),
  };
}

function objectKey(logicalBucket, path) {
  return `${logicalBucket}/${path}`;
}

async function registerBlobObject(admin, userId, bucket, path, sizeBytes, priority = 30) {
  const { error } = await admin.from("blob_objects").upsert(
    {
      user_id: userId,
      bucket,
      path,
      tier: "hot",
      size_bytes: sizeBytes,
      priority,
    },
    { onConflict: "bucket,path" },
  );
  if (error) throw error;
}

/** Upload bytes to the active hot blob backend (R2 when tiered, else Supabase Storage). */
async function uploadHotBlob(admin, bucket, path, bytes, contentType) {
  if (blobProvider() === "tiered") {
    const r2 = r2ClientConfig();
    if (!r2) {
      throw new Error(
        "BLOB_PROVIDER=tiered but R2_* env vars are missing — set them in apps/web/.env.local",
      );
    }
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: objectKey(bucket, path),
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return "tiered";
  }

  const { error } = await admin.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return "supabase";
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

/** Generate scripts/assets/showcase/*.png when matplotlib is available. */
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

export async function uploadPaperImage(admin, userId, paperId, pngBytes, alt) {
  const file = `${randomUUID()}.png`;
  const path = `${userId}/${paperId}/${file}`;
  const backend = await uploadHotBlob(admin, PAPER_IMAGES_BUCKET, path, pngBytes, "image/png");
  if (backend === "tiered") {
    await registerBlobObject(admin, userId, PAPER_IMAGES_BUCKET, path, pngBytes.length, 30);
  }
  return { path, markdown: paperImageMarkdown(path, alt) };
}

export async function uploadExperimentArtifact(admin, userId, experimentId, name, pngBytes) {
  const safeName = name.endsWith(".png") ? name : `${name}.png`;
  const path = `${userId}/${experimentId}/${safeName}`;
  const backend = await uploadHotBlob(admin, "experiment-artifacts", path, pngBytes, "image/png");
  if (backend === "tiered") {
    await registerBlobObject(admin, userId, "experiment-artifacts", path, pngBytes.length, 20);
    const r2 = r2ClientConfig();
    if (!r2) throw new Error("tiered storage requires R2_* env vars");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    return getSignedUrl(
      r2.client,
      new GetObjectCommand({ Bucket: r2.bucket, Key: objectKey("experiment-artifacts", path) }),
      { expiresIn: R2_ARTIFACT_EXPIRES_S },
    );
  }

  const bucket = admin.storage.from("experiment-artifacts");
  const { data, error: signErr } = await bucket.createSignedUrl(path, ARTIFACT_EXPIRES_S);
  if (signErr) throw signErr;
  return data?.signedUrl ?? path;
}

/** Append figure block to a paper summary. */
export function appendFigures(summary, blocks) {
  const extra = blocks.filter(Boolean).join("\n\n");
  if (!extra) return summary;
  return summary.trimEnd() + "\n\n" + extra;
}
