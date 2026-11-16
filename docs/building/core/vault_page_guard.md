# Vault page guard (core)

`crates/wf-core/src/repos/vault_page_guard.rs` is a guarded save for a page
body. It stops two writers from overwriting each other. It is part of the
[repos](repos.md) plan and is used for notes and [canvas](canvas.md) pages.

## API

The caller passes `GuardedBody { body, baseBody, sessionDigests }` (unknown
fields are refused). `update(call)` returns `None` for any other input, for
example one that also sets the title, and the plain update handles it. The
result is the saved page plus `conflictCopyId` when a copy was made
(`EditedVaultPage` in `packages/core/src/features/vault/domain/vault-page-repository.ts`).

## Rules

- The page is read with its `row_version`, scoped to the project. The write is
  `update ... where id and row_version` (only `where id` when the row has no
  `row_version`) and returns the id. An empty reply means another writer won
  the race.
- `plan(base, mine, theirs, session, canvas)` decides:
  - `theirs == mine`: keep, write nothing.
  - `theirs == base`, or the digest of `theirs` is in `sessionDigests`: write
    `mine`. The session digests are texts this editor session saved itself.
  - otherwise `merge_text(base, mine, theirs)` ([text_merge](text_merge.md)):
    - clean and equal to `theirs`: keep;
    - clean, but a canvas whose merged text does not parse: conflict copy, then
      write `mine`;
    - clean: write the merged text;
    - conflict: conflict copy, then write `mine`.
- After a lost race it reads again, up to `ATTEMPTS = 3` times.
- A missed write whose re-read shows the same version is a row policy refusal:
  `VaultPagePermissionError`, "You may not edit the vault page \"{id}\".".
- Out of attempts: `VaultPageConflictError`, "This note kept changing while it
  was being saved; your text is still in the editor.". A missing page is
  `NotFoundError`.
- The conflict copy is titled `"{title} (conflict copy YYYY-MM-DD HH:MM:SS)"`.
  When that title is taken, or a second copy is made in the same save, a tag
  from the copy's id is added (its first 8 characters, then the whole id).
  It copies the body, `parent_id`, `kind` and `sort_order`, so a canvas copy is
  a canvas. Its id is `call.id(n)`, fixed per `n`, so a replay names the same
  copy. A retry copies only text not yet kept; newer clashing text makes
  another copy.

## TS side

`vault/ui/vault-screen/page-editor.tsx` and `workspace-screen.tsx` pass
`baseBody` and `sessionDigests`. The digests come from the collaborative editor
(`collab/ui/collaborative-markdown-editor.tsx`; the `SaveBody` type is in
`collab/application/parts.ts`). Tests:
`crates/wf-core/tests/vault_page_guard.rs` and
`apps/web/src/backend/test/contracts/vault-pages.contract.test.ts`.
