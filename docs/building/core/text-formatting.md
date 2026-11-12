# Text, date and status formatting

These modules format text, dates and status labels. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `semantic_status_text` | `semantic_status_text` | `semanticStatusText` | `apps/web/src/features/settings/ui/search-settings-panel.tsx` |
| `enum_label` | `enum_label`, `enum_options`, `humanise`, `incoming_relation_label` | `enumLabel`, `enumOptions`, `humanise`, `incomingRelationLabel` | `apps/web/src/features/relations/ui/relation-phrase.ts` |
| `js_collate` | `locale_compare` | native only | — |
| `date_format` | `format_date`, `format_date_time`, `format_relative` | `formatDate`, `formatDateTime`, `formatRelative` | `apps/web/src/components/record.tsx` |
| `calendar_date` | `iso_date`, `local_iso_date` | `isoDate`, `localIsoDate` | `packages/core/src/shared/parts.ts` |
| `app_log_line` | `format_log_line` | `formatLogLine` | — |
| `error_status` | `http_status_for_kind` | `httpStatusForKind` | `packages/core/src/shared/errors.ts` |

Rules:

- `semantic_status_text`: pure, no I/O. Mirrors the TS `SemanticStatus` union. Counts are written with a comma between each group of three digits, as `toLocaleString` (en-US) does.
- `enum_label`: a value with no entry is humanised, so a new enum value still reads well. An unknown kind has no entries, so every value is humanised. `enum_options` gives the fixed display order and is empty for an unknown kind.
- `js_collate`: approximates `a.localeCompare(b)` with no locale. Exact for printable ASCII. Controls and zero-width chars are ignored, Unicode spaces read as a space, and chars with no decomposition sort by code point.
- `date_format`: inputs are ISO-8601 text. A value with no zone, and a bare `YYYY-MM-DD`, are local time. The caller passes the offset in minutes east of UTC (`-Date.getTimezoneOffset()`), because Rust has no time-zone database. Anything that does not parse formats to `""`.
- `format_relative`: activity under a week old reads as "Just now", "5m ago", "2h ago" or "3d ago"; otherwise the date. A clock a little ahead of `now_iso` also reads "Just now".
- `calendar_date`: pure. The caller reads the local fields from its own `Date`. `iso_date` takes the first ten UTF-16 units of the input. `local_iso_date` takes a 1-based month and pads month and day to two digits.
- `app_log_line`: output is `<stamp> <LEVEL> [<source>] <message>`. The stamp loses the first `T` and the first `Z`. The level is upper-cased and padded to five UTF-16 units. An empty detail is the same as no detail; a detail goes on following lines indented four spaces.
- `error_status`: only the kind-to-status map is here. The error classes stay in TS. Any kind not in the taxonomy is a server error.
