# Rollback scripts

Reversals for migrations, kept here and **never applied automatically**. Most undo
a change to the shape of existing data; the two function removals (`0131`, `0132`)
undo an API instead, and say in their own headers what reverting costs.

They cannot live beside the migrations they undo: `scripts/apply-migrations-oci.mjs`
applies every `.sql` file in `supabase/migrations/` in sorted order, so a
`…down.sql` dropped in there would run as part of a normal migration — undoing
the migration that had just been applied, in the same pass.

Run one deliberately, against a database you have a backup of:

```bash
node -e "const{Client}=require('pg');const fs=require('fs');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(fs.readFileSync(process.argv[1],'utf8'));await c.end()})()" supabase/migrations-rollback/0114_experiment_metrics_narrow_rows.sql
```

| Script | Undoes |
|---|---|
| `0114_experiment_metrics_narrow_rows.sql` | Fix A — restores `experiment_metrics` as a table with `id`, `metric text`, `created_at` |
| `0115_experiment_metric_chunks.sql` | Fix B — expands chunks back into rows and drops the chunk table |
| `0116_ai_mcp_relay_retention.sql` | The retention job over `ai_mcp_relay_requests` |
| `0131_metric_activity_rpc.sql` | `latest_metric_activity`, `metric_history` and the activity index — read-only, so lossless |
| `0132_compact_crdt_log_rpc.sql` | `compact_crdt_log` — lossless in data, a regression in behaviour: without it compaction is two calls with no rights check |

This table had drifted three migrations behind the folder — `0116`, `0131` and
`0132` were all absent, and a rollback nobody can find is one nobody runs.

⚠️ `0114` and `0115` restore the *shape*, not the bytes. `0114` mints fresh `id`
values and sets `created_at` to `now()`, because the originals were deleted on
purpose — that was the point of the migration. Rows deduplicated by `0114` do not
come back either; they were exact copies.
