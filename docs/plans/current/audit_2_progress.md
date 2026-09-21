# Audit remediation — plan and progress

Living document. Updated as work lands. Companion to
`docs/plans/current/audit_2_verification.md` (what is true) and
`docs/plans/current/audit_2_decisions.md` (what needs a human call).

Scope of this pass, from the request:

> verify the findings are real, note the duplicates, make a plan, finish the plan,
> leave what needs a decision to the end, then open a PR.

Verification is **done** and written up in the ledger. This document is the plan
and its state.

---

## Status board

| # | Workstream | Findings | State |
| --- | --- | --- | --- |
| 0 | Independent verification of every finding | all of `audit_2.md` | ✅ done |
| 1 | Metric read port: required budget, no unbounded read | WF-N11, WF-N16 (dup) | ✅ done |
| 2 | Metric write/read: bounded payloads | WF-N12 | ✅ done |
| 3 | Lexical extractor: positions, determinism, lifetimes | WF-N06, N07, N13, N15, N17, N20 (dup) | ✅ done |
| 4 | Screen cache: observed IDB write, duplicate JSDoc | WF-N05 (half) | ✅ done |
| 5 | Android: pen pointer id, bounded stroke, teardown | WF-N02, N14, N10 | ✅ done |
| 6 | Android: nav policy, WebView hardening, scoped cleartext | WF-N08, N09, X08 | ✅ done |
| 7 | Android: privilege-posture gate | WF-X01, X02 | ✅ done |
| 8 | Screen-cache cancellation | WF-N05 (other half) | ⏸ decision D1 |
| 9 | Metric `append` round-trip test | WF-N04, MEM-04 | ⏸ decision D2 |
| 10 | `check:android-permissions` as a release-build gate | WF-N19 | ⏸ decision D3 |
| 11 | Privileged-capability diagnostic screen | WF-X07 | ⏸ decision D4 |
| 12 | Pen-only gesture ownership | WF-N03 | ⏸ decision D5 |
| 13 | Android compilation verified on this machine | — | ⚠ environment |

Legend: ✅ landed · ⏸ needs a decision · ⚠ blocked by the environment.

---

## What the verification changed

It reordered the work. The two highest-scored findings in the document are both
wrong in the same direction — each describes, as missing, a fix that is already
in the tree:

* **WF-N01 (8.6, "Critical")** is refuted. Migration `0132` already does exactly
  what the finding's own SQL block prescribes: `greatest()` makes the watermark
  forwards-only inside the statement, and the sweep is bounded by the watermark
  just written, not by the client's `uptoId`.
* **WF-N04 (7.0)** is partial. `append` inserts through the `experiment_metrics`
  view, but `0114:321` / `0115:136` install the `INSTEAD OF INSERT` trigger that
  makes that a working write path. The finding's proposed fix — insert straight
  into the point table — would have broken it.

So the top of the document contributed no work, and the ledger exists to stop the
next reader re-doing this analysis. Fifteen findings are already fixed and are
listed there so no plan includes them again.

Two further corrections that changed what got built:

* **WF-N14** claimed a nullable `Float?` buffer that "never forgets a stroke".
  Neither is true (`ArrayList<Float>`, cleared at `ACTION_UP`). The real defect is
  narrower — an unbounded per-stroke buffer and boxed-Float JSON on the UI thread
  — and that is what was fixed.
* **WF-N05** claimed an unhandled IndexedDB rejection. `idbSetScreenCache`
  swallows its own errors, so that promise cannot reject. Only the missing
  cancellation is real, and it needs the contract decision D1.

---

## Landed, with the reasoning

### 1 · The metric read port has a required budget

`IMetricHistoryReader.history(experimentId, metric, budget)` — `budget` is now
required, and the adapter's unbounded paging fallback is **deleted**, not
defaulted. `packages/core/src/features/experiments/domain/metric-point.ts`.

Why delete rather than keep behind a flag: the audit's own argument is the right
one — a chart is a few hundred pixels wide, `metric_history` already does the
stride reduction where the data lives (never an average, so a spike stays a
spike), and an unbounded branch that a caller reaches by *forgetting a keyword
argument* is a capability, not a convenience. 400 000 steps × 5 metrics was
2 000 000 row objects materialised for a line drawing.

`MetricBudget` is a named type rather than an inline object so the requirement is
greppable and has one place to explain itself.

Contract suite and both adapters updated; the paging-loop tests were replaced
with tests that assert the *reduction* (a 1 200-point series read with a budget of
100 comes back as ~100 points with both endpoints intact) rather than the
unbounded behaviour they used to pin.

### 2 · Bounded payloads

