#!/usr/bin/env node
/**
 * Where the database's bytes actually are.
 *
 * `experiment_metrics` was addressed on the strength of a measurement; this is
 * the same question asked of every other table, so the next thing worked on is
 * the next thing that matters rather than the next thing that looks untidy.
 *
 * Reports, per table: total size, heap vs indexes vs TOAST, rows, bytes/row,
 * and — the part that usually decides it — indexes that have never been read.
 *
 *   node scripts/measure-database-storage.mjs            (through the SSH tunnel)
 *   node scripts/measure-database-storage.mjs --json
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(path.join(repoRoot, "secrets", ".env.migration"), "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error("DATABASE_URL not found in secrets/.env.migration");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const kb = (n) => `${(Number(n) / 1024).toFixed(0)} kB`;

async function main() {
  const json = process.argv.includes("--json");
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const { rows: tables } = await client.query(`
      select c.relname as table,
             pg_total_relation_size(c.oid)                       as total,
             pg_table_size(c.oid) - coalesce(pg_relation_size(c.reltoastrelid), 0)
               - coalesce((select pg_relation_size(t.reltoastrelid)
                             from pg_class t where t.oid = c.reltoastrelid), 0) as heap,
             pg_indexes_size(c.oid)                              as indexes,
             coalesce(pg_total_relation_size(c.reltoastrelid), 0) as toast,
             c.reltuples::bigint                                  as est_rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc`);

    // Indexes nothing has ever scanned. On a young database this is a hint,
    // not a verdict — a policy's index can be unused simply because no query
    // has exercised that path yet — so the report says which table it is on and
    // leaves the judgement to a reader.
    const { rows: unused } = await client.query(`
      select relname as table, indexrelname as index,
             pg_relation_size(indexrelid) as bytes, idx_scan
        from pg_stat_user_indexes
       where schemaname = 'public' and idx_scan = 0
         and indexrelid not in (select conindid from pg_constraint where contype in ('p','u'))
       order by pg_relation_size(indexrelid) desc`);

    // Columns wide enough to be worth knowing about.
    const { rows: wide } = await client.query(`
      select c.relname as table, a.attname as column, t.typname as type,
             s.avg_width, s.null_frac
        from pg_stats s
        join pg_class c on c.relname = s.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = s.schemaname
        join pg_attribute a on a.attrelid = c.oid and a.attname = s.attname
        join pg_type t on t.oid = a.atttypid
       where s.schemaname = 'public' and s.avg_width >= 64
       order by s.avg_width desc limit 25`);

    const totalBytes = tables.reduce((sum, t) => sum + Number(t.total), 0);

    if (json) {
      console.log(JSON.stringify({ tables, unused, wide, totalBytes }, null, 2));
      return;
    }

    console.log(`\ndatabase total: ${(totalBytes / 1048576).toFixed(1)} MB across ${tables.length} tables\n`);
    console.log(`${"table".padEnd(34)}${"total".padStart(10)}${"heap".padStart(10)}${"index".padStart(10)}${"toast".padStart(10)}${"rows".padStart(9)}${"B/row".padStart(9)}`);
    for (const t of tables) {
      const total = Number(t.total);
      if (total < 16384) continue;               // a couple of empty pages
      const rows = Number(t.est_rows);
      console.log(
        t.table.padEnd(34) +
          kb(total).padStart(10) + kb(t.heap).padStart(10) +
          kb(t.indexes).padStart(10) + kb(t.toast).padStart(10) +
          String(rows < 0 ? "?" : rows).padStart(9) +
          (rows > 0 ? (total / rows).toFixed(0) : "-").padStart(9),
      );
    }

    const indexBytes = tables.reduce((s, t) => s + Number(t.indexes), 0);
    console.log(`\nindexes are ${((indexBytes / totalBytes) * 100).toFixed(0)}% of the database`);

    if (unused.length) {
      const wasted = unused.reduce((s, u) => s + Number(u.bytes), 0);
      console.log(`\nnever-scanned indexes — ${kb(wasted)} across ${unused.length}:`);
      for (const u of unused.slice(0, 20)) {
        console.log(`  ${u.index.padEnd(46)} ${kb(u.bytes).padStart(9)}  on ${u.table}`);
      }
    }

    if (wide.length) {
      console.log(`\nwidest columns (avg bytes, from ANALYZE):`);
      for (const w of wide.slice(0, 12)) {
        console.log(
          `  ${`${w.table}.${w.column}`.padEnd(46)} ${String(w.avg_width).padStart(7)} B  ${w.type}` +
            (Number(w.null_frac) > 0.5 ? `  (${(Number(w.null_frac) * 100).toFixed(0)}% null)` : ""),
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
