# Rows, tags and wire helpers

These modules map database rows to app types and hold small pure helpers. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `member_rows` | `to_domain` | native only | — |
| `membership_row` | `to_view` | native only | — |
| `project_row` | `to_project` | `projectFromRow` | — |
| `library_pin_rows` | `to_domain` | native only | — |
| `tag_counts` | `paper_counts_for_tags` | native only | — |
| `tag_row` | `to_tag`, `to_paper_tag` | native only | — |
| `tag_tone` | `tag_tone` | `tagTone` | `apps/web/src/components/entity-card.tsx` |
| `sync_fields` | `field_shown` | `syncFieldShown` | `apps/web/src/features/sync/ui/sync-settings.tsx` |
| `serde_util` | `null_default` | internal | — |
| `paper_note` | `append_paper_note` | `appendPaperNote` | `packages/core/src/features/ai-assistant/domain/parts.ts` |

Rules:

- `member_rows`: nullable columns are `None` when the row has no value. Unset optionals are left out of the serialized object, as `undefined` is in JS.
- `membership_row`: a missing or empty organisation relation gives the name `Lab`. A `joined_via` other than `invite` or `create` is `legacy`. `joined_via` may be absent on old rows. The embedded organisation may arrive as an object or a one-element array.
- `project_row`: a `null` colour becomes an absent colour, left out of the output.
- `library_pin_rows`: every column copies across unchanged.
- `tag_counts`: pure. The app reads `paper_tags` in chunks and passes them in. A paper linked twice counts once. A tag with no links counts `0`. Links to tags not in `tag_ids` are ignored.
- `tag_row`: a `null` colour becomes an absent colour. A `null` annotation becomes absent.
- `tag_tone`: the tag is lowercased, then each code point's first UTF-16 unit is folded into `h = h * 31 + unit` (wrapping at 2^32). Astral code points contribute only their high surrogate. Result is in `1..=6`. Must match the TypeScript hash exactly, so a tag keeps its slot.
- `sync_fields`: in Mattermost sign-in mode the `token` field is hidden. Every other field is shown in both modes. The key match is exact, so `Token` is shown (see `packages/wf-wasm/test/sync-fields.test.ts`).
- `serde_util`: `null` and a missing key both read as the default, as `?? ""` and `?? []` do in TS. Crate-private.
- `paper_note`: the addition is trimmed and so is the existing note. A blank existing note is replaced, not prefixed. The new text follows the existing one after a blank line. Returns `None` when the addition is blank, so the caller can refuse it.
