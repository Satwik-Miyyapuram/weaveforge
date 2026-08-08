# Rollback scripts

Reversals for migrations that change the shape of existing data, kept here and
**never applied automatically**.

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

⚠️ Both restore the *shape*, not the bytes. `0114` mints fresh `id` values and
sets `created_at` to `now()`, because the originals were deleted on purpose —
that was the point of the migration. Rows deduplicated by `0114` do not come
back either; they were exact copies.
