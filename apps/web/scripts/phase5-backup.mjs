/**
 * Phase-5 pre-DROP backup. Dumps exactly what `docs/future-work/phase5-drop-e2ee.sql`
 * removes — the per-row ciphertext columns on the 9 backfilled entity tables and
 * the full contents of the 9 key-material tables — to a timestamped JSON file so
 * the irreversible DROP can be undone by re-inserting from this file.
 *
 * Uses the Supabase Management API SQL endpoint (SUPABASE_ACCESS_TOKEN, a
 * personal access token) against the project in NEXT_PUBLIC_SUPABASE_URL.
 *
 *   node apps/web/scripts/phase5-backup.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const REF = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/\/\/([a-z0-9]+)\./)?.[1];
if (!TOKEN || !REF) throw new Error("Missing SUPABASE_ACCESS_TOKEN or project ref in apps/web/.env.local");

// Entity tables: id + the ciphertext/epoch columns the DROP removes.
const ENTITY_TABLES = {
  vault_pages: ["id", "content_enc", "enc_epoch"],
  papers: ["id", "content_enc", "enc_epoch", "list_content_enc", "list_enc_epoch"],
  report_sections: ["id", "content_enc", "enc_epoch"],
  reading_lists: ["id", "content_enc", "enc_epoch"],
  reading_list_items: ["id", "content_enc", "enc_epoch"],
  experiments: ["id", "content_enc", "enc_epoch"],
  milestones: ["id", "content_enc", "enc_epoch"],
  log_entries: ["id", "content_enc", "enc_epoch"],
  comments: ["id", "content_enc", "enc_epoch"],
};

// Key-material tables the DROP removes wholesale.
const KEY_TABLES = [
  "resource_key_wraps",
  "resource_keys",
  "project_key_wraps",
  "project_keys",
  "key_epochs",
  "user_device_key_wraps",
  "user_device_transfer_requests",
  "user_email_recovery_secrets",
  "user_keys",
];

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Query failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function dumpTable(table, columns) {
  // content_enc/list_content_enc are text (the AEAD envelope), so select as-is.
  const sql = `select coalesce(json_agg(t), '[]'::json) as data from (select ${columns.join(", ")} from public.${table}) t`;
  const rows = await runQuery(sql);
  return rows[0]?.data ?? [];
}

async function dumpKeyTable(table) {
  // full-row dump; bytea columns come back base64 via to_jsonb of the row is
  // provider-dependent, so serialize the whole row as json text server-side.
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from public.${table} t`;
  const rows = await runQuery(sql);
  return rows[0]?.data ?? [];
}

const out = { takenAt: new Date().toISOString(), projectRef: REF, entity: {}, keys: {} };
const counts = {};

for (const [table, cols] of Object.entries(ENTITY_TABLES)) {
  const data = await dumpTable(table, cols);
  out.entity[table] = { columns: cols, rows: data };
  counts[table] = data.length;
  console.log(`entity ${table}: ${data.length} rows`);
}

for (const table of KEY_TABLES) {
  try {
    const data = await dumpKeyTable(table);
    out.keys[table] = data;
    counts[table] = data.length;
    console.log(`key ${table}: ${data.length} rows`);
  } catch (err) {
    // A key table may already be absent; record that rather than aborting.
    out.keys[table] = { missing: true, error: String(err).slice(0, 200) };
    counts[table] = "MISSING";
    console.log(`key ${table}: MISSING (${String(err).slice(0, 80)})`);
  }
}

out.counts = counts;
mkdirSync(new URL("../../../backups/", import.meta.url), { recursive: true });
const stamp = out.takenAt.replace(/[:.]/g, "-");
const path = new URL(`../../../backups/phase5-e2ee-backup-${stamp}.json`, import.meta.url);
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\nBackup written: backups/phase5-e2ee-backup-${stamp}.json`);
console.log("counts:", JSON.stringify(counts));
