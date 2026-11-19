# Notes and report as files (0.9.5)

From 0.9.5 a note or a report section is a markdown file in your workspace.
The file is the truth; nothing about a note is kept in the database. This page
explains the file shape and the rules every save keeps.

## The file

A note lives at `<project>/notes/<slug>--<id-suffix>.note.md`, a report section
at `<project>/report/<slug>--<id-suffix>.report.md`. The front of the file holds
the fields; the rest is the body.

```markdown
---
weaveforge-id: 6f1c…
weaveforge-type: vault_page
title: Methods
parent: 2b9e…
order: 3
created-at: 2026-11-01T00:00:00Z
updated-at: 2026-11-02T00:00:00Z
---
# Methods
…
```

- `parent` is the id of the note or section it sits under; no `parent` means
  top level.
- `order` sorts siblings.
- `pinned: true` and `folder: true` appear only when set.
- Any other field (tags from Obsidian, say) is kept as it is.

A canvas note is a `.canvas` file holding JSON Canvas, read and written by the
[canvas](canvas.md) module. The note repository below refuses canvas notes.

## The code

| Part | Where | What |
| --- | --- | --- |
| Entity file | `crates/wf-core/src/sync/entity_file.rs` | Parse and render any entity file; `set_field` and `replace_body` edit one part and leave the rest. |
| Section outline | `crates/wf-core/src/report/section_file.rs` | `section_order`, `section_parent`, `set_section_order` and `parent_cycles`. |
| Note repository | `apps/web/src/features/notes/infrastructure/file-note-repo.ts` | `FileNoteRepository`: the `IVaultPageRepository` contract over workspace files. |

`FileNoteRepository` is not wired into the app yet; switching the backend is
lane L11.

## Laws

Each law is a test. The Rust ones are property tests run on random fields and
bodies (CRLF, blank lines and non-ASCII text included).

- **A saved note reads back unchanged**, an empty body included
  (`round_trip`, `empty_note_round_trips` in `crates/wf-core/tests/vault_files.rs`;
  `note_body_round_trip`, `empty_note` in
  `apps/web/src/features/notes/infrastructure/test/file-note-repo.test.ts`).
- **CRLF is turned into LF once**: saving the same note again writes nothing
  (`crlf_normalised_once`; `note_crlf_normalised_once`).
- **A body edit changes only the body**: the id and every field stay
  (`body_save_keeps_frontmatter`, `id_stable`).
- **Unknown fields are kept, in file order** (`unknown_fields_kept_in_file_order`).
- **A reorder changes only the `order` line**
  (`section_reorder_changes_order_only` in `crates/wf-core/tests/report_files.rs`
  and in the note repository test).
- **A parent cycle is found exactly when parents loop back**
  (`parent_cycle_iff_loop`). Sections in a cycle are badged and never
  rewritten; the note repository refuses a save that would make one and writes
  nothing (`parent_cycle`).
- **A save never overwrites a file changed on disk since it was read**: it
  fails with "changed on disk" instead.
- **A canvas keeps nodes it does not know**
  (`canvas_unknown_node_kept` in `crates/wf-core/tests/canvas.rs`).
