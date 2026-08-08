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
 * attachment-shaped title *and* carries no work of its own — no reader
 * annotations, no reading-list membership, no tags, no relations, no Zotero
 * annotations in its metadata. Anything a person has touched is reported and
 * left alone, whatever its title.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(path.join(repoRoot, "secrets", ".env.migration"), "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error("DATABASE_URL not found in secrets/.env.migration");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * Titles Zotero gives its own attachments. Anchored, so a real paper whose
 * title merely contains "snapshot" is never matched.
 */
const ATTACHMENT_TITLE =
  "^(preprint pdf|full text pdf|submitted version|accepted version|snapshot|pdf|epub|full text)$";

const apply = process.argv.includes("--apply");

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select p.id, p.title, p.arxiv_id, p.doi,
              (select count(*) from reader_annotations a where a.paper_id = p.id)  as annotations,
              (select count(*) from reading_list_items i where i.paper_id = p.id)  as list_items,
              (select count(*) from paper_tags t where t.paper_id = p.id)          as tags,
              (select count(*) from paper_relations r
                where r.from_paper = p.id or r.to_paper = p.id)                    as relations,
              (p.metadata ? 'annotations')                                         as zotero_annotations
         from papers p
        where p.title ~* $1
        order by p.title`,
      [ATTACHMENT_TITLE],
    );

    if (rows.length === 0) {
      console.log("No attachment-shaped papers found — nothing to do.");
      return;
    }

    const touched = rows.filter(
      (r) =>
        Number(r.annotations) > 0 ||
        Number(r.list_items) > 0 ||
        Number(r.tags) > 0 ||
        Number(r.relations) > 0 ||
        r.zotero_annotations,
    );
    const removable = rows.filter((r) => !touched.includes(r));

    const { rows: totalRows } = await client.query(`select count(*)::int n from papers`);
    console.log(
      `${rows.length} attachment-shaped titles out of ${totalRows[0].n} papers\n`,
    );

    for (const r of removable) {
      console.log(`  ${String(r.title).padEnd(18)} ${r.arxiv_id ?? r.doi ?? ""}`);
    }

    if (touched.length > 0) {
      console.log(`\n${touched.length} kept — these carry work despite the title:`);
      for (const r of touched) {
        const why = [
          Number(r.annotations) > 0 ? `${r.annotations} annotations` : null,
          Number(r.list_items) > 0 ? `${r.list_items} list items` : null,
          Number(r.tags) > 0 ? `${r.tags} tags` : null,
          Number(r.relations) > 0 ? `${r.relations} relations` : null,
          r.zotero_annotations ? "zotero annotations" : null,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(`  ${String(r.title).padEnd(18)} ${why}`);
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
