/**
 * Copying a Postgres database into another one, table by table.
 *
 * The order tables are loaded in is derived from the target's own foreign keys
 * rather than written down here. A hardcoded list is correct exactly until
 * someone adds a table, and then it is wrong in a way that surfaces as a
 * constraint violation halfway through a migration.
 *
 * Every write is `on conflict do nothing` against the primary key, which makes
 * the whole run resumable: interrupted at any point, running it again finishes
 * the job instead of failing on what already landed.
 */

/** Rows per insert. Large enough to amortize round trips, small enough to not blow the parameter limit. */
export const BATCH_ROWS = 500;

/** Postgres refuses a statement with more than this many bound parameters. */
const MAX_PARAMS = 60_000;

/**
 * Load order: parents before children.
 *
 * Depth is the longest chain of foreign keys from a table with no parents.
 * Self-references are excluded — a tree of notes points at itself and would
 * otherwise never reach a finite depth — and are handled by deferring
 * constraints during the load instead.
 */
export async function tableLoadOrder(client, schema = "public") {
  const { rows } = await client.query(
    `
    with recursive tables as (
      select c.oid as tbl, c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'r'
    ),
    edges as (
      select con.conrelid as child, con.confrelid as parent
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_class p on p.oid = con.confrelid
      join pg_namespace pn on pn.oid = p.relnamespace
      where con.contype = 'f' and n.nspname = $1 and pn.nspname = $1
        and con.conrelid <> con.confrelid
    ),
    lvl as (
      select t.tbl, t.name, 0 as depth
      from tables t
      where not exists (select 1 from edges e where e.child = t.tbl)
      union all
      select t.tbl, t.name, l.depth + 1
      from tables t
      join edges e on e.child = t.tbl
      join lvl l on l.tbl = e.parent
      where l.depth < 32
    )
    select name, max(depth) as depth
    from lvl group by name order by max(depth), name
    `,
    [schema],
  );
  return rows.map((row) => row.name);
}

/**
 * Columns worth copying.
 *
 * Generated columns are excluded because Postgres refuses to be told their
 * value — `vault_pages.body_preview` is derived from the body, and an insert
 * that names it fails outright. Identity columns declared ALWAYS are the same:
 * the sequence owns them, and they are re-derived on the target.
 */
export async function columnsOf(client, table, schema = "public") {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2
       and is_generated <> 'ALWAYS'
       and coalesce(identity_generation, '') <> 'ALWAYS'
     order by ordinal_position`,
    [schema, table],
  );
  return rows.map((row) => row.column_name);
}

/** Primary key columns, for the conflict target that makes a re-run a no-op. */
export async function primaryKeyOf(client, table, schema = "public") {
  const { rows } = await client.query(
    `select a.attname
     from pg_index i
     join pg_class c on c.oid = i.indrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
     where i.indisprimary and n.nspname = $1 and c.relname = $2`,
    [schema, table],
  );
  return rows.map((row) => row.attname);
}

/**
 * Copy one table.
 *
 * Only the columns both sides have are copied. A source column the target lacks
 * is dropped rather than being an error: the two schemas are the same migration
 * history, but a source that is a version ahead should still be migratable, and
 * losing a column the target cannot store is better than refusing to run.
 *
 * A conflicting row is updated, not skipped. This matters more than it looks:
 * applying the schema fires `on_auth_user_created`, which writes a `profiles`
 * row with default values the moment a user is inserted. Skipping conflicts
 * would leave every migrated user with the default role and `org_setup_complete`
 * false — the migration would report success and quietly reset who everyone is.
 * The source is the authority here, so the source wins.
 */
export async function copyTable(source, target, table, options = {}) {
  const schema = options.schema ?? "public";
  const sourceColumns = await columnsOf(source, table, schema);
  const targetColumns = await columnsOf(target, table, schema);
  if (sourceColumns.length === 0 || targetColumns.length === 0) {
    return { table, copied: 0, skipped: "missing on one side" };
  }

  const shared = sourceColumns.filter((column) => targetColumns.includes(column));
  const dropped = sourceColumns.filter((column) => !targetColumns.includes(column));
  if (shared.length === 0) return { table, copied: 0, skipped: "no shared columns" };

  const pk = await primaryKeyOf(target, table, schema);
  const quoted = shared.map((column) => `"${column}"`).join(", ");
  const rowsPerBatch = Math.max(1, Math.min(BATCH_ROWS, Math.floor(MAX_PARAMS / shared.length)));

  const { rows } = await source.query(`select ${quoted} from "${schema}"."${table}"`);
  if (rows.length === 0) return { table, copied: 0, dropped };

  let copied = 0;
  for (let start = 0; start < rows.length; start += rowsPerBatch) {
    const batch = rows.slice(start, start + rowsPerBatch);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = shared.map((column, columnIndex) => {
        values.push(row[column]);
        return `$${rowIndex * shared.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    // Mirror the source onto the target. Idempotent either way, but `do update`
    // is what makes a row a trigger already created carry the real values.
    const updatable = shared.filter((column) => !pk.includes(column));
    const conflict = !pk.length
      ? "on conflict do nothing"
      : updatable.length === 0
        ? `on conflict (${pk.map((column) => `"${column}"`).join(", ")}) do nothing`
        : `on conflict (${pk.map((column) => `"${column}"`).join(", ")}) do update set ` +
          updatable.map((column) => `"${column}" = excluded."${column}"`).join(", ");

    const result = await target.query(
      `insert into "${schema}"."${table}" (${quoted}) values ${tuples.join(", ")} ${conflict}`,
      values,
    );
    copied += result.rowCount ?? 0;
  }

  return { table, copied, read: rows.length, dropped };
}

/**
 * Bring sequences in line with the data just loaded.
 *
 * Without this, a table whose id comes from a sequence hands out values that
 * already exist — the first insert after a migration fails on the primary key,
 * which is a confusing way to discover the migration was incomplete.
 */
export async function resyncSequences(client, schema = "public") {
  const { rows } = await client.query(
    `select
       quote_ident(n.nspname) || '.' || quote_ident(c.relname) as seq,
       quote_ident(tn.nspname) || '.' || quote_ident(t.relname) as tbl,
       quote_ident(a.attname) as col
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_depend d on d.objid = c.oid and d.classid = 'pg_class'::regclass
     join pg_class t on t.oid = d.refobjid
     join pg_namespace tn on tn.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where c.relkind = 'S' and n.nspname = $1`,
    [schema],
  );

  for (const row of rows) {
    await client.query(
      `select setval('${row.seq}', coalesce((select max(${row.col}) from ${row.tbl}), 0) + 1, false)`,
    );
  }
  return rows.length;
}

/** Row counts per table, for comparing the two sides afterwards. */
export async function rowCounts(client, tables, schema = "public") {
  const counts = {};
  for (const table of tables) {
    const { rows } = await client.query(`select count(*)::int as n from "${schema}"."${table}"`);
    counts[table] = rows[0].n;
  }
  return counts;
}
