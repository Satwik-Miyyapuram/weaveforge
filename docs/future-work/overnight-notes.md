# Overnight notes — 2026-07-25

Branch: `overnight/queue-2b-through-9` (off `main`; not pushed).

## Completed

| Task | Summary |
|------|---------|
| **2b** | Whitespace normalisation for quote matching. Match in normalised space; map spans back to **original** offsets. Prefix/suffix use `trim: false` so the boundary space abutting `exact` is kept (trimming them was why an earlier incomplete 2b on `main` failed disambiguation). |
| **3** | Optional `contexts`, `intents`, `isInfluential` on `CitationCandidate`; S2 adapter requests and maps them defensively. |
| **4** | Extracted `resolveCiteKey`; added `formatCitation` / `formatPaperCitation` for latex / pandoc / footnote / raw. Overleaf latex path unchanged. |
| **5** | `CombinedPdfAnchor` + `chooseAnchorStrategy` — rects only when content hash matches; else quote at low confidence. |
| **6** | `IPdfSourceResolver` + `resolvePdfSource` chain (caller order preserved; throws skipped). |
| **7** | Vault note template engine (`{{var}}` + `wf:generated` / `wf:editable` markers). Merge rebuilds from the **existing** document so user text is byte-identical; damaged markers → keep entire existing doc. |
| **8** | `expartifact:` markdown refs (avoids `[[wikilink]]` / `reportimg:` collisions); resolve outcomes include experiment stale (~2 min heartbeat). |
| **9** | `rankCitationAlerts` — result/method > background, `isInfluential` boost, missing signals fall back to recency. |

## Skipped

None.

## Human should check

1. **Task 2b already partially present on `main`** (via docs commit `89a5f74`) before this branch — the affix-trim fix and corrected offset tests are what made it green. Consider cherry-picking or merging this branch before more reader work on `main`.
2. **Task 7** is application-only: no UI wiring. Marker format is `<!-- wf:generated:name -->` / `<!-- wf:editable:name -->`. Decide the default source-note template before calling `applyTemplate` from the vault/paper flows.
3. **Task 8** syntax is `![alt](expartifact:<experimentId>/<artifactName>)`. Insertion UI still needs a human.
4. **Task 9** ranking is pure and unused by the alert use-case yet — wire when designing the alert list UI.
5. Do not push / open a PR until reviewed (per queue rules).

## Done-check

Each task passed `typecheck`, `test:core`, `check:boundaries`, `build:core` before commit. Web feature tests for Tasks 3, 4, 7, 8, 9 were also run where applicable.
