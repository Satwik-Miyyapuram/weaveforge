# Notes for agents

## The database is on the OCI server, not Supabase

All tables, RPCs and files live in the self-hosted Postgres on the project's OCI
server (`infra/oci/docker-compose.yml`, container `weaveforge-postgres`, behind
PostgREST at `api.weaveforge.org`). Supabase is used for **sign-in only**; see
`supabase/migrations/README.md`.

- **Never** use a Supabase MCP / connector (`apply_migration`, `execute_sql`,
  `list_migrations`, `list_tables`, …) to read the schema, check which
  migrations are applied, or apply one. The Supabase project's schema is stale
  (its migration history stops at `0111`) and says nothing about production.
- The `supabase/` folder name is historical: the SQL there runs on the OCI Postgres.
- Applying a migration to production is a production write: ask the user first,
  every time. Then pipe the file over ssh into
  `docker exec -i weaveforge-postgres sh -c "psql -1 -v ON_ERROR_STOP=1 -U \${POSTGRES_USER} -d \${POSTGRES_DB}"`,
  followed by `notify pgrst, 'reload schema';`. Pass SQL on stdin; inline quoting
  through ssh and sh breaks.
