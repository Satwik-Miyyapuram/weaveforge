# Search

One search box over the whole workspace — papers, notes, report sections,
experiments, milestones, log entries, PDF text and annotations. It runs **in the
browser**, over an index built from a snapshot of your project, so it works
offline and never sends a query anywhere.

## Typing it wrong still finds it

Spelling is not a precondition. Measured against a corpus of real paper titles
and seventeen plausible misspellings, search recovers **sixteen**:

| you type | you get |
|---|---|
| `attension` | Attention Is All You Need |
| `disentangelment` | Disentanglement reading cluster |
| `nerual` | Neural Message Passing for Quantum Chemistry |
| `abaltion` | Graph-prior module ablation |
| `gan` | Generative Adversarial Networks |
| `seuqence` | Sequence to Sequence Learning… |

Three mechanisms, in the order they apply.

### 1. Graduated fuzziness

Edit distance is allowed as a fraction of term length: none below four
characters, 0.1 to five, 0.2 beyond. Short terms get none deliberately — at
three characters most of the dictionary is one edit away, so tolerance there
returns noise instead of the thing you meant.

### 2. One more edit, but only when nothing matched

A transposition — `nerual` for `neural`, `attnetion` for `attention` — is a
single Damerau edit but **two** Levenshtein edits, and Levenshtein is what the
index measures. A six-letter term is allowed one edit, so it can never reach its
own transposition.

Raising the tolerance everywhere would fix that and make every working query
worse, by pulling unrelated documents into results that were already correct.
So the escalation is conditional: **if a query returns nothing, it is retried
once with one more edit per term.** A query that found something is never
touched, and the retry costs nothing on the path that matters — measured at
3,000 documents, matching queries are unchanged and a non-matching query costs
0.56 ms including the second pass.

Long queries are exempt. Five words that match nothing usually mean the thing is
genuinely absent, and loosening every term returns a pile of weak matches rather
than the one right answer.

### 3. Acronyms

`gan` is not a misspelling of *Generative Adversarial Networks* — it is three
characters against ten, unreachable by any edit distance, and it is how people
actually refer to papers. Initialisms are therefore derived from each title at
index time and stored in `aliases`, which is already a boosted searchable field.

The derivation skips grammar words (so it is `gan`, not `ganfi`), stops at a
colon (paper titles are overwhelmingly `SHORTNAME: the long descriptive part`,
and the initials of the second half are not a handle anyone uses), and also
picks up an initialism the title already contains — `β-VAE`, `BERT`, `DDPM` —
which is one word and would never survive the word-count rule on its own.

## What it does not do

- **No "did you mean".** The retry silently widens rather than suggesting a
  correction, so there is no second click.
- **No stemming.** `training` does not match `trained`. Fuzziness covers some of
  this by accident, not by design.
- **A typo inside a three-character acronym is not recovered** — `vea` will not
  find `β-VAE`. Tolerance at that length matches too much to be worth it.

## Query syntax

`kind:note`, `tag:vae`, `path:chapter-3`, `"exact phrase"`, and `-excluded`.
Filters combine with terms; a query that is only filters enumerates rather than
ranks.

## Ranking

BM25 over boosted fields — `title` 8, `aliases` 6, `headings` 3, `tags` 3,
`path` 2, `body` 1 — multiplied by a document signal: link degree first,
recency only as a tiebreak. Field boosts and kind weighting are user settings.

An optional semantic arm can be turned on in Settings; when present its results
are fused with the keyword arm rather than replacing them.

## Where it lives

| | |
|---|---|
| Ranking and tuning | [`search-tuning.ts`](../../packages/core/src/search/search-tuning.ts) |
| Acronyms | [`search-acronyms.ts`](../../packages/core/src/search/search-acronyms.ts) |
| Retry policy | [`search-retry.ts`](../../packages/core/src/search/search-retry.ts) |
| The one file that imports MiniSearch | [`minisearch-index.ts`](../../apps/web/src/features/search/infrastructure/minisearch-index.ts) |

The ranking rules live in `@weaveforge/core` deliberately, so they are testable
without a search library and can be exposed as settings. `SEARCH_SCHEMA_VERSION`
must be bumped whenever the indexed shape changes — a cached index from an older
shape is discarded rather than migrated, because a subtly mismatched index
returns wrong results indefinitely with no visible symptom.
