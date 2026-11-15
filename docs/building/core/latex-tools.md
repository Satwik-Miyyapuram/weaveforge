# LaTeX and Overleaf workshop helpers

These modules hold the pure LaTeX, TeX log and Overleaf Workshop rules. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `latex_section_tree` | `parse_latex_section_tree` | `parseLatexSectionTree` | `apps/web/src/features/overleaf/infrastructure/overleaf-git-reader.ts` |
| `tex_log` | `parse_tex_log` | — | — |
| `overleaf_workshop` | `is_session_id`, `workshop_projects` | `isWorkshopSessionId`, `workshopProjectList` | `apps/web/src/features/overleaf/infrastructure/workshop-session-client.ts` |

Rules:

- `latex_section_tree`: best-effort outline only. There is no TeX compilation, and unresolved includes become warnings. The entry defaults to `main.tex` on the wasm side.
- `tex_log`: `parse_tex_log` reads two shapes. `-file-line-error` gives `file:line: message`. Without it, an error is a `!` line with its line number on a later `l.N` line within the next five lines.
- `tex_log`: duplicates by file, line and message are dropped. The message `.` excludes `\r`, `\n`, U+2028 and U+2029, as JavaScript does.
- `overleaf_workshop`: `is_session_id` checks the UUID shape, with case-insensitive hex and no surrounding whitespace. The caller checks that the value is a string first.
- `overleaf_workshop`: `workshop_projects` keeps the route's order. It drops entries without a non-empty string `id` or a string `name`. It returns `null` when `projects` is missing or not an array. Sorting stays in TS.
- `overleaf_workshop`: request checks run in this order: body, session, project, root. Error text has secrets and URL credentials removed and keeps the first 500 characters.
