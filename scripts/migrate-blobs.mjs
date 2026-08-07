#!/usr/bin/env node
/**
 * Copy Supabase Storage objects into the tiered store (R2 hot, MinIO cold).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
 *   DATABASE_URL=postgres://…                                   \
 *   node scripts/migrate-blobs.mjs [--dry-run] [--cold] [--bucket=name]
 *
 * Only images and experiment artifacts live in storage — papers are fetched
 * from arXiv and cached in the browser, never uploaded. So this moves tens of
 * megabytes for a typical workspace, not gigabytes.
 *
 * Resumable and safe to repeat: an object already at the destination with the
 * same size is skipped, and every copy is recorded in `blob_objects` so the app
 * can find it afterwards. Nothing is deleted from Supabase — the source stays
 * intact until you delete it yourself, which is what makes the cutover
 * reversible.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMigrationEnv } from "./lib/load-env.mjs";

loadMigrationEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../apps/web/package.json"));
const pg = require("pg");
const { Client } = pg;
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name) => {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const DRY_RUN = has("--dry-run");
const TO_COLD = has("--cold");
const ONLY_BUCKET = valueOf("bucket");

/** The buckets the app writes to. Anything else in the project is not ours. */
const BUCKETS = ["vault-assets", "paper-images", "report-images", "experiment-artifacts"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("Set NEXT_PUBLIC_SUPABASE_URL.");
if (!SERVICE_KEY) {
  fail(
    "Set SUPABASE_SERVICE_ROLE_KEY.\n" +
      "  Storage listing needs it — the anon key cannot enumerate other users' objects.\n" +
      "  Supabase dashboard → Project Settings → API → service_role. Never ship it to a browser.",
  );
}
if (!DATABASE_URL) fail("Set DATABASE_URL — the destination registry lives in `blob_objects`.");

/** Destination: R2 for the hot tier, MinIO for cold. Both speak S3. */
function destination() {
  if (TO_COLD) {
    const endpoint = process.env.BLOB_COLD_ENDPOINT;
    const bucket = process.env.BLOB_COLD_BUCKET;
    if (!endpoint || !bucket) {
      fail("--cold needs BLOB_COLD_ENDPOINT, BLOB_COLD_BUCKET, BLOB_COLD_ACCESS_KEY_ID, BLOB_COLD_SECRET_ACCESS_KEY.");
    }
    return {
      tier: "cold",
      bucket,
      client: new S3Client({
        region: "us-east-1",
        endpoint,
        forcePathStyle: true, // MinIO does not do virtual-host addressing by default
        credentials: {
          accessKeyId: process.env.BLOB_COLD_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.BLOB_COLD_SECRET_ACCESS_KEY ?? "",
        },
      }),
    };
  }

  const account = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET;
  if (!account || !bucket) {
    fail("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (or pass --cold).");
  }
  return {
    tier: "hot",
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    }),
  };
}

/**
 * Every object in a Supabase bucket.
 *
 * Storage's list endpoint is per-prefix and paginated, so this walks the tree:
 * a returned entry with no `id` is a folder, and folders nest one level per
 * path segment (`{userId}/{entityId}/{file}`).
 */
async function listBucket(bucket, prefix = "") {
  const out = [];
  let offset = 0;

  for (;;) {
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
      },
    );
    if (!response.ok) {
      if (response.status === 404) return out; // bucket not created in this project
      throw new Error(`list ${bucket}/${prefix}: ${response.status} ${await response.text()}`);
    }

    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;

    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Storage marks folders by returning them with a null id.
      if (entry.id === null || entry.id === undefined) out.push(...(await listBucket(bucket, path)));
      else out.push({ path, size: entry.metadata?.size ?? 0, contentType: entry.metadata?.mimetype });
    }

    if (page.length < 100) break;
    offset += page.length;
  }

  return out;
}

async function download(bucket, path) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } },
  );
  if (!response.ok) throw new Error(`download ${bucket}/${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Already there, and the same size? Then it was copied on an earlier run. */
async function alreadyPresent(dest, key, size) {
  try {
    const head = await dest.client.send(
      new HeadObjectCommand({ Bucket: dest.bucket, Key: key }),
    );
    return size === 0 || head.ContentLength === size;
  } catch {
    return false;
  }
}

async function main() {
  const dest = destination();
  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 0,
  });
  await db.connect();

  const buckets = ONLY_BUCKET ? [ONLY_BUCKET] : BUCKETS;
  console.log(`→ ${dest.tier} tier → ${dest.bucket}`);

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const bucket of buckets) {
    const objects = await listBucket(bucket);
    if (objects.length === 0) {
      console.log(`  ${bucket}: empty`);
      continue;
    }
    const total = objects.reduce((sum, object) => sum + object.size, 0);
    console.log(`  ${bucket}: ${objects.length} objects, ${(total / 1024 / 1024).toFixed(1)} MB`);
    if (DRY_RUN) continue;

    for (const object of objects) {
      // Namespaced by bucket so two buckets holding the same path cannot
      // collide in one destination bucket.
      const key = `${bucket}/${object.path}`;
      try {
        if (await alreadyPresent(dest, key, object.size)) {
          skipped += 1;
          continue;
        }

        const body = await download(bucket, object.path);
        await dest.client.send(
          new PutObjectCommand({
            Bucket: dest.bucket,
            Key: key,
            Body: body,
            ContentType: object.contentType || "application/octet-stream",
          }),
        );

        // The registry is how the app finds the object afterwards; a copy that
        // is not recorded is a copy the app cannot serve.
        await db.query(
          `insert into blob_objects (user_id, bucket, path, tier, size_bytes)
           values (
             coalesce(nullif(split_part($1, '/', 1), '')::uuid, (select id from auth.users limit 1)),
             $2, $3, $4, $5
           )
           on conflict (bucket, path) do update set tier = excluded.tier, size_bytes = excluded.size_bytes`,
          [object.path, bucket, object.path, dest.tier, body.byteLength],
        );

        copied += 1;
        bytes += body.byteLength;
        if (copied % 25 === 0) console.log(`    ${copied} copied …`);
      } catch (error) {
        failed += 1;
        console.error(`    ✗ ${key}: ${error.message}`);
      }
    }
  }

  await db.end();

  if (DRY_RUN) {
    console.log("\nNothing was copied (--dry-run).\n");
    return;
  }

  console.log(
    `\n→ ${copied} copied (${(bytes / 1024 / 1024).toFixed(1)} MB), ${skipped} already present, ${failed} failed\n`,
  );
  if (failed > 0) {
    console.error("Re-run to retry the failures; objects already copied are skipped.\n");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
});
