# Reports

Reports turn your notes and library into a thesis or paper draft. They hold the outline with a status for each section, check the bibliography before you export, and convert Markdown to LaTeX for Overleaf.

## How to

### Check a bibliography before export

1. List the `.bib` files the report uses.
2. Cite papers in the text with `\cite{key}` or `[[Paper title]]`.
3. Read the findings. Each one names the key, the file or the field, and what is wrong. Findings are advice, not errors: the export still runs.

### Track the status of a section

1. Give each section a title and, if you want, a section number and a parent.
2. Set its status to one of the four values in the Reference table.
3. Set a target word count to see how far the section is from it.

## Reference

### Section statuses

| Status | Meaning |
| --- | --- |
| `not_started` | Not begun. The default. |
| `drafting` | Being written. |
| `review` | Waiting for review. |
| `done` | Finished. |

### Bibliography findings

Each finding has a kind and a severity. Errors break the document or the bibliography; warnings are untidy but still render.

| Kind | Severity | What it means |
| --- | --- | --- |
| `cited-not-defined` | error | A key is cited but defined in no `.bib` file. |
| `missing-bib-file` | error | A bibliography file is named but is not in the project. |
| `duplicate-key` | warning | A key is defined more than once. The first definition wins. |
| `defined-not-cited` | warning | An entry is defined but never cited. |
| `missing-field` | warning | An entry lacks a field its type needs to render. |
| `malformed-doi` | warning | A DOI field that is not a DOI. |
| `malformed-url` | warning | A URL field that will not resolve. |
| `author-format` | warning | Authors are written the other way round from the rest of the file. |
| `parse-warning` | warning | A problem found while reading a `.bib` file. |

Message patterns:

- `No '<file>' in this project, so none of its entries will print.`
- `'<key>' has a DOI that is not one: <doi>`
- `'<key>' has a URL that will not resolve: <url>`
- `@<type> '<key>' has no '<fields>'.`

### Markdown to LaTeX

| Markdown | LaTeX |
| --- | --- |
| `# Heading`, `## Heading`, `### Heading` | Section commands, up to the third level |
| `- item`, `* item` | `\item` in a list |
| `$...$` and `$$...$$` | Raw TeX maths, never KaTeX HTML |
| `![Alt](reportimg:...)` | `\includegraphics` under `figures/` |
| `[[Paper title]]` | `\cite{key}` when the paper has a cite key; otherwise left as text with a warning |

Other constructs the converter does not support become warnings and are left as comments or omitted. A code fence that is not closed omits its content from the export, with the warning `Unclosed code fence — content omitted from export.`

### Citation formats

| Format | Output for key `smith2020` |
| --- | --- |
| `latex` | `\cite{smith2020}` |
| `pandoc` | `[@smith2020]` |
| `footnote` | `[^smith2020]` |

### Cite keys

A paper's cite key is chosen in this order:

1. The key you set by hand.
2. The BibTeX key.
3. The `Citation Key:` line that Better BibTeX writes in the Zotero `extra` field.
4. A key built from the DOI (`doi_...`), the arXiv id (`arxiv_...`), or the paper id (`paper_...`).

When two papers would get the same key, the later one gets a suffix: `smith2020_2`, then `smith2020_3`, and so on.

### Project paths

Paths inside a report project are written one way: `/` separators, no `.` parts, and `..` folded in. A path that climbs out of the project is rejected.

### Section input

| Field | Rule |
| --- | --- |
| Title | Required. Trimmed. |
| Word count | Cannot be negative. |
| Target words | Cannot be negative. |

Error messages: `Section title is required.`, `Word count cannot be negative.`, `Target words cannot be negative.`

## How it works

The checks and conversions run in the Rust core, so they work offline and send nothing over the network. The `.bib` reader is hand-written: it does not re-render BibTeX or expand macros. It reads entries well enough to tell whether a key is defined, cited, or complete. Anything it cannot read becomes a parse warning rather than a failed export.

The bibliography check answers the two questions a LaTeX compiler does not: which cited keys are undefined, and which defined keys are never cited.

Source: `crates/wf-core/src/report/`

## Related

- [Citations, excerpts and Overleaf](citations-and-overleaf.md) for how papers are cited and sent to Overleaf.
- [Papers](papers.md) for the library the cite keys come from.
