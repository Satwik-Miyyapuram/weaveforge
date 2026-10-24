#!/usr/bin/env node
/**
 * Remove papers that were never papers — Zotero attachments imported as
 * bibliography entries.
 *
 * `ZoteroSync` used to read `/items`, which returns attachments and child notes
 * alongside real entries, and its only guard was "has a title". A Zotero PDF
 * attachment is titled "Preprint PDF", "Full Text PDF" or "Snapshot", so each
 * one arrived as a paper. They also duplicated their own parent: the attachment
 * URL yields a versioned arXiv id (`2308.01542v1`) where the paper carries the
 * base id (`2308.01542`), so the two never matched and both were kept.
 *
 * The import path is fixed — it reads `/items/top` now — but rows already
 * written stay until something removes them.
 *
 *   node scripts/prune-zotero-attachment-papers.mjs           # report only
 *   node scripts/prune-zotero-attachment-papers.mjs --apply   # delete them
 *
 * Dry by default. A row is only ever a candidate when it has an
 * attachment-shaped title *and* carries no work of its own: no row in any
 * table with a foreign key to papers points at it, and its metadata holds no
 * Zotero annotations. Anything a person has touched is reported and left
 * alone, whatever its title. See `lib/zotero-attachment-prune.mjs`.
 */

import pg from "pg";

import { loadDatabaseUrl } from "./lib/db-connection.mjs";
import { findAttachmentPapers } from "./lib/zotero-attachment-prune.mjs";

const apply = process.argv.includes("--apply");

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const { removable, touched } = await findAttachmentPapers((sql, params) =>
      client.query(sql, params),
    );
    const found = removable.length + touched.length;

    if (found === 0) {
      console.log("No attachment-shaped papers found — nothing to do.");
      return;
    }

    const { rows: totalRows } = await client.query(`select count(*)::int n from papers`);
    console.log(
      `${found} attachment-shaped titles out of ${totalRows[0].n} papers\n`,
    );

    for (const r of removable) {
      console.log(`  ${String(r.title).padEnd(18)} ${r.arxiv_id ?? r.doi ?? ""}`);
    }

    if (touched.length > 0) {
      console.log(`\n${touched.length} kept — these carry work despite the title:`);
      for (const r of touched) {
        console.log(`  ${String(r.title).padEnd(18)} ${r.why}`);
      }
    }

    console.log(
      `\n${apply ? "Deleting" : "Would delete"} ${removable.length}, keeping ${touched.length}.`,
    );

    if (apply && removable.length > 0) {
      await client.query(`delete from papers where id = any($1::uuid[])`, [
        removable.map((r) => r.id),
      ]);
      const { rows: after } = await client.query(`select count(*)::int n from papers`);
      console.log(`Done — ${after[0].n} papers remain.`);
    } else if (!apply) {
      console.log("Re-run with --apply to make the change.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
