# Markdown helpers

Pure markdown and text helpers for the editor, reader and cards. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `markdown_figure_alt` | `parse_md_image_alt`, `with_md_image_alt` | `parseMdImageAlt`, `withMdImageAlt` | `apps/web/src/components/image-size-control.tsx` |
| `markdown_format` | `apply`, `format_for`, `action_infos` | `markdownFormatActions`, `markdownFormatAction` | `apps/web/src/components/markdown/markdown-format-commands.ts` |
| `markdown_image_refs` | `strip_unresolved_image_refs` | `stripUnresolvedImageRefs` | `apps/web/src/features/papers/ui/paper-markdown.tsx` |
| `markdown_image_width` | `with_image_width`, `set_image_placement` | `withImageWidth`, `setImagePlacement` | `apps/web/src/components/image-size-control.tsx` |
| `markdown_mermaid_labels` | `quote_awkward_labels` | `quoteAwkwardMermaidLabels` | — |
| `figure_label` | `figure_label` | `figureLabel` | `apps/web/src/features/experiments/ui/artifact-items.ts` |
| `heading_slug` | `heading_slug` | `headingSlug` | `apps/web/src/components/markdown/markdown.tsx` |
| `text_anchor` | `anchor_at`, `locate_anchor`, `span_points` | `anchorAt`, `locateAnchor`, `spanPoints` | `apps/web/src/features/sharing/ui/note-comments.tsx` |
| `card_snippet` | `card_snippet` | `cardSnippet` | `apps/web/src/features/papers/ui/paper-card.tsx` |

Rules:

- `markdown_figure_alt`: the parse and the write must match the TypeScript exactly, because saved notes carry this spelling. Crop insets are clamped to 0..=99.
- `markdown_format`: offsets are UTF-16 code units. `apply` returns `None` where the editor does nothing, and empty `ranges` also give `None`. The caller applies the edits and the selection in one transaction.
- `markdown_image_refs`: each path is matched literally, so `)` and regex metacharacters are safe. Only refs whose path is in `paths` but not in `resolved` are removed.
- `markdown_image_width`: `|50%` and `|400` are the Obsidian suffix. Writes go through `markdown_figure_alt`, so a width change keeps any crop or alignment. An absent patch field keeps the current value, `null` clears it, and a value sets it. `set_image_placement` applies width, crop and side in one write.
- `markdown_mermaid_labels`: only unquoted `[label]` or `{label}` holding `(`, `)` or `|` is quoted. Special shapes such as `[(cylinder)]`, `[[subroutine]]` and `[/parallelogram/]` are left alone, and everything else is kept byte for byte.
- `figure_label`: the label is the last path segment without the query, percent-decoded. Inline `data:` artifacts read `figure N`, where `index` is 0-based. A name that cannot be decoded is shown raw.
- `heading_slug`: trimmed, lowercased, each run of non-letters and non-digits becomes one hyphen, with no leading or trailing hyphen. Saved `[[Note#Heading]]` links depend on the output, so it must not change.
- `text_anchor`: a quote keeps up to `CONTEXT` (32) UTF-16 units either side. `anchor_at` returns `None` for an empty or blank span. `locate_anchor` returns `None` when the quote no longer occurs.
- `card_snippet`: markup is stripped, then the text is cut to `max` UTF-16 units plus `…`. The wasm default is 180. An empty or placeholder summary gives an empty string. A character that straddles the budget is dropped, so the preview can be one unit shorter than the TypeScript version.
