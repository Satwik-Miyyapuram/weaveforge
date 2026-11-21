# 1.0.0 whole-codebase review (read-only)

Target: `origin/fix/097-review` @ 989db2662. Risk order: data loss, security,
crashes/hangs, broken flows, rest. Rust crates, wf-relay and the shell file
commands were reviewed in r1–r4 and are only re-checked where they touch
the risk areas.

Coverage note: this pass was token-limited. It covers TS file writes, renames,
the trash, the ink migration copy and the markdown HTML sinks. It does **not**
cover crashes/hangs, the broken-flow sweep (workspace open, papers,
sharing, settings) or opfs-clone git sync beyond r1–r4. Treat 1.0.0 as **not
cleared** until a second pass covers those.

## P0

None found.

## P1

None found.

## P2

1. **Checked saves of a non-UTF-8 file fail forever.** This is the regression
   from r4, carried here because it blocks 1.0.0.
   - `crates/wf-store/src/checked_write.rs:657`: `hash_of` hashes raw bytes.
   - `vault.rs:401` (`decode_text`, lossy), `apps/shell/src/vault.rs:226`,
     `apps/shell/src/device_settings.rs:26` and `apps/shell/src/settings_secrets.rs:56` pass a digest of the
     lossy text.
   - Failing scenario: the user opens a Latin-1 note from Obsidian and edits it.
     Every save returns Changed, and `file-note-repo.ts:157` throws "changed on
     disk; reload before saving". Edits are lost when the user closes the
     note. Disk bytes stay safe.
   - Fix: hash the lossy-decoded text on both sides, or compare raw bytes on
     both sides.

2. **`DesktopWorkspaceFs.rename` copies, then deletes.** See
   `apps/web/src/features/workspace/infrastructure/parts.ts:288-292`.
   - It runs `writeFile(to, readFile(from))` and then `remove(from)`.
   - Failing scenarios:
     - **(a)** The app is killed between the write and the remove during the
       rename-follow in `workspace/application/parts-2.ts:126`. Both `old` and
       `to` then exist with the same `weaveforge-id`, a twin note. The comment
       at L128 says "no twin", but that only holds for a thrown error, not a
       crash.
     - **(b)** Moving a project to the trash (`workspace/application/parts.ts:181-185`)
       moves file by file. A failure or kill midway splits the project between
       its folder and the trash. On the next open the project shows half its
       notes, and the rest sit in `.weaveforge/trash`.
     - **(c)** Each file is loaded whole into memory, so a project trash with
       large PDFs or attachments can exhaust the webview.
   - Fix: add a native `rename` in the shell (`std::fs::rename`, with a
     no-replace check). Keep copy+delete only as a fallback.

3. **The web `BrowserWorkspaceFs.writeTextIf` is read-compare-write** (`workspace/infrastructure/parts.ts:125-131`).
   - It is not atomic, which the code documents, and nothing guards against
     two tabs.
   - Failing scenario: the same note is open in two browser tabs on the web
     app. Both saves pass the compare, and the later save silently overwrites
     the earlier one.
   - Fix: take a per-path Web Lock (`navigator.locks.request(path, …)`) around
     the read, compare and write.

## P3

- `ai-assistant/application/parts.ts:185-195`:
  - The claim renames `draft` to `draft.claimed`. Because rename is an
    unchecked overwrite (P2-2), a `.claimed` file left by an earlier crash is
    overwritten.
  - The rollback at L195 overwrites a new draft that was written under the
    same name in the meantime.
  - Failing scenario: a crash after the claim, then a new draft with the same
    name. One folder draft is lost.
- `ink/infrastructure/parts.ts:365`: the ink migration deletes **every**
  `*.part` file in the target folder, not only its own. A user file named
  `x.part` beside the note is deleted.
- `file-note-repo.ts:156` and `plan/infrastructure/file-milestone-repo.ts:164`
  fall back to an unchecked `writeFile` when `writeTextIf` is missing. Every
  shipped fs implements it, so the fallback is dead code. Remove it so no
  future fs gets silent overwrites.

## Checked, no issue

- Trash moves:
  - `lib/workspace-trash.ts:25-26` reserves the target with
    `writeTextIf(target, "", null)` before the rename.
  - `file-milestone-repo.ts:155` uses stat plus a free name.
  - `workspace/application/parts.ts:178` uses `freeTrashFolder`.
- Ink migration copy (`ink/infrastructure/parts.ts:360-387,580-596`): it skips
  names already present, writes through `.part`, and verifies the hash before
  and after the rename.
- The rename-follow skips a target that already exists
  (`workspace/application/parts-2.ts:123`).
- Markdown HTML (`components/markdown/markdown.tsx:72-153`):
  - Text is escaped first.
  - Links accept only `https?:` and root-relative targets, and images only
    `blob:`, `vault:`, `paperimg:`, `reportimg:` and `https?:`, so there is
    no `javascript:` path.
  - Mermaid SVG and the boot snapshot both go through DOMPurify
    (`lib/mermaid-render.ts:45`, `app/boot-snapshot.tsx:177`).

## Second pass: local API, auth, crashes/hangs, flows

No new P0, P1 or P2.

### P3

- `apps/web/src/features/ink/application/parts-1.ts:205-226`: the ink chunk
  decompressor has no size cap; it collects every output chunk before
  returning.
  - Failing scenario: a crafted or corrupt `.inkb` arrives through git sync or
    a shared folder and decompresses to gigabytes. The webview runs out of
    memory when the note opens.
  - Fix: stop reading past a cap (for example 64 MB per chunk) and treat the
    chunk as corrupt.

### Checked, no issue

- **Local API** (`apps/shell/src/local_http/server.rs`):
  - It binds to 127.0.0.1 only (L58-61).
  - It checks Host against loopback names, which blocks DNS rebinding (L42).
  - It refuses a foreign `Origin`.
  - Limits: 16 KB head and 8 MB body, each read with a timeout; at most 32
    connections, extra ones dropped; a 30 s drain on refusals.
  - Shutdown (`control.rs` `stop`) signals the accept loop and awaits only that
    loop, so in-flight connections cannot block exit (`lib.rs:549`).
- **Auth:**
  - Supabase uses PKCE (`backend/providers/postgrest/parts-1.ts:186`), so a
    forged `weaveforge://` callback code (`lib.rs:736-752`) cannot log the
    user into another account: the exchange in `supabase-auth.ts:170` needs
    the local verifier.
  - The web app is a static export with no server route handlers to attack.
- **Hangs:**
  - Every TS `for (;;)` loop ends: the stream readers stop at `done`, and
    `awaitInkWrites` drains a set that only shrinks.
  - The outbox pump moves `afterSeq` forward each page and stops on a short
    page (`offline-sync/domain/parts-3.ts:55-60`).
  - Zotero `mapWithConcurrency` is bounded.
- **Crashes:** the `unwrap`/`expect` hits in `apps/shell/src` are all inside
  `#[cfg(test)]` modules, apart from `app_update.rs:444`, which joins
  test-only threads.

### Not covered statically

User flows (workspace open, notes, papers, ink, sharing, settings) need a
run in the Dev app; static reading cannot clear them. Use the result of the
Dev E2E check for those.
