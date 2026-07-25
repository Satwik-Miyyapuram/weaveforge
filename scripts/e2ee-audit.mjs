#!/usr/bin/env node
/**
 * Operator-cannot-read audit — sample check that sensitive columns hold
 * TTE1 envelopes only (not plaintext).
 *
 * Usage (requires service role):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/e2ee-audit.mjs
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const TTE1 = "TTE1";

async function rest(path, query = "") {
  const res = await fetch(`${url}/rest/v1/${path}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function looksEncrypted(val) {
  return typeof val === "string" && (val.startsWith(TTE1) || val === "");
}

async function auditTable(table, cols) {
  const rows = await rest(table, `select=${cols.join(",")}&limit=20`);
  let ok = true;
  for (const row of rows) {
    for (const col of cols) {
      const v = row[col];
      if (v == null) continue;
      if (!looksEncrypted(v)) {
        console.error(`FAIL ${table}.${col}: plaintext leak`, String(v).slice(0, 80));
        ok = false;
      }
    }
  }
  console.log(ok ? `OK ${table}` : `ISSUES ${table}`);
  return ok;
}

async function main() {
  let allOk = true;
  allOk &&= await auditTable("vault_pages", ["title", "body", "content_enc"]);
  allOk &&= await auditTable("papers", ["title", "abstract", "content_enc"]);
  allOk &&= await auditTable("log_entries", ["body", "content_enc"]);
  allOk &&= await auditTable("comments", ["body", "content_enc"]);

  const crdt = await rest("crdt_updates", "select=payload&limit=5");
  for (const row of crdt) {
    const hex = row.payload?.replace(/^\\x/, "") ?? "";
    if (hex && !hex.startsWith("54544531")) {
      console.error("FAIL crdt_updates.payload: missing TTE1 envelope prefix");
      allOk = false;
    }
  }
  console.log(allOk ? "Audit passed (sample)" : "Audit found issues");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
