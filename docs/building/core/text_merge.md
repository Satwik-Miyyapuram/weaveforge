# Text merge (core)

`crates/wf-core/src/sync/text_merge.rs` merges two edits of one note body
against the body both started from (a three-way line merge, like `diff3`).
It is pure: the caller passes the three texts in.

## API

| Rust fn | Returns | wasm export |
| --- | --- | --- |
| `merge_text(base, mine, theirs)` | `TextMerge::Clean(text)` or `TextMerge::Conflict` | native only |

## Rules

- If one side equals the base, the other side wins whole. If both sides are
  equal, that text wins.
- Otherwise lines are compared whole. Each run of lines between two base lines
  that both sides kept is settled on its own:
  - only one side changed the run: that side's run;
  - both changed it the same way: that run, once;
  - both changed it differently: `Conflict`, and nothing is merged.
- Two different appends at the same spot (for example both sides adding a last
  line) are a conflict, because their order cannot be known.
- `\r\n` and `\r` read as `\n`, so a merged text always uses `\n`.
- Past `MAX_DIFF_CELLS` (from `text_diff`) the merge gives up with `Conflict`
  rather than spend unbounded time. A conflict never loses text: callers keep
  both copies.

## Callers

- `sync::merge::merge_rows`: a `body` field both sides changed is merged by
  line before it becomes a field conflict. Only `body` merges this way.
- `repos::vault_page_guard`: a guarded note save merges a concurrent edit.

Source: `crates/wf-core/src/sync/text_merge.rs`