`append` chunks at 1 000 rows and now writes `experiment_metric_points` directly;
`latestActivityAt` chunks ids at 500 and merges by max per id, so the answer does
not change when the chunk count does. A Postgres array parameter is bound as one
text literal, so its cost is quadratic in its own length.

### 3 · The lexical extractor carries positions and stops searching

The whole module was already converted to position-carrying form
(`snippetAt(text, index, length)`); one call was not. Now:

* `extractHashtagRefs` reports where each tag was found; `extractWikilinks` carries
  `index`/`length`. Both readers already walked a regex and threw the offset away.
* `harvestStated` passes those offsets and `evidenceFor` — two full document scans
  per stated mention — is **deleted**, not optimised.
* The acronym loop uses a forward-only token walk instead of
  `phrase.indexOf(token)`, which answered with the first textual occurrence and so
  quoted the wrong neighbourhood for any token that is a substring of an earlier
  word (WF-N06's defect).
* The `CANDIDATE` regex is compiled per scan; the module-level `lastIndex` cursor
  is gone.
* `rankAndLimit` compares codepoints instead of `localeCompare`, which resolves to
  the host's locale and ICU build — at the `maxConcepts` cut, that decides *which
  concepts survive*, not merely their order.
* `prepare` returns `{ raw, plain }`. The two lowercased copies (`plainLower`,
  `rawLower`) were only ever read by the searches that no longer exist, so they are
  deleted rather than made lazy — the fix is strictly larger than the one the
  audit proposed for WF-N15/WF-N20.
* `extract` prepares, harvests and drops one document at a time instead of
  `map(prepare)` over the whole corpus.

One thing the audit got wrong and the code now says properly: `evidenceAt` takes
an explicit `source: "plain" | "raw"`. It is not inferable from the offset —
`stripMarkdown` blanks wikilinks and collapses code, so the two strings agree on
most offsets and disagree on exactly the ones a mention comes from. A first
attempt inferred it and silently produced blank evidence for wikilinks; the
regression is covered by the pre-existing test.

### 4 · The screen cache observes its own write

`void idbSetScreenCache(...)` became `void ...catch(...)` recording
`screen.<id>.idb_write_failed` — plus the duplicated JSDoc block above
`useScreenData` is gone (it had been written twice verbatim).

The comment states the honest position: that promise cannot reject *today*, which
is exactly why the failure needs a number attached to it. The offline restore is
the feature whose quiet failure is invisible until the network is gone.

### 5 · Android: the pen has its own pointer id

`InkingOverlayView.onTouchEvent` read `getToolType(0)` and `event.x`/`event.y`
(pointer 0's). A left-handed writer puts the palm down first, so the pen arrives
as `ACTION_POINTER_DOWN` at index 1 — an action the `when` did not handle — and
the stroke never started at all.

Now: the action's own `actionIndex` decides the tool; the pen's `pointerId` is
latched; `ACTION_MOVE` walks the pointers and captures only the pen's (reading
index 0 would sample the palm's coordinates into the stroke); `ACTION_POINTER_UP`
finishes the stroke when the *pen* leaves, not when any pointer does. A stream the
overlay already owns stays with the pen even when an action's index is the palm's.

### 6 · Android: bounded stroke, hand-rolled payload

`MAX_STROKE_SAMPLES` caps the buffer so a long pass commits short instead of
allocating without bound, and `encodeStroke` writes the JSON array directly —
the `JSONArray(strokePoints).toString()` route boxes every `Float` and wraps it in
a `JSONObject` value, about four object allocations per sample, on the pen-lift
frame. Same wire format; the web side's `nativeStrokeEvents` reads flat groups of
four either way.

What was **not** done, deliberately: moving the encode to a background thread.
`strokePoints` is read and cleared on the main thread, so that needs a copy or a
lock, and a race there corrupts a stroke — a worse outcome than a bounded O(n)
main-thread encode. The allocation *shape* was the actual defect.

### 7 · Android: the shell is confined to one origin

Three separate findings, one shape — the WebView had no policy at all:

* **Navigation policy.** `shouldOverrideUrlLoading` allows only hosts from
  `BuildConfig.ALLOWED_HOSTS` (built from the URL the shell was built to load,
  plus `app.weaveforge.org`). `addJavascriptInterface` grants a capability to the
  *WebView*, not to an origin, so an OAuth redirect or a collaborator's link was a
  caller. `shouldInterceptRequest` applies the same rule to sub-resources, so a
  page on an allowed origin cannot point a script at an internal host.
* **WebSettings.** `mediaPlaybackRequiresUserGesture = true`, safe browsing on
  with `onSafeBrowsingHit → backToSafety`, file and content access off, geolocation
  off.
* **Scoped cleartext.** `usesCleartextTraffic` is one boolean for the whole
  application; a `http://` dev URL turned it on for every host. Replaced with a
  generated `network_security_config.xml` that exempts the one dev host by name
  and forbids cleartext everywhere else.

### 8 · Android: teardown, and the capability gate

`onDestroy` now runs the checklist in order: release the overlay callback and
render (breaking the Activity ↔ WebView ↔ bridge cycle that `destroy()` alone does
not), remove the JS interface, `stopLoading`, `about:blank`, remove from the
parent, then `destroy()`.

`scripts/check-android-permissions.mjs` is the finding that mattered most
(WF-X01, 9.4). The reported symptom — banking and UPI apps refusing to open — is
**not** from this tree, and the wrong attribution produces the wrong fix. The gate
makes the posture verifiable rather than accidental: an allow-list of the one
permission and one component this app may hold, a ban on `BIND_*` bindings and on
sixteen symbols that acquire a device-wide authority, and a failure message that
states the containment rules rather than only the verdict.

Wired into `check:boundaries` **and** the CI boundary-gate job — `check:ci-parity`
caught the omission when only the first was done, which is the gate working as
designed.

---

## Environment note

`apps/android` cannot be compiled on this machine: the only JDK installed is
**25.0.2**, and the pinned Android Gradle Plugin (8.7.3) fails to parse that
version string (`IllegalArgumentException: 25.0.2`) before it reaches Kotlin.
This is a local toolchain fact, not a defect in the change.

What that means for the Android work: it is reviewed by reading, and the braces
and parentheses balance. Every symbol used is from a public API already imported
by the file (`MotionEvent.getToolType(int)`, `getPointerId`, `getX(int)`,
`getHistoricalX(int,int)`, `WebSettings.setSafeBrowsingEnabled`, `WebViewClient`'s
four overrides, `SafeBrowsingResponse.backToSafety`). **It must be built on a JDK
17/21 before it is trusted.** The `check:android-permissions` gate does not need
the Android toolchain and runs everywhere.

---

## Verification checklist

| Check | Result |
| --- | --- |
| `npm run build:core` | ✅ |
| `npm run typecheck` (all workspaces) | ✅ |
| `npm run test:core` | ✅ **1268 pass, 0 fail** (baseline 1267; +1 is the new acronym-offset regression test) |
| `npm run test:web` | ✅ **1577 pass, 0 fail** |
| `npm run test:integration:web` | ✅ **20 pass, 0 fail** (pglite applies every migration) |
| `npm run lint` | ✅ no warnings or errors |
| `npm run check:boundaries` | ✅ including the new gate |
| `node scripts/check-ci-parity.mjs` | ✅ 10 gates, same list in `check:boundaries` and CI |
| `node scripts/check-android-permissions.mjs` | ✅ and verified to fail on a planted `<service android:permission="…BIND_ACCESSIBILITY_SERVICE">` |
| `npm run docs:generate` | ✅ regenerated |
| Android `compileDebugKotlin` | ⚠ blocked by the local JDK (see above) |

### What "0 fail" does and does not cover

It covers the metric port's new required budget, the extractor rewrite, the
screen-cache change and the call sites that had to be updated — the compiler
enumerated those, which is the argument for making the budget a required
parameter rather than an optional one.

It does **not** cover the Android module: nothing in this pipeline compiles
Kotlin, and the local toolchain could not either. It also does not cover the
`append` write path end to end — `A4` proves the chunk-aware view survives a
re-application of `0114`, but no test drives `append` through the trigger and
reads the row back. That gap is decision D2.

## Log

| When | What |
| --- | --- |
| — | Read both audits end to end; recorded the section boundaries and the two-models interleaving. |
| — | Confirmed the deployment shape first (OCI Postgres + PostgREST + Supabase Auth only), because it changes two verdicts. |
| — | Fan-out verification of all 28 `WF-*` findings plus the historical ledger; wrote `audit_2_verification.md`. |
| — | Landed workstreams 1–6. |
| — | Added the Android privilege gate; `check:ci-parity` immediately flagged that it was in `check:boundaries` but not in CI, which is the gate doing its job. Wired into both. |
| — | Wrote `audit_2_decisions.md` — five items, each with a recommendation and the cost of every branch. |
| — | Regenerated docs; core, web and integration suites green; lint and boundaries green. |
| — | Noted that the integration suite already asserts `A4` (re-applying `0114` does not revert the chunk-aware view), which is part of why D2's premise is refuted. |

## Next

1. **This PR** is the code-audit pass: verification, the landed fixes, the gate and the decisions.
2. **Design audit** (`docs/plans/current/design_audit_1.md`) — its own branch and PR, with an A/B decision mock, because it conflicts with itself the same way `audit_2.md` did: the two models collided on settings, People, filters and Help, and one names three trees where the other names four.
3. Whichever of D1–D5 you pick, each is contained enough to be its own change.
