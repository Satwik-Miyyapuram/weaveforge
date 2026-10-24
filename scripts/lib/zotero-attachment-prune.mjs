/**
 * Which attachment-shaped papers can go, and which carry work (41-20).
 *
 * A paper is kept when any row anywhere points at it. The referencing columns
 * are read from the schema's foreign keys rather than listed here, so a table
 * added later is covered without anyone remembering this file. Reads only.
 */

/**
 * Titles Zotero gives its own attachments. Anchored, so a real paper whose
 * title merely contains "snapshot" is never matched.
 */
export const ATTACHMENT_TITLE =
  "^(preprint pdf|full text pdf|submitted version|accepted version|snapshot|pdf|epub|full text)$";

/**
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 */
export async function findAttachmentPapers(query) {
  const { rows: candidates } = await query(
    `select id, title, arxiv_id, doi, (metadata ? 'annotations') as zotero_annotations
       from papers
      where title ~* $1
      order by title`,
    [ATTACHMENT_TITLE],
  );
  if (candidates.length === 0) return { removable: [], touched: [] };

  // Every column with a foreign key to papers, already quoted for SQL.
  const { rows: refs } = await query(
    `select c.conrelid::regclass::text as tbl, quote_ident(a.attname) as col
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'papers'::regclass
      order by 1, 2`,
  );

  const ids = candidates.map((r) => r.id);
  /** @type {Map<string, string[]>} */
  const reasons = new Map(ids.map((id) => [id, []]));
  for (const { tbl, col } of refs) {
    const { rows } = await query(
      `select ${col} as id, count(*)::int as n from ${tbl} where ${col} = any($1::uuid[]) group by 1`,
      [ids],
    );
    for (const r of rows) reasons.get(r.id)?.push(`${r.n} in ${tbl}.${col}`);
  }
  for (const r of candidates) if (r.zotero_annotations) reasons.get(r.id)?.push("zotero annotations");

  const removable = [];
  const touched = [];
  for (const r of candidates) {
    const why = reasons.get(r.id) ?? [];
    if (why.length > 0) touched.push({ ...r, why: why.join(", ") });
    else removable.push(r);
  }
  return { removable, touched };
}
