# Search

Search is one box over the whole workspace: papers, notes, report sections,
experiments, milestones, log entries, PDF text and annotations. It runs in your
browser over an index built from your project, so it works offline and never
sends a query anywhere.

## How to

### Find something when you misspell it

1. Type the word as you remember it, such as `attension` or `nerual`.
2. Read the results. If nothing matches, search retries once with one more
   edit allowed per term. You do not need to do anything.

Search tolerates typos, so a misspelled title still finds the paper. It can
miss a typo inside a three-character acronym, such as `vea` for `β-VAE`.

### Find a paper by its acronym

Type the acronym, such as `gan` for *Generative Adversarial Networks*. Search
derives acronyms from each title when it builds the index.

### Narrow a search with filters

1. Add a filter as `field:value`, such as `kind:note`, `tag:vae` or
   `path:chapter-3`.
2. Add `"exact phrase"` to match the words in order, or `-word` to exclude a term.
3. Read the results. A query made only of filters lists matches rather than
   ranking them.

## Reference

### Query syntax

| Syntax | Meaning |
| --- | --- |
| `kind:<value>` or `type:<value>` | Limit to one kind of item |
| `path:<value>` or `in:<value>` | Limit to items whose path matches. `in:` is the same filter |
| `tag:<value>` | Limit to items with a tag. A leading `#` is ignored |
| `modified:<n><unit>` | Limit to items changed within the last `n` days, weeks, months or years. Units are `d`, `w`, `m` and `y`. Values outside 1 to 36,500 days are ignored. |
| `"..."` | Match an exact phrase |
| `-term` | Exclude items containing the term |

### Field boosts

Matches in a field score higher the more the field is boosted.

| Field | Default boost |
| --- | --- |
| `title` | 8 |
| `aliases` (derived acronyms) | 6 |
| `headings` | 3 |
| `tags` | 3 |
| `path` | 2 |
| `body` | 1 |

Each boost can be changed in Settings, within 0 to 20. Values outside that range
are clamped to it. Unknown field names are ignored.

### Fuzziness by term length

Length counts characters in the term.

| Term length | Edits allowed on the first pass | Edits allowed on a retry |
| --- | --- | --- |
| 3 or fewer | 0 | 0 |
| 4 or 5 | 0.1 of the length, rounded | the same, plus 1 |
| 6 or more | 0.2 of the length, rounded | the same, plus 1 |

Retry happens only when the first pass returns no results, and only for queries
of 1 to 4 terms. Terms shorter than 4 characters (counted in UTF-16 units) are never retried.

### Ranking and recency

Ranking is BM25 over the boosted fields above, multiplied by a document signal:
link degree first. Recency multiplies the score by `1 + 0.15 × 0.5^(age ÷ 180 days)`.
An item changed today gets up to 15% more score. That bonus halves every 180
days and fades toward none. Recency can be switched off in Settings with
`recencyBoost`.

Items of a downranked kind are multiplied by 0.25. Downranking sinks them but
does not hide them.

### Semantic results

When semantic search is on in Settings, its results are fused with the keyword
results rather than replacing them. The app drops semantic matches with a score
below 0.3.

### Limits

| Limit | Value |
| --- | --- |
| Indexed body text per document | 256,000 characters |
| Corpus size before a warning appears | 5,000 documents |
| Recent searches kept | 12 |

## How it works

Search runs in your browser. The ranking rules live in the Rust core
(`crates/wf-core/src/search/`), and the browser calls them through WebAssembly.
The app builds the index from a snapshot of your project and rebuilds it when the
content changes.

Edit distance is allowed as a fraction of term length, and short terms get none
on purpose. At three characters most of the dictionary is one edit away, so
tolerance there returns noise instead of the word you meant.

A transposition, such as `nerual` for `neural`, is one edit in Damerau distance
but two in Levenshtein distance, which is what the index measures. A six-letter
term allowed one edit can never reach its own transposition. Raising the
tolerance everywhere would fix that, but it would pull unrelated documents into
results that were already right. So the extra edit applies only on the retry.
Long queries are exempt, because five words that match nothing usually mean the
thing is genuinely absent.

Acronyms are derived at index time from each title and stored as aliases. The
derivation skips grammar words, stops at a colon, and also takes an initialism
the title already contains, such as `β-VAE`, `BERT` or `DDPM`.

Search does not stem. `training` does not match `trained`.

Source: `crates/wf-core/src/search/`. The rules are in `search_tuning.rs`,
`search_retry.rs`, `acronyms.rs`, `search_settings.rs` and `query.rs`.

## Related

- [Projects and workspaces](workspaces.md): the boundary search covers.
- [Integrations](integrations.md): the MCP tools that search your workspace.
