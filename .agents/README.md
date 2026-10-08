# Notes for agents

Everything for coding agents lives in `.agents/`. Root `CLAUDE.md` and
`GEMINI.md` only import this file, because each tool loads its own root file.

| File | What |
| --- | --- |
| `README.md` | Rules every agent follows (this file) |
| `testing.md` | How to test: unit, typecheck, previews, WeaveForge Dev build, CDP |
| `plugins/marketplace.json` | Codex marketplace entry for `plugins/weaveforge-research` |

`plugins/` at the root is product code (deploy-time plugins and the research
MCP plugin), not agent config.

## Safety

- Never run destructive git or bulk delete commands (`git reset --hard`,
  `git clean -fd`, `git restore .`, `git checkout .`, `rm -rf`,
  `Remove-Item -Recurse`).
- Never delete or overwrite a file the user did not ask to change.
- In planning, change no files until the plan is approved.
- Never touch the user's installed WeaveForge app or its workspace; test in
  WeaveForge Dev (`testing.md`).

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

## Testing

Prove every change before reporting it. See [testing.md](testing.md).
