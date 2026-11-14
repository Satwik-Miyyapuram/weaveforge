# Papers

A paper is a reference you keep in your project: its title, authors, DOI or arXiv
id, and your notes on it. You add one by pasting a reference, and WeaveForge works
out what the reference points to, so you do not have to type the metadata.

## How to

### Add a paper by pasting its reference

1. In the Papers list, click **Add paper**. The dialog is titled "Add paper".
2. In the **…or import from** dropdown, choose **DOI**, **arXiv id**, **URL** or
   **Zotero key**. The field next to it takes the value, and its label and
   placeholder follow the kind you chose.
3. Paste the reference. Any text that contains a DOI works, for example `10.1145/3592979` or a link to a DOI on any site.
   An arXiv id (`2305.12345`, `arXiv:2305.12345`) or an arXiv link
   (`arxiv.org/abs/…`, `arxiv.org/pdf/…`, `arxiv.org/html/…`) works the same way.
4. Leave **Title** empty. It is required only when the reference field is empty.
   **Status** sets where you are with the paper; it starts as **To read**.
5. Click **Add paper**. The button reads "Adding…" while the paper is added.
6. If the reference names both an arXiv paper and a DOI, the arXiv id wins.
7. An arXiv link with a version (`v2`) and the same paper without one resolve to
   the same id, so they refer to one paper.

### Add a paper from a web page

1. In **…or import from**, choose **URL**.
2. Paste the page address into the field labelled **URL**. WeaveForge reads the
   citation tags, Dublin Core, JSON-LD or OpenGraph data on the page.
3. Click **Add paper**.
4. If the page carries no title, or does not look like an article, the import is
   refused with the message in the Reference table below.

### Add a paper from a PDF or a BibTeX file

1. In the **Add paper** dialog, click **…or add from a PDF**, then **Choose PDFs…** and
   pick one or more PDFs. The DOI or title on the first page finds the paper.
2. Or, under **…or import a BibTeX file**, click **Choose .bib file…** and pick a `.bib` or `.bibtex` file.
   Entries with the same DOI or citation key as a paper already in the project are
   skipped.

### Check whether a paper is already in your project

Two papers match when their title keys are equal. Titles too short to trust
never match, so two papers titled "Notes" are not merged.

## Reference

### Reference kinds

| Kind | You paste | Stored as |
|---|---|---|
| `doi` | any text containing a DOI (`10.NNNN/…`), such as a `doi:` prefix or a link to one | the lowercase DOI |
| `arxiv` | a bare id, `arXiv:` prefix, or an arxiv.org abs / pdf / html link | the id without its version |
| `url` | any other web address | the URL |
| `zotero` | a Zotero item key | the key, unchanged |

### arXiv forms accepted

| Input | Becomes |
|---|---|
| `2305.12345` | `2305.12345` |
| `2305.12345v3` | `2305.12345` |
| `arXiv: 2305.12345` | `2305.12345` |
| `https://arxiv.org/pdf/2305.12345v2.pdf` | `2305.12345` |
| `https://arxiv.org/abs/cs.LG/0501001` | `cs.LG/0501001` |
| `hep-th/9901001` | `hep-th/9901001` |
| `https://arxiv.org/list/cs.LG/recent` | not an arXiv id |

### DOI forms accepted

Percent escapes are decoded first, trailing `)`, `.`, `,` and `;` are trimmed,
and the result is lowercased. So `10.1145/ABC.Def` becomes `10.1145/abc.def`.

### Title keys

A title key is the title in lower case, with accents removed and only letters and
digits kept. Filename noise and placeholder titles are removed first. A key needs
at least 20 characters once spaces are removed; shorter keys are not used.

### Placeholder titles

These titles are the publisher's or reference manager's text, not the paper's
title, and are never used as a title:

- `Catalogue page`, `Snapshot`, `Untitled`, `Document`, `Download`, `View`, `PDF`, `Article`
- `Full Text PDF`, `SAGE PDF Full Text` and similar full-text labels
- `Preprint PDF`, `Accepted version`, `Submitted version`, `Published version`
- Titles starting with `Just a moment`, `Access denied`, `Attention required`,
  `Page not found`, `404 not found`, `Sign in`, `Log in` or `Login`

### Import refusals

When a page cannot be imported, WeaveForge says one of these (exact text):

| Message | Cause |
|---|---|
| That site blocked automated access. Import by DOI or arXiv id instead. | The page title is a bot challenge (for example "Just a moment", "Verifying your browser", "Are you a robot", "Captcha"). |
| That page has no title to file the paper under. Add the paper manually. | The page has no title. |
| That page does not look like a paper or an article — it has no citation tags and does not say it is an article. Import by DOI or arXiv id, or add the paper manually. | No citation tags, and the page is not marked as an article. |

## How it works

Reference parsing and page reading are pure text work, done by the Rust core
(`wf-core`). They make no network calls: the page must be fetched first, and the
parsers only read the text they are given. Text longer than the core's index
text limit is refused with a length error, not parsed.

Page metadata is read in this order of preference: citation tags, then Dublin
Core, then JSON-LD, then OpenGraph. The publication date comes from citation
tags first, then JSON-LD, then generic article tags. A site name after the title
(for example `Attention | Lil'Log`) is treated as the site's name, not part of the
title. An arXiv id is read from the address of an arXiv abs or pdf page, with its
version and `.pdf` removed.

A reference-manager filename is turned into a title: `Goyal et al. - 2017 -
Accurate, Large Minibatch SGD.pdf` becomes `Accurate, Large Minibatch SGD`, and a
`_ ` subtitle separator becomes `: `.

The other sources' answers are read the same way: Crossref, Semantic Scholar,
OpenAlex and arXiv responses are turned into paper fields by the core, and the
app only fetches them and chooses the best match. Library tidying finds
placeholder and filename titles and papers that are the same paper, and a merge
folds a duplicate's details into the copy kept. The core also ranks
open-access copies, maps Zotero items to papers and back, and reads `.bib` exports.
Each of these is a pure function: it reports what would change and writes nothing.

Source: `crates/wf-core/src/papers/`

## Related

- [Citations, excerpts and Overleaf](citations-and-overleaf.md) — using papers in notes and the report
- [Search](search.md) — finding papers by title, including misspelt titles
- [Integrations](integrations.md) — Zotero sync
