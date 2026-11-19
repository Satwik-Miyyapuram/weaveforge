# Notes for agents

Everything for coding agents lives in `.agents/`. Root `CLAUDE.md` and
`GEMINI.md` only import this file, because each tool loads its own root file.

| File | What |
| --- | --- |
| `README.md` | Rules every agent follows (this file) |
| `testing.md` | How to test: unit, typecheck, gates, previews, WeaveForge Dev build, CDP |
| `max/` | Orchestrating agents. Read only on a Claude Max plan (see below) |
| `.agents/plugins/marketplace.json` | Codex marketplace entry for `plugins/weaveforge-research` |

**Plan.** By default the session is on a Pro plan: work inline and spawn no
subagents. Only when the user says the session runs on Claude Max, or asks
you to orchestrate agents, read `max/README.md` and follow that folder.

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
- Never merge into or push `main` without the user's explicit OK.

## Windows shell

- Bash heredocs break in this shell. Write files with the Write tool and
  commit with `git commit -F <file>`.
- Python edit scripts open files with `newline=""`, or LF files turn CRLF.

## The database is on the OCI server, not Supabase

All tables, RPCs and files live in the self-hosted Postgres on the project's OCI
server (`infra/oci/docker-compose.yml`, container `weaveforge-postgres`, behind
PostgREST at `api.weaveforge.org`). Supabase is used for **sign-in only**; see
`db/migrations/README.md`.

- **Never** use a Supabase MCP / connector (`apply_migration`, `execute_sql`,
  `list_migrations`, `list_tables`, …) to read the schema, check which
  migrations are applied, or apply one. The Supabase project's schema is stale
  (its migration history stops at `0111`) and says nothing about production.
- Migrations live in `db/` and run on the OCI Postgres; `supabase/` holds only the auth project's CLI config.
- Applying a migration to production is a production write: ask the user first,
  every time. Where you have no ssh access, hand the user the exact command
  instead. Pipe the file over ssh into
  `docker exec -i weaveforge-postgres sh -c "psql -1 -v ON_ERROR_STOP=1 -U \${POSTGRES_USER} -d \${POSTGRES_DB}"`,
  followed by `notify pgrst, 'reload schema';`. Pass SQL on stdin; inline quoting
  through ssh and sh breaks.

## Systematic Commits

Every time you finish a task, systematically commit your verified changes to a
branch before addressing the next user request (on Max, the lead that made
the change commits it, not the orchestrator). Only commit changes made by you
for your specific task; never commit unrelated working tree modifications or
untracked files. Never accumulate uncommitted task changes across turns.

## User docs change in the same PR

A change a user can see updates the `docs/using` page that covers it in the
same PR: fix the steps, then set its `checked:` front matter to today. Each
page's `covers:` lists the code it describes. `npm run check:docs` fails on a
bolded button name the app lacks; `npm run check:docs-freshness` warns on a
page whose code moved after `checked:`.

## Testing

Prove every change before reporting it. Read [testing.md](testing.md) before
running tests, a build or the Dev app; it is not loaded up front.

## Spend few tokens

- Find code with the LSP tool (`workspaceSymbol`, `findReferences`,
  `documentSymbol`) or Grep, then Read only the lines around the hit.
  Never Read a whole file over ~300 lines.
- On Max, hand broad "where is X" sweeps to the `scout` agent; it returns
  `path:line`. On Pro, Grep yourself.
- `docs/plans/`, `docs/internal/`, `docs/demo/` and `package-lock.json` are
  hidden from search (`.ignore`); open one by path only when asked.
- One task per session; the user clears between tasks. On Max, one plan per
  session, run as parallel lanes.
