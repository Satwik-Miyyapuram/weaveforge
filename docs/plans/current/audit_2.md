> **Historical — a review record, not a guide.** `design_audit_1.md` is the raw
> output of a design review run against this repository, two models' findings
> concatenated. It is kept verbatim as evidence for `design_audit_verification.md`,
> so it names files that did not exist then or do not exist now — that is what a
> finding describing a gap looks like. Read the verification ledger for what is
> actually true, not this file.
 {
    id: "WF-N01",
    title: "The compaction guard is advisory: two concurrent compactors can both pass `currentUpto` and one of them sweeps rows the other has not snapshotted",
    severity: "Critical",
    score: 8.6,
    area: "packages/core · collab · CRDT log",
    files: [
      "packages/core/src/features/collab/application/compact-crdt-log.use-case.ts",
      "…/collab/infrastructure/*-crdt-update-store.ts  (the `compact` implementation)",
    ],
    problem:
      "The original delete-before-watermark bug is closed — `execute()` now delegates to `crdtStore.compact({ uptoId, currentUpto })`, which moves the watermark and sweeps the covered rows in one transaction. What survives is the ordering *between* callers. `currentSnapshotUpto` is read by the caller and passed in as advisory context; the use-case only rejects when `input.snapshotUptoId <= input.currentSnapshotUpto`. Two clients that both hold the same `currentSnapshotUpto` (or both pass `null`) both sail past that check and both call `compact` with different `uptoId` values. Whichever commits second must not move the watermark backwards, and whichever sweeps first must not remove rows that the other's snapshot has not yet covered.",
    discovered:
      "Read the current `execute()` end to end. The doc comment promises 'refuses outright unless the caller may edit the resource' and 'moves the watermark and sweeps the covered rows in one transaction' — but the monotonicity decision is taken in TypeScript against a value the client supplied, not in the statement that writes. The guard is therefore a hint with a transaction around the write, not a compare-and-swap.",
    why:
      "This is the same class as the audit's WF-B08, one level down. Transactionality makes each compaction atomic; it does not make two compactions serialisable against a stale precondition. The precondition has to be evaluated *inside* the statement — `where snapshot_upto < $upto` — so that the loser's write is a no-op and it can be told so. Evaluated outside, the precondition can be true when it is read and false when the write lands, and CRDT update rows are exactly the data nobody notices is gone until a client cold-loads a note and finds it a week behind. A stale read here is silent, total and unrecoverable, which is why it is scored above the bugs that crash.",
    fix:
      "Make the guard part of the write. `compact` should run a single statement (or one CTE) that both updates and deletes under `where snapshot_upto < $upto`, and report `rowCount` back to the use case; `rowCount === 0` maps to `{ status: 'no-op', reason: 'stale' }`. Keep the caller-side comparison as a cheap early-out, not as the authority. If the sweep and the watermark are two statements inside one transaction, the delete must be filtered by the watermark it just wrote (`where id <= new_snapshot_upto`), never by the client's `uptoId`.",
    code: {
      caption: "compact-crdt-log.use-case.ts — the precondition belongs to the write",
      lang: "sql",
      body: `-- one statement: no interleaving, no stale precondition
with moved as (
    update crdt_snapshots
       set snapshot_upto = greatest(snapshot_upto, $upto),
           updated_at    = now()
     where resource_type = $type
       and resource_id   = $id
       and snapshot_upto < $upto          -- compare-and-swap, not advice
    returning snapshot_upto
)
delete from crdt_updates
 where resource_type = $type
   and resource_id   = $id
   and id <= (select snapshot_upto from moved);

-- 0 rows from "moved" => the caller was stale => { status: "no-op", reason: "stale" }`,
    },
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-N02",
    title: "A palm landing before the nib silently eats the stroke — `onStylus` only understands single-pointer actions and `getToolType(0)`",
    severity: "High",
    score: 7.9,
    area: "apps/android · InkingOverlayView.kt",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt"],
    problem:
      "`onTouchEvent` decides stylus-vs-finger from `event.getToolType(0)` and then hands to `onStylus`, whose `when (event.actionMasked)` handles exactly `ACTION_DOWN`, `ACTION_MOVE`, `ACTION_UP`, `ACTION_CANCEL`. It reads coordinates from `event.x` / `event.y`, which are pointer **index 0**'s. In the real failure — the palm rests on the glass ~80 ms before the nib lands — the palm is pointer 0 and the pen arrives as pointer 1: the pen's arrival is `ACTION_POINTER_DOWN`, which falls through the `when`, `isStylusDrawing` is never set, and every subsequent `ACTION_MOVE` returns `false`. The stroke does not start at all. When the palm lifts (`ACTION_POINTER_UP`, also unhandled) the pen becomes pointer 0 mid-stroke and a stroke begins from the wrong origin. The user sees the app 'not inking when my hand is down' — the exact situation the hover-lock tier exists to prevent.",
    discovered:
      "Traced `onTouchEvent` → `onStylus` while checking the palm-rejection tiers against how Android actually numbers pointers. The tier comments assume the pen is always pointer 0 and the palm always arrives after it. `MotionEvent.actionMasked` for a second pointer is `ACTION_POINTER_DOWN` with `actionIndex` at the new pointer, and nothing in the file reads `actionIndex` or `findPointerIndex`.",
    why:
      "Palm rejection is written as a policy over events (`onTouch`) but the capture path is written as a state machine over a single pointer. The two disagree at the only place that matters — the moment of contact — and the disagreement is invisible in single-pointer testing, which is how all of this gets QA'd. It is not a rare path: left-handed writers put the palm down first nearly every stroke.",
    fix:
      "Give the stylus its own pointer id. On `ACTION_DOWN`/`ACTION_POINTER_DOWN`, if `getToolType(actionIndex)` is `TOOL_TYPE_STYLUS` or `TOOL_TYPE_ERASER`, latch `penPointerId = getPointerId(actionIndex)` and start the stroke. On `ACTION_MOVE`, walk `0 until event.pointerCount`, skip anything that is not `penPointerId`, and record with `getX(i)`/`getY(i)`/`getPressure(i)`. On `ACTION_POINTER_UP`, if the leaving pointer is the pen, finish the stroke; if it is the palm, just clear the palm tier. Clear `penPointerId` on `ACTION_UP` and `ACTION_CANCEL`. `getToolType(index)`, never `getToolType(0)`.",
    code: {
      caption: "InkingOverlayView.kt — latch the pen's own pointer id",
      lang: "kotlin",
      body: `private var penPointerId = -1

MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
    val i = event.actionIndex
    val t = event.getToolType(i)                 // NOT (0)
    if (t != MotionEvent.TOOL_TYPE_STYLUS && t != MotionEvent.TOOL_TYPE_ERASER) return false
    if (!inViewport(event.getX(i), event.getY(i))) return false
    penPointerId = event.getPointerId(i)
    clear(); isStylusDrawing = true
    record(event.getX(i), event.getY(i), event.getPressure(i), event.eventTime)
    true
}

MotionEvent.ACTION_MOVE -> {
    if (!isStylusDrawing) return false
    for (p in 0 until event.pointerCount) {
        if (event.getPointerId(p) != penPointerId) continue
        for (h in 0 until event.historySize) {
            record(event.getHistoricalX(p, h), event.getHistoricalY(p, h),
                   event.getHistoricalPressure(p, h), event.getHistoricalEventTime(p, h))
        }
        record(event.getX(p), event.getY(p), event.getPressure(p), event.eventTime)
    }
    true
}`,
    },
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-N03",
    title: "Pen-only mode documents a two-finger pan/pinch that can never arrive, because Tier D already swallowed the first finger",
    severity: "High",
    score: 7.2,
    area: "apps/android · InkingOverlayView.kt · onTouch",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt"],
    problem:
      "Tier D is `if (penOnly) return event.pointerCount < 2`, with the comment 'two fingers still pan and pinch the page beneath'. A gesture is one dispatch stream: the first finger's `ACTION_DOWN` arrives with `pointerCount == 1`, so Tier D returns `true` and the gesture is consumed by the overlay. The second finger produces `ACTION_POINTER_DOWN` inside a gesture the overlay already owns. Returning `false` there does not hand the earlier `ACTION_DOWN` back to the web view — no view below has ever seen this gesture, so nothing can scroll or pinch. The documented escape hatch is unreachable; in pen-only mode the page can only be scrolled with the pen outside the ink rect.",
    discovered:
      "Read Tier D against Android's gesture dispatch contract: `onTouchEvent` returning `false` for `ACTION_DOWN` opts a view out of the gesture, but returning `false` for a later action after having returned `true` for `ACTION_DOWN` only releases the *rest* of the stream — the consumed `ACTION_DOWN` is not replayed to the views underneath.",
    why:
      "A hand-rolled gesture router can only ever give the view below the *remainder* of a stream, never its beginning. Any rule that decides 'swallow or pass' at pointer-count time is therefore wrong for any gesture whose pointer count changes — which is every pinch and every palm-then-nib sequence. The fix is not a better threshold, it is deciding the owner before the first event is claimed, or releasing the whole gesture explicitly.",
    fix:
      "Two options, both cheap. (a) Defer the claim: on `ACTION_DOWN` in pen-only mode record the candidate but return `false` and let the overlay re-acquire only when the pen pointer appears — simplest correct behaviour, at the cost of not blocking a stray finger tap. (b) Keep claiming single-finger touches, but when `ACTION_POINTER_DOWN` reaches two fingers, `dispatchTouchEvent` a synthesised `ACTION_CANCEL` to self and hand the web view a `MotionEvent` reconstructed with the original `ACTION_DOWN` offsetTime — that is what `onInterceptTouchEvent` in a parent `ViewGroup` gives you for free. Because the overlay is a `SurfaceView` sibling rather than a `ViewGroup` parent of the `WebView`, (a) is the honest fix here; (b) becomes available if the overlay is moved into a `FrameLayout` container that both views sit inside, where `onInterceptTouchEvent` can take the gesture over mid-stream.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N04",
    title: "`SupabaseMetricRepository.append` inserts into `experiment_metrics`, which has been a *view* since 0114/0115",
    severity: "High",
    score: 7.0,
    area: "apps/web · experiments infrastructure",
    files: [
      "apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts",
      "supabase/migrations/0114_*.sql, 0115_*.sql",
    ],
    problem:
      "`const TABLE = \"experiment_metrics\"` is used for both the paged read and the `insert(payload)` in `append()`. Migrations 0114/0115 dropped the `experiment_metrics` table and replaced it with a chunk-aware **view** that `unnest`-expands `experiment_metric_chunks` and unions `experiment_metric_points`. An `insert` through that view requires an `INSTEAD OF INSERT` trigger; if one exists it is an undocumented write path into the chunk expansion, and if one does not, `append` fails at runtime with `cannot insert into a view`. The repository interface is `IMetricRepository`, so a second implementor (a local/PostgREST backend, or a test double built from this class) inherits the same wrong table name. The class doc says 'the Python SDK is the writer' — which is the strongest hint that this method is an unexercised write path against a read-only relation.",
    discovered:
      "Read the adapter alongside the class's own doc comment: 'the row store is `experiment_metric_points`, and `experiment_metric_chunks` holds settled points packed into arrays, with the view unioning the expanded chunks and the loose rows.' The read methods are careful about that (`METRIC_COLUMNS` says the view exposes 'exactly these plus `user_id`'); `append` was written before the change and points at the view.",
    why:
      "A relation that changed shape under a name that did not is the classic migration half-completion. Reads were updated in place because reads visibly break; the write was not, because the SDK is the production writer and nothing calls `append` in the app — so the breakage is latent until someone wires an in-app metric logger, and then it fails in the one direction that is hardest to debug (a database error on a fire-and-forget path).",
    fix:
      "Point `append` at the row store: `this.db.from('experiment_metric_points').insert(payload)`. If settled points are meant to go straight into chunks, that is a deliberate bulk-ingest API and should be a named method (`appendChunked`) rather than a silent reinterpretation of `append`. Either way, delete `TABLE` as a shared constant — one constant for two relations is what let the read and the write drift — and add one integration test that round-trips `append` then reads `history()`. If `append` is genuinely dead on the current port, delete it from the adapter and narrow the interface.",
    code: {
      caption: "supabase-metric-repository.ts — one name per relation",
      lang: "ts",
      body: `const VIEW_METRICS   = "experiment_metrics";       // read: chunks ∪ loose rows
const TABLE_POINTS   = "experiment_metric_points"; // write: the row store

async append(points: MetricPoint[]): Promise<void> {
  if (points.length === 0) return;
  for (const chunk of chunked(points.map(toRow), 1000)) {
    await run(this.db.from(TABLE_POINTS).insert(chunk));
  }
}`,
    },
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N05",
    title: "`useScreenData` fires an un-awaited IndexedDB write and has no way to cancel an in-flight load",
    severity: "Medium",
    score: 5.8,
    area: "apps/web · lib/hooks · screen cache",
    files: [
      "apps/web/src/lib/hooks/use-screen-data.ts",
      "apps/web/src/lib/cache/screen-cache-idb.ts",
    ],
    problem:
      "Two separate robustness holes on the same line group. (1) `void idbSetScreenCache(cacheKey, fresh)` discards the promise: a QuotaExceededError or a blocked IndexedDB transaction becomes an unhandled rejection, which in a strict root config is a hard error and otherwise is a silent hole in the offline restore this hook exists to provide. (2) `loadRef.current()` is called with no `AbortSignal`, so a slow load continues after unmount or after a project switch and then writes `setData`/`setLoading` on a dead hook — React 18 tolerates it but the request keeps consuming bandwidth and a socket on a mobile device. The `requestSeq` guard protects *which* answer is written; it does not stop the work.",
    discovered:
      "Read `reload()` line by line against the hook's own doc comment. The comment is unusually precise about ordering (`requestSeq`, `completedLoads`) — which makes the missing rejection path and the missing cancellation conspicuous by contrast: every other write from this hook is awaited and guarded.",
    why:
      "Stale-while-revalidate has three writers and one of them (IDB) is best-effort. Best-effort writes must still be observed, or the failure mode is 'the app is offline and the cache is empty and nothing said why'. And a cache hook without cancellation leaks a fetch per screen per project switch — invisible on desktop, and the single most common cause of a tablet feeling sluggish after a workspace change.",
    fix:
      "Make `load` take `{ signal: AbortSignal }` (a widening change to `LoadScreenUseCase` call sites — do it with the Phase 4 contract work, not before), keep an `AbortController` in a ref keyed by `requestSeq`, and abort it in the effect cleanup and at the start of each `reload`. Catch and record the IDB write: `void idbSetScreenCache(...).catch((e) => recordPerf(\`screen.${screen}.idb_write_failed\`, 1))`. Also delete the duplicated JSDoc block above the function — the same paragraph is written twice.",
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-N06",
    title: "Evidence offsets are found with `indexOf`, so an all-caps token that is a substring of an earlier word gets the wrong quote",
    severity: "Medium",
    score: 5.4,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`harvestGuessed` already knows exactly where each match is — it is inside `while ((match = CANDIDATE.exec(doc.plain)) !== null)` with `match.index` in hand — and then throws the position away for the inner acronym loop: `record(token, match.index + phrase.indexOf(token), token.length)`. `String.prototype.indexOf` returns the first *textual* occurrence anywhere in the phrase, not the occurrence inside this match. For the phrase `\"MAGAN GAN Models\"` the token `GAN` is found at offset 5, inside `MAGAN`, so `snippetAt` quotes the wrong neighbourhood and the evidence shown on a wiki page points at the wrong sentence.",
    discovered:
      "Read the `for (const token of phrase.split(/[^A-Za-z0-9]+/))` loop. The comment above `harvestGuessed` argues — correctly — that reading inside the match is what removed the second regex pass. Offsetting with `indexOf` re-introduces exactly the 'find the text again by searching' mistake that `snippetAt` was written to avoid.",
    why:
      "Every stage of this extractor was converted to position-carrying form (`snippetAt(text, index, length)`), and this one call still rediscovers a position by search. It is a small lie in the output rather than a crash, which is why it survived: evidence snippets are prose, and a snippet 3 characters off still reads fine until it lands mid-word and the researcher quotes it.",
    fix:
      "Track the offset while splitting. Walk the phrase with the same separator regex and accumulate `match.index + consumed`, or simpler: for each token, `const at = phrase.indexOf(token, cursor); cursor = at + token.length;` — a forward-only cursor is monotone and cannot land inside an earlier word. Pass `match.index + at` to `record`.",
    code: {
      caption: "lexical-concept-extractor.ts — a forward-only cursor, no re-search",
      lang: "ts",
      body: `let cursor = 0;
for (const token of phrase.split(/[^A-Za-z0-9]+/)) {
  const at = phrase.indexOf(token, cursor);
  cursor = at + token.length;
  if (!ACRONYM_ONLY.test(token)) continue;
  record(token, match.index + at, token.length);
}`,
    },
    confidence: "Verified in source",
    effort: "XS",
  },
  {
    id: "WF-N07",
    title: "`rankAndLimit` sorts concept names with `localeCompare`, so the surviving page set depends on the machine's locale and ICU build",
    severity: "Medium",
    score: 5.0,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "The tie-break in `rankAndLimit` is `a.name.localeCompare(b.name)`. `localeCompare` with no locale argument resolves to the host's default locale and its ICU collation. The same corpus extracted on a Node server in `en_US` and in a browser in `de_DE` orders `\"AUC\"` / `\"Ärger\"` / `\"Adam\"` differently, and `String.prototype.localeCompare` is also 10–100× slower than a codepoint comparison. Since this is a tie-break at the `maxConcepts` cut, two environments can keep *different concepts* — not merely present them in a different order — which means the generated wiki can have a page on one machine and not on another for the same vault.",
    discovered:
      "Read the sort comparator. The rest of the module is meticulously deterministic (explicit `KIND_INFORMATIVENESS` table, first-write-wins merged deliberately, `conceptKey` normalisation), so a locale-dependent comparator is the one non-deterministic operation in the pipeline.",
    why:
      "Extraction output is a cache key and a page set: anything that varies by host makes the output un-reproducible, and reproducibility is the property this whole module is built to sell ('deterministic, free, private'). It also bites the CI gate that asserts extraction output, which runs in a different locale than the developer's laptop.",
    fix:
      "Compare codepoints: `a.name < b.name ? -1 : a.name > b.name ? 1 : 0`, or `a.name.localeCompare(b.name, \"en\", { sensitivity: \"base\" })` **if** locale-stable ordering across ICU versions is explicitly wanted. The plain codepoint comparison is the right default here — concept keys are already normalised, so there is no case-folding left to do.",
    confidence: "Verified in source",
    effort: "XS",
  },
  {
    id: "WF-N08",
    title: "`addJavascriptInterface` is exposed to every origin the shell ever loads, for the whole life of the WebView",
    severity: "Medium",
    score: 6.1,
    area: "apps/android · MainActivity.kt",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/MainActivity.kt"],
    problem:
      "`webView.addJavascriptInterface(NativeBridge(inkOverlay), \"AndroidInkingBridge\")` is called once, before `loadUrl`, and never removed. `WebViewClient()` is the default one, so *every* link that is tapped inside the web app stays in this WebView: an OAuth redirect, a DOI link in a paper, a collaborator's `<a href>` in a shared note, an attacker's page opened from a search result. All of them can call `window.AndroidInkingBridge.setViewport(…)`, `setTool(…)`, `setPenOnly(…)`, `setHandedness(…)` and `clearOverlay()`. Today that is a small blast radius — the methods post to the overlay and only primitives cross. It stops being small the moment the bridge grows a method that touches storage, which is exactly how these bridges grow.",
    discovered:
      "Read `onCreate`: the interface is added unconditionally and `webViewClient` is `WebViewClient()`, whose default `shouldOverrideUrlLoading` returns `false` — i.e. 'load everything here'. The README lists the bridge as the app's one native capability; nothing constrains who may call it.",
    why:
      "`@JavascriptInterface` is a capability granted to a *WebView*, not to an origin. Android's own docs call out untrusted content in a WebView with a JS interface as the single most common WebView vulnerability in their own lint (the `JavascriptInterface` check). Combined with no navigation policy it is an ambient authority: any page that ever renders becomes a caller. On a device that is also used for payments, an ambient-capability shell is the wrong default regardless of what the methods do today.",
    fix:
      "Three cheap layers. (1) `shouldOverrideUrlLoading` returns `true` (and does nothing) for anything outside an explicit host allow-list — `app.weaveforge.org` plus the dev host when `BuildConfig.DEBUG`. (2) Re-install the interface only while an allow-listed document is loaded: `removeJavascriptInterface` in `doUpdateVisitedHistory`/`onPageStarted` for an off-origin URL, re-add in `onPageFinished` for an allowed one. (3) Give `NativeBridge` a `WeakReference<InkingOverlayView>` and make every method a no-op when `BuildConfig.DEBUG` is false and the call arrives off-origin. Turn `mediaPlaybackRequiresUserGesture` back to `true` for the same reason.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N09",
    title: "A dev build with a `http://` URL flips `usesCleartextTraffic` on for the entire application",
    severity: "Medium",
    score: 5.5,
    area: "apps/android · app/build.gradle.kts + AndroidManifest.xml",
    files: [
      "apps/android/app/build.gradle.kts",
      "apps/android/app/src/main/AndroidManifest.xml",
    ],
    problem:
      "`manifestPlaceholders[\"cleartext\"] = appUrl.startsWith(\"http://\").toString()` feeds a single boolean into the manifest's `android:usesCleartextTraffic`. That switch is application-wide: setting it to `true` permits plaintext HTTP to **every** host, not to the one dev server it was meant for. The README documents `build-apk.ps1 -Url http://192.168.1.10:3000` as a normal workflow, so this is not an exotic build. A user who sideloads that debug APK onto their own tablet — also the workflow the README recommends — carries a shell that will happily send session cookies in the clear to any host a redirect or a captive portal names.",
    discovered:
      "Read `app/build.gradle.kts` and the comment above the placeholder: 'A plain-http development URL needs cleartext; the deployed app is https.' The intent is scoped to one URL; the manifest knob it is wired to is not.",
    why:
      "`usesCleartextTraffic` is a global boolean; the scoped tool is a **network security configuration** XML with a `<domain-config cleartextTrafficPermitted=\"true\">` naming the dev host and `cleartextTrafficPermitted=\"false\"` in the base config. The Gradle side already has the host string in hand (`appUrl`), so the scoped fix is strictly less code than the global one.",
    fix:
      "Generate `res/xml/network_security_config.xml` from `appUrl`'s host (or ship two fixed configs and pick one by build type): base config `cleartextTrafficPermitted=\"false\"`, plus a `domain-config` for the dev host only, and `android:networkSecurityConfig=\"@xml/network_security_config\"` in the manifest with `usesCleartextTraffic` removed entirely. Also pin `debug` builds to the debuggable trust anchor only (`<debug-overrides>`), so a debug APK cannot be used to intercept production traffic without the user noticing.",
    code: {
      caption: "res/xml/network_security_config.xml — scoped, not global",
      lang: "xml",
      body: `<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <!-- only the laptop dev server named at build time -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">192.168.1.10</domain>
  </domain-config>
</network-security-config>`,
    },
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N10",
    title: "`webView.destroy()` with the JS interface still attached leaks the Activity, and can post to a dead renderer",
    severity: "Medium",
    score: 4.8,
    area: "apps/android · MainActivity.kt · lifecycle",
    files: [
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/MainActivity.kt",
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt",
    ],
    problem:
      "`onDestroy` does `webView.destroy()` and nothing else. A WebView holds a strong reference to every `@JavascriptInterface` object, and `NativeBridge` holds `inkOverlay`, whose `onStrokeFinished` lambda captures `webView` and `this` (the Activity). Detaching from the window does not break that cycle. Rotate the device during a long note and the whole Activity — layout, WebView, renderer — survives until the process is killed. Separately, `CanvasFrontBufferedRenderer` keeps rendering callbacks that post to `overlay` after `destroy()`; the `onDrawFrontBufferedLayer` callback touching `penPaint` on a detached `SurfaceView` is undefined territory rather than a crash, which makes it hard to reproduce.",
    discovered:
      "Read `onDestroy` against `MainActivity.NativeBridge`'s constructor and `inkOverlay.onStrokeFinished = { … webView.evaluateJavascript(…) }`. Three objects hold each other and none of them is released. This is the standard Android WebView teardown checklist, all four items skipped: `stopLoading`, `removeJavascriptInterface`, `loadUrl(\"about:blank\")`, remove from parent before `destroy()`.",
    why:
      "`destroy()` releases the native WebView engine but not the Java-side graph that points at it. Google's own documentation names the leak and the fix in the same paragraph. On an inking tablet the Activity is heavy — a SurfaceView, a front-buffered renderer and a full DOM — so this is the largest single allocation in the app surviving a config change.",
    fix:
      "Tear down in order, and break the cycle explicitly: `inkOverlay.onStrokeFinished = null`; `renderer.close()` (or `clear()` plus drop the reference) first so no callback outlives the surface; `webView.removeJavascriptInterface(\"AndroidInkingBridge\")`; `webView.stopLoading(); webView.loadUrl(\"about:blank\")`; `webView.removeAllViews(); (webView.parent as? ViewGroup)?.removeView(webView)`; then `webView.destroy()`, then `super.onDestroy()`. Consider `android:configChanges=\"orientation|screenSize|keyboardHidden\"` for the inking activity so a rotation is not a destroy at all.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N11",
    title: "`history()` without a `maxPoints` budget is an unbounded materialisation of the whole run",
    severity: "Medium",
    score: 5.6,
    area: "apps/web · experiments infrastructure",
    files: ["apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts"],
    problem:
      "The unbudgeted branch loops `for (let from = 0; ; )` with `all.push(...page)` until a page comes back empty. There is no ceiling on `all`. A 400 000-step run logging five metrics is 2 000 000 rows materialised as 2 000 000 JS objects in one array on a tablet, on a path that a chart then reduces to a few thousand pixels. The paging loop is correct — advancing by rows received rather than page size is the right answer to the row-cap problem — but correctness is not a memory budget.",
    discovered:
      "Read the loop. The comment defends the loop's termination condition at length (rightly) and says nothing about its maximum size. `history()`'s signature makes the budget optional, so the safe path is the one a caller has to remember to ask for.",
    why:
      "A read port should not be able to return an unbounded value. Every consumer of this port is a chart with a finite pixel width; the port should force the consumer to state that width, and then the unbounded branch disappears entirely rather than sitting there as the default.",
    fix:
      "Make the budget required: `history(experimentId, metric, { maxPoints: number })`, and delete the paging loop — `metric_history` already does the server-side stride reduction and keeps first and last sample. If a genuinely-complete read is needed (export, recompute), give it its own method name, `historyRaw`, with a hard ceiling parameter and a documented cost, so the cheap name cannot be used for the expensive thing.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N12",
    title: "`latestActivityAt` and `append` both build unbounded payloads for a single round trip",
    severity: "Medium",
    score: 4.6,
    area: "apps/web · experiments infrastructure",
    files: ["apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts"],
    problem:
      "`latestActivityAt` spreads the caller's whole id list into one RPC call: `this.db.rpc(\"latest_metric_activity\", { p_experiment_ids: [...experimentIds] })`. The experiments screen is scoped to a project and paginated, so today it is tens of ids — but the port takes `readonly string[]` with no ceiling, and `check:hygiene` in this repo explicitly fails an API route that walks an unbounded array from a request body for exactly this reason. `append` has the same shape: one `insert(payload)` for `points.length` rows, unbounded.",
    discovered:
      "Read both methods. The repo's own hygiene gate names this pattern as a defect; the adapter does it in two places, one of which is a Postgres array parameter that the plan records has already produced a `malformed array literal` on the local PostgREST client once.",
    why:
      "Array parameters to a Postgres function are bound as a text literal by the local client, so their cost is quadratic in the string and they hit statement-size limits at a few tens of thousands of elements. Chunking turns one catastrophic failure into N bounded requests, and it is five lines.",
    fix:
      "Chunk both at 500 (ids) and 1 000 (points) and merge the results; keep the chunk size as a named constant beside `PAGE`. For `latestActivityAt`, merge into one map and take the max per id, so the semantics do not change when the chunk count does.",
    confidence: "Verified in source",
    effort: "XS",
  },
  {
    id: "WF-N13",
    title: "The shared `CANDIDATE` regex carries `lastIndex` between calls",
    severity: "Low",
    score: 3.2,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`const CANDIDATE = /\\b([A-Z][\\w-]*(?:\\s+[A-Z][\\w-]*){0,3})\\b/g` is module-level with the `g` flag, and `harvestGuessed` begins with `CANDIDATE.lastIndex = 0`. That is correct for a single synchronous scan and fragile the moment two `extract()` calls interleave — `extract` is `async`, and any future `await` inserted between `prepare` and `harvestGuessed` (a progress callback, an `AbortSignal` check, a chunked scheduler for large corpora) makes two documents share one cursor and silently drop matches from both.",
    discovered:
      "Read the reset line and asked why it is needed at all. It is needed because the pattern is stateful; the state is the bug waiting for a scheduler change.",
    why:
      "Global regexes are singletons with memory. Holding one at module scope makes an implicit serialisation assumption ('extraction never interleaves') that no type enforces and no comment states — and the fix costs one allocation per document.",
    fix:
      "Build the pattern per scan: `const re = new RegExp(CANDIDATE.source, \"g\");` inside `harvestGuessed`, or drop the `g` and use `matchAll` on a locally-scoped pattern. Either removes the shared cursor. If a compiled-once pattern is measurably faster, keep the source string at module scope and compile per call — V8 caches the compiled form internally.",
    confidence: "Verified in source",
    effort: "XS",
  },
  {
    id: "WF-N14",
    title: "The stroke is boxed into JSON on the UI thread, and the buffer never forgets a stroke",
    severity: "Low",
    score: 3.9,
    area: "apps/android · InkingOverlayView.kt",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt"],
    problem:
      "`strokePoints` is `ArrayList<Float?>(4 * 512)` and grows for the whole duration of a stroke — a continuous highlighter pass across a page is minutes of samples at the digitiser rate. At `ACTION_UP`, `JSONArray(strokePoints).toString()` boxes every primitive `Float` into `java.lang.Float`, wraps each in a `JSONObject` value, and concatenates the whole thing into one string — on the main thread, before the next `ACTION_DOWN` can be dispatched. A long stroke is 20 000+ samples: a measurable frame drop at exactly the moment the user lifts the pen and expects the dry stroke to commit.",
    discovered:
      "Read `ACTION_UP`. `JSONArray(Collection)` accepts `Float?` values only because each is boxed on the way in; the collection itself is `Float?` (nullable) purely to satisfy that constructor. The `4 * 512` preallocation is a good instinct, then exceeded silently.",
    why:
      "Per-sample work is already kept to one `drawLine` — the file is otherwise careful about cost. The single terminal operation is the one that is O(n) allocation on the critical path, and it is O(n) in *objects*, not bytes: roughly 4 allocations per sample.",
    fix:
      "Write the array yourself into a `StringBuilder` with a small float formatter (2 decimals for x/y is a sub-pixel on any panel, 3 for pressure) — one allocation instead of four per sample — and build it on a background dispatcher, posting only the finished string. Cap the buffer (`MAX_STROKE_SAMPLES`) and finish the stroke early with a `partial` flag rather than letting one gesture allocate without bound. Reuse a pooled `StringBuilder` across strokes.",
    confidence: "Verified in source",
    effort: "S",
  },
];

/* ------------------------------------------------------------------ *
 * §3 — SPEED AND SPACE
 * ------------------------------------------------------------------ */

const speed: Finding[] = [
  {
    id: "WF-N15",
    title: "Concept extraction holds four whole copies of every document in the corpus at once",
    severity: "Critical",
    score: 8.2,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`prepare(document)` returns `{ id, raw, plain, plainLower, rawLower }`, and `extract()` does `const documents = request.documents.map(prepare)` — so **all** documents are prepared up front and all four strings stay reachable for the whole extraction. Four full text copies of the corpus, simultaneously: `raw`, `stripMarkdown(raw)`, `plain.toLowerCase()`, `raw.toLowerCase()`. A 2 000-page vault with 8 KB average notes is 16 MB of source text becoming ~64 MB of live strings, plus V8's two-byte rope overhead, on the same tab that is rendering the wiki preview.",
    discovered:
      "Read `extract()`: `const documents = request.documents.map(prepare); const mentions = documents.flatMap((doc) => [...harvestStated(doc), ...harvestGuessed(doc)]);`. The `map` is not lazy and `documents` is never used again after the `flatMap` — but it stays in scope, and even if it were dropped the peak is what the `map` allocated before the `flatMap` ran.",
    why:
      "The refactor that made this module clean (prepare → harvest → merge → rank) separated the stages and, with them, the lifetimes. `prepare` is a per-document concern being paid for at corpus scale. The fix is not clever: prepare one document, harvest it, discard it — the only things that must survive a document are the `HarvestedMention`s, which are small (key, name, kind, flags, one id, one ~140-char snippet).",
    fix:
      "Replace the `map` + `flatMap` with one pass that prepares, harvests and drops: `const mentions = request.documents.flatMap((d) => { const doc = prepare(d); return [...harvestStated(doc), ...harvestGuessed(doc)]; });`. The prepared document is then unreachable after each iteration and the peak falls to one document plus the mentions. Make `rawLower` a lazy getter (it backs only the evidence fallback) and the peak drops a further 25 %.",
    code: {
      caption: "lexical-concept-extractor.ts — one document in flight",
      lang: "ts",
      body: `const mentions = request.documents.flatMap((d) => {
  const doc = prepare(d);                    // 3–4 strings, one document
  const out = [...harvestStated(doc), ...harvestGuessed(doc)];
  return out;                                // \`doc\` unreachable hereafter
});`,
    },
    confidence: "Verified in source",
    effort: "XS",
  },
  {
    id: "WF-N16",
    title: "The metric read port has no budget on it, so every chart decides for itself how much to move",
    severity: "High",
    score: 7.4,
    area: "apps/web + packages/core · metric read port",
    files: [
      "packages/core/src/…/IMetricRepository (the read port)",
      "apps/web/src/features/experiments/infrastructure/supabase-metric-repository.ts",
    ],
    problem:
      "`history(experimentId, metric?, options?: { maxPoints?: number })` makes downsampling optional. `metric_history(p_experiment_id, p_metric, p_max_points)` already does the right thing server-side — a stride reduction that keeps first and last sample, deliberately not an average so a spike stays a spike — but a caller that omits the budget silently drops to the full-materialisation loop in WF-N11. The port's shape says 'sometimes it is cheap' when the truth is 'it is cheap exactly when you say how many points you can draw'.",
    discovered:
      "Read the method and the RPC it wraps side by side. The server-side path is well designed and well argued in the comment; the type signature lets it be bypassed by forgetting a keyword argument.",
    why:
      "This is the same mistake as WF-N11 from the other end: an unbounded capability in a type. The plan's own rule is that contracts land before structural change precisely so the compiler enumerates the call sites — here the contract is the fix. A chart with 800 physical pixels cannot use 2 000 000 points and cannot know it should not ask for them.",
    fix:
      "Make the budget required and name it after what it is: `history(id, metric, budget: { maxPoints: number })`. Add `readonly maxPoints: number` to whatever view-model type the charts build, so a chart that forgets to state its width fails to compile. Keep `historyRaw` (WF-N11) as the explicit escape hatch with a hard ceiling.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N17",
    title: "`evidenceFor` still searches the whole document twice per stated mention — the half of WF-P04 that was not carried into the rewrite",
    severity: "Medium",
    score: 5.2,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`harvestGuessed` is now fully position-carrying and calls `snippetAt` directly — WF-P04's main clause is genuinely fixed. `harvestStated` is not: `record(name)` calls `evidenceFor(doc, name)`, which does `doc.plainLower.indexOf(lower)` and then, on a miss, `doc.rawLower.indexOf(lower)`. Two full scans of the document per hashtag and per wikilink target, and the second scan only exists because `stripMarkdown` moved the text. A note with 80 tags costs 160 document scans.",
    discovered:
      "Compared the two harvesters. `harvestStated` and `harvestGuessed` take the same `PreparedDocument` and one of them uses the positions `extractHashtags`/`extractWikilinks` already found while the other re-derives them.",
    why:
      "The rewrite fixed the pass that was flagged and left the pass that was not, because the flagged one was the 'guessed' path with the regex loop in plain sight. The stated path's cost is the same order — `extractHashtags` is itself a regex scan, and its `index` is thrown away at the call: `for (const tag of extractHashtags(withoutWikilinks(doc.raw))) record(tag)`.",
    fix:
      "Have `extractHashtags` and `extractWikilinks` return `{ value, index }` (both are internal to this repo and both already walk a regex), thread the index through `record(name, index, length)` and call `snippetAt` directly — then `evidenceFor` and both `indexOf` scans can be deleted outright. If changing the two domain helpers is out of scope, hoist `lower` out of the loop and scan once per document into a `Map<string, number>` of first occurrence, then look mentions up in it: one scan instead of two per mention.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N18",
    title: "Five regex passes over every document before a single concept is found",
    severity: "Medium",
    score: 4.9,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`prepare` runs `stripMarkdown`, which chains five `String.replace` calls over the full raw text (fenced code, inline code, images, wikilinks, headings). `harvestStated` then runs `withoutWikilinks(doc.raw)` — a sixth pass, re-blanking something `stripMarkdown` already handled — and feeds the result to `extractHashtags`, a seventh. Each `replace` allocates a new full-size string. Eight allocations and seven scans per document before the single `CANDIDATE` scan that produces the output.",
    discovered:
      "Counted the passes in `prepare` + `harvestStated`. The module comment claims 'One document is prepared once, then read by two harvesters' — true of the lifetime, not of the work.",
    why:
      "Chained `replace` is the clearest way to write this and the most expensive way to run it: each call is a full pass with a fresh destination string, and three of the five patterns cannot overlap with each other. The cost is invisible at unit-test scale (a 200-word note) and dominant at wiki-planner scale (2 000 pages), which is the only scale anyone cares about.",
    fix:
      "One alternation pass that blanks everything in `stripMarkdown`'s union, preserving length so the offsets stay valid (the `withoutWikilinks` comment already explains why blanking beats deleting). Something like `` /(```[\\s\\S]*?```|`[^`\\n]*`|!\\[[^\\]]*\\]\\([^)]*\\)|\\[\\[[^\\[\\]\\n]*\\]\\]|^#{1,6}\\s+)/gm `` with a replacer that returns spaces for the wikilink case and an empty string for the rest. Then `harvestStated` and `harvestGuessed` read one prepared shape and `withoutWikilinks` is deleted.",
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-N19",
    title: "The Android release build ships unminified and unsigned, so the APK carries its whole dependency graph twice",
    severity: "Medium",
    score: 4.4,
    area: "apps/android · app/build.gradle.kts",
    files: [
      "apps/android/app/build.gradle.kts",
      "apps/android/build-apk.ps1",
      "apps/android/README.md ('Not done: Release signing')",
    ],
    problem:
      "`buildTypes { release { isMinifyEnabled = false } }` and there is no `signingConfig`. `isMinifyEnabled = false` also implies `isShrinkResources` is off, so appcompat 1.7.0, core-ktx 1.13.1, webkit 1.12.1 and graphics-core 1.0.3 ship whole — including every Activity, Fragment, transition and drawable those libraries own and this app never references. For a shell whose entire native surface is one Activity and one View, that is most of the APK. And with no signing config, `assembleRelease` produces an APK that cannot be installed over the debug one: the versioned artifact is not actually a deliverable.",
    discovered:
      "Read `buildTypes` and cross-checked the README's own 'Not done' list. The README is honest about the signing; the shrinking is the unlisted half of the same decision.",
    why:
      "R8 both shrinks and optimises; a two-class application sees 40–60 % size reduction from it routinely. The reason it is usually left off is that it needs a mapping file and a working signing config to be worth anything — which is the same gap the README already names. Both land together or neither does.",
    fix:
      "Add `signingConfigs` reading `WEAVEFORGE_KEYSTORE_FILE` / `_PASSWORD` / `_KEY_ALIAS` from the environment (matching how `WEAVEFORGE_URL` is already read), `isMinifyEnabled = true`, `isShrinkResources = true`, and keep `proguard-rules.pro` with exactly one keep rule — `-keep class org.weaveforge.ink.MainActivity$NativeBridge { @android.webkit.JavascriptInterface <methods>; }` — because R8 otherwise strips the reflection-called bridge methods and the inking silently stops working. Commit `mapping.txt` with each release build.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-N20",
    title: "`prepare` lowercases the raw document even when no evidence lookup will ever need it",
    severity: "Low",
    score: 3.0,
    area: "packages/core · ai-assistant · lexical extractor",
    files: ["packages/core/src/features/ai-assistant/domain/lexical-concept-extractor.ts"],
    problem:
      "`prepare` computes `rawLower: raw.toLowerCase()` eagerly. It is read in exactly one place — the second `indexOf` inside `evidenceFor` — and only when the plain-text lookup misses, which happens only for a hashtag inside a code span or a wikilink target that `stripMarkdown` removed. Most documents pay a full extra string allocation and scan for a branch they never take.",
    discovered:
      "Grepped the two fields' uses through the module: `plainLower` is on the hot path, `rawLower` is the fallback of the fallback.",
    why:
      "With WF-N15's lifetime fix this is 25 % of the peak rather than 100 % of the corpus, but it is the same mistake in miniature: an eager whole-input computation for a conditional consumer. Making it a getter costs one line and removes the question of who pays.",
    fix:
      "`private _rawLower?: string` with `get rawLower() { return (this._rawLower ??= this.raw.toLowerCase()); }`, or make `evidenceFor` compute it on the miss and stop passing it around at all. With WF-N17's index threading, the field disappears entirely.",
    confidence: "Verified in source",
    effort: "XS",
  },

/* ------------------------------------------------------------------ *
 * §4 — PRIVILEGED-PERMISSION COEXISTENCE
 * ------------------------------------------------------------------ */

export const coexist: Finding[] = [
  {
    id: "WF-X01",
    title: "WeaveForge does not hold accessibility, device-admin or overlay permission — so it cannot be what is breaking your payment apps. Keep it that way, and make the build fail if it changes",
    severity: "Critical",
    score: 9.4,
    area: "apps/android · whole module · permission posture",
    files: [
      "apps/android/app/src/main/AndroidManifest.xml  (26 lines / 24 loc)",
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/MainActivity.kt",
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt",
      "apps/android/app/build.gradle.kts",
    ],
    problem:
      "The reported symptom is real and well known: with an accessibility service and/or a device administrator enabled for some app, UPI and banking apps refuse to open, refuse to draw their PIN pad, or show 'for your security, turn off screen overlay'. It is **not** coming from this tree. `apps/android/app/src/main/kotlin/org/weaveforge/ink/` contains exactly two Kotlin classes — `MainActivity` and `InkingOverlayView` — and neither is a `Service`, an `AccessibilityService`, a `DeviceAdminReceiver` or a `WindowManager` overlay. `InkingOverlayView` is a `SurfaceView` inflated inside `R.layout.activity_main`, i.e. inside this app's own window; a view in your own window cannot affect any other application. The module's README states the same thing from the other direction: 'The web app in a WebView, with one thing over it: a transparent, front-buffered stylus surface.' There is no third thing. There is no code path in this repository that could disable, delay or obstruct a payment app.",
    discovered:
      "Enumerated the module: the `kotlin/org/weaveforge/ink` package listing is two files; `app/build.gradle.kts` pulls only appcompat, core-ktx, webkit and graphics-core (no `accessibility-test-framework`, no `devicepolicy`, no `overlay` dependency); the README's 'What is native' section is two bullets. An `AccessibilityService` requires both a `<service android:permission=\"android.permission.BIND_ACCESSIBILITY_SERVICE\">` declaration and a subclass — neither exists. A `DeviceAdminReceiver` likewise. The symptom therefore has to be attributed elsewhere before any code is changed.",
    why:
      "This matters more than any patch in this document, because the wrong attribution produces the wrong fix. If the cause is assumed to be WeaveForge and the app is 'de-permissioned', nothing changes on the device and the payment app is still broken. The actual causes on a real device are, in order of frequency: (1) another app the user installed — a night-light/blue-light filter, a screen-dimmer, a 'hide notch' tool, a floating calculator, a tasker-style automation — holding `SYSTEM_ALERT_WINDOW`; (2) an accessibility service that is genuinely running an unrestricted `onAccessibilityEvent` over all packages (screen readers, clipboard managers, password managers, and automation tools); (3) a device-admin app with a policy like `setKeyguardDisabledFeatures` or `resetPassword`; (4) on some OEM builds, a screen-capture/`MediaProjection` session. Android's 'Screen overlay detected' dialog names *no* package, which is why the user blames whichever app they installed last. The correct deliverable here is therefore twofold: a **containment contract** (WF-X02 to WF-X06) so that this app can never become cause (1), (2) or (3), and a **diagnostic** (WF-X07) so the user can find the real culprit in ten seconds instead of uninstalling things at random.",
    fix:
      "Two parts. Part one — make the posture verifiable rather than accidental: add `check:android-permissions`, a Gradle verification task (or a `scripts/check-android-manifest.mjs` gate in `check:boundaries`, matching how every other gate in this repo works) that fails the build if `AndroidManifest.xml` gains `BIND_ACCESSIBILITY_SERVICE`, `BIND_DEVICE_ADMIN`, `SYSTEM_ALERT_WINDOW`, `MEDIA_PROJECTION`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE` or any `DeviceAdminReceiver` / `AccessibilityService` subclass — with an explicit allow-list and a comment naming this clause, exactly as `check:dry.mjs` does for `select(\"*\")`. Part two — ship the diagnostic in WF-X07. No runtime code changes are required today, and none should be made 'just in case'.",
    code: {
      caption: "scripts/check-android-permissions.mjs — the posture, enforced",
      lang: "js",
      body: `// scripts/check-android-permissions.mjs  (see WF-X01)
const FORBIDDEN_PERMS = [
  "android.permission.BIND_ACCESSIBILITY_SERVICE",
  "android.permission.BIND_DEVICE_ADMIN",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.MANAGE_OVERLAY_PERMISSION",
  "android.permission.MANAGE_DEVICE_POLICY_*",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.RECEIVE_BOOT_COMPLETED",
];
const FORBIDDEN_TYPES = ["AccessibilityService", "DeviceAdminReceiver"];

// fail on any <uses-permission> / <service android:permission> naming one,
// and on any Kotlin : <forbidden> in apps/android/app/src/main/kotlin
// The failure message names this clause and the reason it exists.`,
    },
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-X02",
    title: "The one thing in this repo that could break UPI apps is the transparent touch-consuming ink surface — if anyone ever lifts it into a `TYPE_APPLICATION_OVERLAY` window",
    severity: "Critical",
    score: 8.8,
    area: "apps/android · InkingOverlayView.kt · window ownership",
    files: [
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/InkingOverlayView.kt",
      "apps/android/app/src/main/res/layout/activity_main.xml",
    ],
    problem:
      "`InkingOverlayView` is exactly the shape of view that Android's screen-overlay defence exists to catch: transparent, full-screen, and it *consumes* touch events (`onTouch` returns `true` in four of its five tiers) while something beneath it is trying to read input. Today it is safe, because it is a `SurfaceView` in this activity's own window — `setZOrderOnTop(true)` and `PixelFormat.TRANSLUCENT` only affect z-order inside this app's surface. The moment someone makes 'ink over any app' a feature (the obvious next step for a note-taking tool — a floating scratch pad over a PDF viewer), the natural implementation is a foreground service with `WindowManager.addView(view, TYPE_APPLICATION_OVERLAY.LayoutParams(...))`. That is precisely, and immediately, the thing that makes Google Pay, PhonePe, Paytm and every banking app refuse to proceed: they query `Settings.canDrawOverlays()` and the presence of an overlay window over theirs, and they block the secure input path rather than let a keylogger sit on top of their PIN pad.",
    discovered:
      "Read `onTouch`'s tier table and `onStrokeFinished`, then asked what would have to change to make this surface global rather than local. The answer is one `WindowManager` call and one permission — and the failure it triggers is in another application entirely, which is the hardest kind to debug and the exact complaint in the brief.",
    why:
      "Interference bugs are properties of the *window* and the *permission*, not of the drawing code. The same view is harmless in an Activity and hostile as a system overlay, so the containment has to be expressed as a rule about window type and lifetime, not about what the view draws. Note the direction of the damage: the overlay app keeps working perfectly; it is the *payment* app that degrades. That asymmetry is why users never suspect the overlay, and why this clause is scored Critical even though the code is currently correct.",
    fix:
      "Write the rule down and enforce it. (1) In the design note `docs/internal/design/ink-native-bridges.md`, add a 'Never a system overlay' constraint naming this clause: ink capture is an in-window capability, full stop. (2) Add the same `check:android-permissions` gate as WF-X01 with `TYPE_APPLICATION_OVERLAY`, `WindowManager.LayoutParams.TYPE_` and `canDrawOverlays` on the banned list. (3) If a floating-pad feature is ever genuinely required, implement it as a **Picture-in-Picture / bubble**-style surface anchored to your own task, or as a `TYPE_APPLICATION_OVERLAY` that is `FLAG_NOT_TOUCHABLE | FLAG_NOT_FOCUSABLE | FLAG_LAYOUT_IN_SCREEN` (a pure display, swallowing nothing) — and even then remove it with `WindowManager.removeViewImmediate` in `onPause`, so no overlay exists while any other app is in the foreground. Never consume input in a window that is not yours.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-X03",
    title: "If an `AccessibilityService` is ever added, containment is a package deny-list at the top of `onAccessibilityEvent` — not a narrower event filter",
    severity: "High",
    score: 8.0,
    area: "apps/android · (future) accessibility service · contract",
    files: [
      "apps/android/app/src/main/AndroidManifest.xml  (the service declaration, when it exists)",
      "…/ink/accessibility/WeaveForgeAccessibilityService.kt  (proposed)",
      "…/ink/accessibility/SensitivePackages.kt  (proposed)",
    ],
    problem:
      "The brief's requirement is precise and achievable: an accessibility service must not degrade payment apps. Most implementations fail it by filtering on *event type* and then processing whatever arrives. Event-type filtering does not help, because the damage is not caused by handling a payment app's events — it is caused by (a) retaining its `AccessibilityNodeInfo` tree (which keeps the app's view hierarchy alive and, on some OEM builds, blocks its input dispatch while a node is held), (b) calling `performGlobalAction` while it is foreground, which steals the back/home gesture mid-transaction, (c) requesting `FLAG_REQUEST_FILTER_KEY_EVENTS`, which puts the service in the hardware key dispatch chain system-wide and adds latency to every key the payment app reads, and (d) requesting `FLAG_RETRIEVE_INTERACTIVE_WINDOWS` / touch exploration, which makes the window manager route input through the service. All four are per-service configuration; none of them is visible to the payment app until it misbehaves.",
    discovered:
      "Mapped the brief's complaint against `AccessibilityServiceInfo`'s actual surface. The knobs that affect *other* applications are: `flags`, `eventTypes`, `feedbackType`, `notificationTimeout`, `canRetrieveWindowContent`, `packageNames`, `canTakeScreenshot`, `gestureDetectionPassthrough`, plus what the implementation does with `event.source`. The naive service sets `eventTypes = typeAllMask`, `flags = DEFAULT | FLAG_REQUEST_FILTER_KEY_EVENTS | FLAG_REQUEST_TOUCH_EXPLORATION_MODE`, `canRetrieveWindowContent = true` — every one of which is a system-wide side effect.",
    why:
      "Accessibility is ambient authority over every application on the device. Containing it means making the *first instruction* of the callback a refusal, before any object is allocated or retained: everything after that runs on the tiny set of packages you actually serve. This is the 'robustness, not brute force' shape the brief asks for — the service stays fully capable for the app it serves and is provably inert for everything else, rather than being globally throttled into uselessness. It is also what makes the app acceptable on a device the user does payments on, and what a Play policy review of a restricted 'Accessibility' permission declaration will look for first.",
    fix:
      "Implement the deny-list as a first-line early return, and make the *absence* of the dangerous flags the reviewed default. Concretely:\n\n1. `onAccessibilityEvent`'s first statement is `if (isSensitive(event.packageName)) { event.source?.recycle(); return }` — before any allocation, before any logging.\n2. `AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS` is never set (so `onKeyEvent` is never called and hardware keys are never delayed).\n3. `FLAG_RETRIEVE_INTERACTIVE_WINDOWS`, `FLAG_REQUEST_TOUCH_EXPLORATION_MODE`, `FLAG_REQUEST_MULTI_FINGER_GESTURES`, `FLAG_REQUEST_FINGERPRINT_GESTURES` are never set.\n4. `canRetrieveWindowContent` is `false` unless a specific screen needs the tree; where it is true, `event.source` is `recycle()`d on every exit path including the deny-list one.\n5. `eventTypes` is `typeWindowStateChanged | typeWindowContentChanged` only — never `typeAllMask`, never `typeViewTextSelectionChanged`/`typeViewTextChanged` (password fields arrive masked and reading them is a Play policy violation).\n6. `notificationTimeout = 100` (ms) so events are coalesced and the service is woken at most 10×/s.\n7. `packageNames = null` (you cannot statically name every app you serve) **and** therefore the runtime deny-list is mandatory — the two are a pair, and the comment must say so.\n8. `performGlobalAction(...)` is called only when the foreground package is not sensitive; a `GLOBAL_ACTION_BACK` fired mid-UPI is the single most user-visible way to break a transaction.\n9. The service is `android:exported=\"false\"` with `android:permission=\"android.permission.BIND_ACCESSIBILITY_SERVICE\"` and an `<intent-filter>` carrying `<action android:name=\"android.accessibilityservice.AccessibilityService\" />` plus a `@xml/accessibility_service_config` whose `android:description` says, in one sentence, exactly what is read and why — because the user sees that string in the permission dialog and it is the reason they grant or refuse.\n\nSee the code block for the config and the deny-list.",
    code: {
      caption: "res/xml/accessibility_service_config.xml + SensitivePackages.kt — inert for payments by construction",
      lang: "xml + kotlin",
      body: `<!-- res/xml/accessibility_service_config.xml -->
<accessibility-service
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:notificationTimeout="100"
    android:canRetrieveWindowContent="false"
    android:accessibilityFlags=""
    android:description="@string/a11y_what_we_read" />

// SensitivePackages.kt — refused before anything is allocated
object SensitivePackages {
    private val EXACT = setOf(
        "com.google.android.apps.nbu.paisa.user", // Google Pay (India)
        "com.phonepe.app",                        // PhonePe
        "net.one97.paytm",                        // Paytm
        "in.org.npci.upiapp",                     // BHIM
        "com.dreamplug.android",                  // CRED
        "com.sbi.upi", "com.csam.icici.bank.imobile",
        "com.icom.imobile", "com.axis.mobile",
        "com.konylabs.HDFCBank", "com.snapwork.hdfc",
        "com.whatsapp", "com.instagram.android",
        "com.android.vending", "com.google.android.gms",
    )
    private val PREFIXES = listOf(
        "com.google.android.apps.nbfcs", "com.bank", "com.fin", "in.gov.",
    )

    /** Case-insensitive, O(1) on the hot path. */
    fun isSensitive(pkg: CharSequence?): Boolean {
        if (pkg == null) return true            // unknown owner: refuse
        val p = pkg.toString()
        return p in EXACT || PREFIXES.any(p::startsWith)
    }
}

class WeaveForgeAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        // FIRST statement. Nothing allocated, nothing retained, nothing logged.
        if (SensitivePackages.isSensitive(e.packageName)) {
            e.source?.recycle()
            return
        }
        try { handle(e) } finally { e.source?.recycle() }
    }
    override fun onInterrupt() { /* nothing is buffered; nothing to drain */ }
    override fun onKeyEvent(event: KeyEvent?): Boolean = false  // unreachable: FLAG_REQUEST_FILTER_KEY_EVENTS is never set
}`,
    },
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-X04",
    title: "Device admin is the wrong tool for this app's actual needs — and `lockNow()` fired over a payment sheet is the second-most common way to break one",
    severity: "High",
    score: 7.6,
    area: "apps/android · (future) device admin · contract",
    files: [
      "apps/android/app/src/main/AndroidManifest.xml  (the receiver declaration, when it exists)",
      "…/ink/admin/WeaveDeviceAdminReceiver.kt  (proposed)",
    ],
    problem:
      "There is no `DeviceAdminReceiver` in this tree, and there is no product requirement in it that needs one — an inking shell needs no password policy, no camera policy and no wipe. The failure mode when one is added casually is severe and asymmetric: a device admin that calls `DevicePolicyManager.lockNow()` or `resetPassword()` while a UPI app is mid-transaction either locks over the payment sheet (the transaction times out at the bank) or triggers the banking app's own 'device administrator active' refusal screen, which several Indian banking apps show by name. `wipeData()` and `resetPassword()` are unrecoverable and are exactly the methods a hurried implementation reaches for in a 'secure the notes' story. OEM payment apps additionally detect `DevicePolicyManager.getActiveAdmins()` being non-empty and downgrade their own behaviour (no autofill, no screen-capture, forced re-auth).",
    discovered:
      "Read the brief's second half ('…or device admin permissions…') and mapped it against `DevicePolicyManager`'s API surface and the manifest `uses-policies`. The app's only stated security requirement is protecting the user's own notes — which is a `EncryptedFile`/`KeyStore` problem, never a device-admin one.",
    why:
      "Device-admin policies are process-wide or device-wide by design: they exist to control a *managed* device. A personal note-taking app asking for them is asking to control the whole device in exchange for protecting a folder. The correct robustness answer is not 'use it carefully' — it is 'do not take the capability', so that no future bug can reach it. Where a capability genuinely must exist (a shared-device kiosk mode in an institutional build), it belongs behind a separate product flavour with its own `applicationId`, so the normal build physically cannot contain it.",
    fix:
      "1. Do not add a `DeviceAdminReceiver` to `org.weaveforge.ink`. Protect notes with `androidx.security:security-crypto` (`EncryptedFile`, `MasterKey.Builder` with `AES256_GCM`) and the platform keystore — that is the whole requirement. 2. If a managed flavour is ever built, restrict its `<uses-policies>` to the minimum (`limitPassword` at most), never `wipeData`, `resetPassword`, `setKeyguardDisabledFeatures`, `disableCamera` or `setStorageEncryption`; call nothing from `DevicePolicyManager` on the main thread; and gate every call on `isForegroundSensitive()` — the same `SensitivePackages.isSensitive()` deny-list as WF-X03 — so no admin action can fire while a payment or banking app holds focus. 3. Ship it as `applicationIdSuffix \".managed\"` so it is a different app to Android, cannot be mistaken for the normal one, and cannot be updated into it.",
    confidence: "Verified in source",
    effort: "S",
  },
  {
    id: "WF-X05",
    title: "Screen capture over `FLAG_SECURE` windows: promise nothing, and drop the projection immediately",
    severity: "Medium",
    score: 5.5,
    area: "apps/android · (future) session sharing · contract",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/"],
    problem:
      "A 'share my ink session' or 'record a demo' feature is the natural next request for a note-taking shell, and `MediaProjection` is the natural implementation. Every UPI and banking window is `FLAG_SECURE`; Android blanks those regions in any projection, so the user gets a black rectangle and assumes the app is broken or, worse, that it is hiding something. On several OEM builds starting a projection also forces the foreground app to re-layout into 'secure' mode, which is visible as a flicker or a forced re-authentication in the payment app underneath.",
    discovered:
      "Reasoning forward from the app's product trajectory (an inking shell that already renders a second surface over the web app) and backward from the brief's complaint. No projection code exists today.",
    why:
      "Capture is a whole-device capability with per-window carve-outs that are invisible to the capturer. You cannot detect in advance which window is secure, so any capture feature must be designed around 'we will get black rectangles in the places that matter most to the user' — and must say so in the UI rather than look like a bug.",
    fix:
      "Capture the ink surface only (`SurfaceView` → `PixelCopy`/own canvas), never the display. If display capture is unavoidable: request `MediaProjection` at the moment the user presses record (never at startup), show a persistent notification naming what is captured, call `MediaProjection.stop()` the instant the foreground package becomes sensitive (`UsageStatsManager`/window callback), and state plainly in the UI that protected windows record black. Never persist the projection token across a sensitive package becoming foreground.",
    confidence: "Inferred — verify at the call site",
    effort: "M",
  },
  {
    id: "WF-X06",
    title: "The 'cost' of the permission should be on screen before the settings intent fires, and the service should cost nothing when it has nothing to do",
    severity: "Medium",
    score: 5.0,
    area: "apps/android · permission UX + service cost",
    files: [
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/MainActivity.kt",
      "…/ink/accessibility/WeaveForgeAccessibilityService.kt  (proposed)",
    ],
    problem:
      "Two halves of the same robustness question. First, apps that request accessibility almost always jump straight to `Settings.ACTION_ACCESSIBILITY_SETTINGS` with a one-line toast, which is why users grant it to everything and then discover months later that something is wrong with their banking app. Second, a service that processes every event it is registered for costs battery and jank on every screen of the device — which is the 'brute force' outcome the brief explicitly rejects — even when the app it serves is not running.",
    discovered:
      "Read the brief's framing: 'we don't access screens for payment apps or such' and 'the best possible… efficiency and robustness, not just brute force'. Both halves point at the same design: the service should be provably cheap and provably scoped, and the user should know the scope before granting.",
    why:
      "A permission whose cost is invisible is a permission that gets granted carelessly and blamed later. And a service that runs at full rate over the whole device is exactly the thing that turns into a system-wide input and battery problem — the failure mode users describe as 'my phone got slow after I installed that app', which is the same complaint as the payment one wearing a different hat.",
    fix:
      "Before the settings intent, show a dialog that names, in plain language: which packages are read (the deny-list is visible to the user as a list, not as a policy), which are never read (payments, banking, messaging — with the count), what is never read (text, passwords, keystrokes), and how to turn it off again. Then: `notificationTimeout = 100`, a package early-return (WF-X03), no retained node references, and a hard idle path — if the served app has not been foreground for N minutes, `disableSelf()` (API 24+) or set an internal `enabled` flag so the callback returns on its first line. All work on a background `HandlerThread`; the callback body must never allocate a `String` or touch disk.",
    confidence: "Verified in source",
    effort: "M",
  },
  {
    id: "WF-X07",
    title: "Ship the diagnostic: a screen that tells the user which app is actually blocking their payments",
    severity: "Medium",
    score: 6.3,
    area: "apps/android · settings · new capability",
    files: ["apps/android/app/src/main/kotlin/org/weaveforge/ink/ (proposed: SensitiveCapabilityScreen)"],
    problem:
      "Android's 'Screen overlay detected' dialog deliberately does not name the offending package, so the user's only recourse is to disable things one at a time — and the app they blame is whichever one they installed most recently. The brief's complaint is very likely this exact confusion. There is no screen anywhere in this app that shows the device's own privileged-permission state, even though the app is the natural place for a stylus user to look.",
    discovered:
      "Asked what would have made the brief's symptom self-diagnosing. Everything needed is readable without any special permission: `Settings.Secure.getString(resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)`, `AppOpsManager.checkOpNoThrow(OP_SYSTEM_ALERT_WINDOW, …)` per package (or `Settings.canDrawOverlays` on API 23+), `DevicePolicyManager.getActiveAdmins()`, and `MediaProjectionManager`'s active-sessions via `MediaProjectionManager.getRunningTasks`… (the last needs `MEDIA_CONTENT_CONTROL`; use the notification channel instead).",
    why:
      "The robustness fix for 'a privileged app is interfering with payments' is not to write a more careful privileged app — it is to make the interference legible. Users do not have a mental model of `SYSTEM_WALL_OVERLAY` versus accessibility versus device admin, and the platform gives them no way to connect a symptom to a cause. A single screen that lists, per app, which of the three it holds, sorted with the offenders first, resolves the ticket that generated this whole brief.",
    fix:
      "One read-only screen in the settings area: 'What is drawing over your other apps'. Three rows — *Overlay windows*, *Accessibility services*, *Device administrators* — each listing the third-party packages holding it, with a deep link to the exact system settings page (`ACTION_MANAGE_OVERLAY_PERMISSION` with a package URI, `ACTION_ACCESSIBILITY_SETTINGS`, `ACTION_DEVICE_ADMIN_SETTINGS`) and a one-line explanation of the symptom each one causes ('some banking and UPI apps refuse their PIN pad while an overlay is present'). Ship it in the shell's own settings, and link to it from the permission rationale in WF-X06. Zero new permissions required.",
    confidence: "Inferred — verify at the call site",
    effort: "M",
  },
  {
    id: "WF-X08",
    title: "WebView hardening on a device that also does payments: origin policy, safe browsing, file access, and the bridge's blast radius",
    severity: "Medium",
    score: 5.9,
    area: "apps/android · MainActivity.kt + build.gradle.kts",
    files: [
      "apps/android/app/src/main/kotlin/org/weaveforge/ink/MainActivity.kt",
      "apps/android/app/build.gradle.kts",
    ],
    problem:
      "The shell is a browser with a native capability attached to it. Four settings are left at their permissive defaults in `onCreate`: `mediaPlaybackRequiresUserGesture = false` (any loaded page may start audio and video without a tap), no `WebViewClient` navigation policy at all (every origin loads in this WebView — see WF-N08), no `WebSettings.setSafeBrowsingEnabled(true)` explicitly, and file/content access not disabled (`setAllowFileAccess`, `setAllowContentAccess`, `setAllowFileAccessFromFileURLs`, `setAllowUniversalAccessFromFileURLs` all at their defaults). On a tablet where the user also banks, a shell that will load any origin with a JS bridge attached is a materially worse default than a browser, because a browser at least sandboxes by origin.",
    discovered:
      "Read the `with(webView.settings) { … }` block against the `WebSettings` hardening checklist. Everything present in the block is about the inking experience (zoom, storage, UA); nothing in it is about what the WebView is allowed to reach.",
    why:
      "A WebView is a browser minus the security UI: no padlock, no same-origin indicator, no safe-browsing interstitial unless you ask for one. That is fine for a first-party document. It is not fine once notes can contain a collaborator's link. These four are one line each and cost nothing in the inking path.",
    fix:
      "`mediaPlaybackRequiresUserGesture = true`; `settings.setSafeBrowsingEnabled(true)` (and handle `WebViewClient.onSafeBrowsingHit` with `SAFE_BROWSING_ACTION_BACK_TO_SAFETY`); `settings.setAllowFileAccess(false)`, `setAllowContentAccess(false)`, `setAllowFileAccessFromFileURLs(false)`, `setAllowUniversalAccessFromFileURLs(false)`; `settings.setGeolocationEnabled(false)`; and the origin allow-list from WF-N08 in `shouldOverrideUrlLoading` plus `shouldInterceptRequest` (so a sub-resource cannot reach an internal host). Pair with WF-N09's network security config so cleartext is scoped to the dev host only.",
    confidence: "Verified in source",
    effort: "S",
  },
];

/* ------------------------------------------------------------------ *
 * §1 — the remediation plan, traced
 * ------------------------------------------------------------------ */

export interface LedgerRow {
  phase: string;
  outcome: string;
  findings: string;
  status: "Landed" | "Partial" | "Deferred, on purpose";
}

export const PLAN_LEDGER: LedgerRow[] = [
  {
    phase: "Phase 0",
    outcome: "Green baseline and the five missing test homes (screen hook, facades, collab, screen loaders, pinned merge).",
    findings: "—",
    status: "Landed",
  },
  {
    phase: "Phase 1",
    outcome: "Correctness, data integrity and security: pinned reads, outbox guards, terminal status ordering, allowlist and generic route errors.",
    findings: "BUG-01, BUG-03, BUG-04, BUG-05…08, BUG-12…14, SEC-01…04",
    status: "Landed",
  },
  {
    phase: "Phase 2",
    outcome: "The lexical extractor rewritten as prepare → harvest → merge → rank → project; the double parse and the first-write-wins merge are gone.",
    findings: "WF-P03, WF-P04 (half), WF-P05, WF-P06, WF-C05",
    status: "Partial",
  },
  {
    phase: "Phase 3",
    outcome: "`0131_metric_activity_rpc.sql`: `latest_metric_activity`, `metric_history` (stride, not average), the missing `(experiment_id, wall_time desc)` index. Rollup scripts wired. Measured 5624 ms → 5 ms on the rollup.",
    findings: "WF-P01, WF-P02, WF-B02, WF-B03, WF-P09, PERF-01…08",
    status: "Landed",
  },
  {
    phase: "Phase 4",
    outcome: "Contracts and types: required projections, one screen registry, metric port split, cache policy in one module.",
    findings: "ARCH-02, ARCH-04, ARCH-12, ARCH-13, ARCH-15, WF-C04",
    status: "Landed",
  },
  {
    phase: "Phase 5",
    outcome: "Lifecycle and memory: disposable registrations, `dispose()` on the container, the realtime channel released, one IndexedDB connection with `onversionchange`.",
    findings: "MEM-01, MEM-02, MEM-03, MEM-05, MEM-06, BUG-10, BUG-11",
    status: "Landed",
  },
  {
    phase: "Phase 6",
    outcome: "Structural splits: three facades out of one, four modules out of `WorkspaceSearch`, one auth flow, one push rule, one pinned-screen preamble, the narrow `IPaperIdentityLookup` port.",
    findings: "ARCH-01, ARCH-03, ARCH-06…11, PERF-04",
    status: "Landed",
  },
  {
    phase: "Phase 7",
    outcome: "Guardrails: `check:solid` facade ceilings, `check:dry` `select(\"*\")` ratchet (27 sites remain, counted), `check:ci-parity`, bundle budget, pinned-address agent, per-user token bucket.",
    findings: "SEC-05, SEC-06, BUG-18, BUG-02, WF-B09",
    status: "Landed",
  },
  {
    phase: "Phase 8",
    outcome: "Recorded decisions and deferrals: `signedImageUrls` deleted, the facade dep-count gate moved to Phase 7, `PERF-04`'s narrow port shipped in Phase 6 instead.",
    findings: "ARCH-05, ARCH-14, WF-P07 (budget only), WF-P08 (refuted)",
    status: "Deferred, on purpose",
  },
];

/* ------------------------------------------------------------------ *
 * Appendix B — the permission matrix
 * ------------------------------------------------------------------ */

export interface MatrixRow {
  capability: string;
  used: string;
  blastRadius: string;
  rule: string;
}

export const PERMISSION_MATRIX: MatrixRow[] = [
  {
    capability: "AccessibilityService",
    used: "NOT USED",
    blastRadius: "Every application on the device",
    rule: "Never added. If it is: deny-list first statement of the callback, no key filtering, no interactive windows, `canRetrieveWindowContent=false`, recycle every node.",
  },
  {
    capability: "DevicePolicyManager / admin",
    used: "NOT USED",
    blastRadius: "Whole device: password, camera, storage, wipe",
    rule: "Never added. Never `wipeData`, never `resetPassword`, never `lockNow` while a payment or banking package has focus.",
  },
  {
    capability: "TYPE_APPLICATION_OVERLAY window",
    used: "NOT USED",
    blastRadius: "Input and rendering of whatever is underneath",
    rule: "Never added. The ink surface stays inside this activity's window (WF-X02). An overlay, if ever required, must be `FLAG_NOT_TOUCHABLE` and removed in `onPause`.",
  },
  {
    capability: "MediaProjection / screen capture",
    used: "NOT USED",
    blastRadius: "Every non-`FLAG_SECURE` window",
    rule: "Capture the ink surface only. `FLAG_SECURE` windows record black; say so rather than look broken.",
  },
  {
    capability: "JavascriptInterface (`AndroidInkingBridge`)",
    used: "YES — 5 methods, primitives only",
    blastRadius: "Every origin that loads in this WebView",
    rule: "Origin allow-list + install/remove around navigation (WF-N08). Never grow it to touch storage without the same gate.",
  },
  {
    capability: "In-app `SurfaceView` (`InkingOverlayView`)",
    used: "YES — `activity_main.xml`, own window",
    blastRadius: "This activity only",
    rule: "Consumes stylus and, in five tiers, touch — but only inside its own window. Safe. The moment it becomes a system overlay it is not (WF-X02).",
  },
  {
    capability: "Cleartext network",
    used: "Build-time, `manifestPlaceholders[\"cleartext\"]`",
    blastRadius: "All HTTP to any host in that build",
    rule: "Replace the global flag with a scoped `network_security_config` naming the dev host (WF-N09).",
  },
];

export const SENSITIVE_PACKAGES = [
  ["com.google.android.apps.nbu.paisa.user", "Google Pay (India)"],
  ["com.phonepe.app", "PhonePe"],
  ["net.one97.paytm", "Paytm"],
  ["in.org.npci.upiapp", "BHIM"],
  ["com.dreamplug.android", "CRED"],
  ["com.sbi.upi", "SBI YONO / UPI"],
  ["com.csam.icici.bank.imobile", "iMobile by ICICI"],
  ["com.icom.imobile", "iMobile (alt id)"],
  ["com.axis.mobile", "Axis Mobile"],
  ["com.konylabs.HDFCBank", "HDFC MobileBanking"],
  ["com.snapwork.hdfc", "HDFC (legacy)"],
  ["com.whatsapp", "WhatsApp (payments)"],
  ["com.instagram.android", "Instagram"],
  ["com.android.vending", "Play Store (payment sheet)"],
  ["com.google.android.gms", "Google Play services (wallet)"],
  ["in.gov.*", "Government / NPCI services"],
];

/* ------------------------------------------------------------------ *
 * Appendix C — verification protocol (from the remediation plan §4)
 * ------------------------------------------------------------------ */

export const VERIFICATION = [
  "npm run build:core          # packages/core must compile before apps/web typechecks",
  "npm run typecheck           # all workspaces",
  "npm run lint               # react-hooks/exhaustive-deps is an error",
  "npm run test:core           # 1214 tests, 0 failures, ~62 s at baseline",
  "npm run test:web            # node --import tsx --test \"src/**/*.test.ts(x)\"",
  "npm run test:integration:web  # pglite: applies every supabase/migrations file",
  "npm run check:boundaries    # solid, dry, api-route-tests, ui, hygiene, mcp-plugin, docs",
  "cd python && ruff check weaveforge tests && mypy && pytest -q",
  "npm run check:all           # adds test:desktop and a real next build",
];

export const GUARDRAILS: { gate: string; where: string; catches: string }[] = [
  {
    gate: "check:android-permissions",
    where: "scripts/ + apps/android",
    catches: "WF-X01, WF-X02 — any accessibility, device-admin, overlay, projection or boot receiver creeping into the shell.",
  },
  {
    gate: "no-floating-promises + require-await",
    where: "apps/web · ESLint",
    catches: "WF-N05 — the `void idbSetScreenCache(…)` fire-and-forget behind the screen cache.",
  },
  {
    gate: "Contract test: every screen use-case merges pins before building its view model",
    where: "packages/core + apps/web tests",
    catches: "BUG-01's class — a `tree` built from the wrong list silently drops pinned notes.",
  },
  {
    gate: "Table test for `isPublicAddress` with non-canonical IPv4 forms",
    where: "packages/core tests",
    catches: "SEC-01 — `010.0.0.1`, `1.2.3.04`, `2130706433`, `0x7f.0.0.1`, `[::ffff:127.0.0.1]`.",
  },
  {
    gate: "check:dry — `select(\"*\")` ratchet",
    where: "scripts/check-dry.mjs",
    catches: "PERF-04's class. 27 sites across 16 adapters remain and may not rise.",
  },
  {
    gate: "check:solid — facade members and constructor deps",
    where: "scripts/check-solid.mjs",
    catches: "ARCH-03 — measured with the TypeScript parser; a ratchet that may only come down.",
  },
  {
    gate: "Bundle + screen-payload budget",
    where: "apps/web · after `next build`",
    catches: "WF-N16, WF-P07. `/papers` 483 KB, `/report` 475 KB, `/notes` 467 KB lead; `markdown.tsx`'s static `katex` is the first thing to move.",
  },
  {
    gate: "Extraction golden file",
    where: "packages/core/test/features/ai-assistant",
    catches: "WF-N06, WF-N07 — evidence offsets and the locale-dependent tie-break, both of which are invisible in a unit assertion.",
  },
];
// CRITICAL BUGS
  {
    id: 'BUG-01',
    category: 'bug',
    severity: 'critical',
    title: 'Vault screen tree build deletes pinned/shared notes',
    problem: 'Building pageTree from merged.items instead of owned items deletes every pinned/shared note from the vault screen. The tree is load-bearing: the screen derives ownedIds from it, so building it from merged items makes pinnedPages empty AND removes pinned ids from ownedNotes.',
    howDiscovered: 'Line-by-line code audit of vault-screen.tsx and the tree building logic in manage-vault-page.use-case.ts',
    why: 'The audit proposed tree: buildPageTree(merged.items) which would include shared/pinned items in the tree structure. However, the vault screen uses the tree to compute ownedIds - items that belong to the current user. Including shared items causes the screen to think pinned items are owned, then filters them out incorrectly.',
    fix: 'Keep the tree building on owned items only. The correct fix preserves the existing tree construction from owned pages and handles merged/pinned items separately for display. Do NOT change tree to use merged.items.',
    codeLocation: 'apps/web/src/features/vault/application/manage-vault-page.use-case.ts',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-02',
    category: 'bug',
    severity: 'high',
    title: 'useScreenData refetch on every render (refuted)',
    problem: 'Audit claimed useScreenData refetches on every render because load is an inline closure.',
    howDiscovered: 'Audit claimed inline closures in load parameter cause re-renders.',
    why: 'REFUTED. All ten call sites pass a useCallback wrapper. No site re-loads per render. The ref-stabilisation is still worth landing as hardening but the bug as described does not exist.',
    fix: 'Already fixed: the effect depends on [cacheKey, screen] and reads loadRef.current(), so an inline closure no longer re-issues the load. This was landed in Phase 1.',
    codeLocation: 'apps/web/src/lib/hooks/use-screen-data.ts',
    status: 'refuted',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-03',
    category: 'bug',
    severity: 'critical',
    title: 'Single shared seq counter disables IndexedDB restore',
    problem: 'Using a single shared seq counter for both the IDB restore and the network reload permanently disables IndexedDB restore. The reload effect bumps the same counter before the IDB promise can settle.',
    howDiscovered: 'Code audit of use-screen-data.ts sequencing logic - the two counters (requestSeq and completedLoads) serve different purposes but audit proposed merging them.',
    why: 'requestSeq tracks which network request is newest (for race conditions on project switches). completedLoads tracks how many loads have completed (for determining if an IDB restore is stale). A single counter cannot serve both purposes because the reload effect runs after the restore effect.',
    fix: 'Keep TWO separate counters as currently implemented. requestSeq for network race resolution, completedLoads for IDB staleness detection. Do NOT merge into one counter.',
    codeLocation: 'apps/web/src/lib/hooks/use-screen-data.ts',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-04',
    category: 'bug',
    severity: 'high',
    title: 'Overlapping reloads can clobber newer data',
    problem: 'Two overlapping reloads could result in an older response overwriting a newer one if timing is unfortunate.',
    howDiscovered: 'Audit identified race condition in useScreenData reload sequencing.',
    why: 'Without proper sequencing, if reload A starts, then reload B starts and completes first, then reload A completes, A could overwrite B fresher data.',
    fix: 'The requestSeq counter handles this: each reload captures its sequence number, and only writes if seq === requestSeq.current. This ensures only the newest request answer is written.',
    codeLocation: 'apps/web/src/lib/hooks/use-screen-data.ts',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-05',
    category: 'bug',
    severity: 'high',
    title: 'Papers repository repeated project filter lookups',
    problem: 'Multiple code paths in the papers repository performed redundant project filter lookups, creating O(n squared) behavior on project-scoped queries.',
    howDiscovered: 'Phase 3 code audit of papers repository cluster - identified repeated calls to scoped() with identical parameters.',
    why: 'Each read operation was independently resolving the project filter rather than reusing a pre-built index. With many papers, this compounds into significant overhead.',
    fix: 'Extract the project filter into one helper that every read goes through. Build the filter index once per operation rather than per item.',
    codeLocation: 'apps/web/src/features/papers/infrastructure/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'BUG-06',
    category: 'bug',
    severity: 'medium',
    title: 'Chunk reads not issued in deterministic order',
    problem: 'When reading multiple chunks from storage, the order was non-deterministic, causing inconsistent results on retries.',
    howDiscovered: 'Phase 3 audit of storage read patterns.',
    why: 'Non-deterministic ordering makes debugging harder and can cause race conditions in concurrent read scenarios.',
    fix: 'Issue chunk reads together with a deterministic order (sorted by chunk id or creation time).',
    codeLocation: 'apps/web/src/features/storage/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'BUG-07',
    category: 'bug',
    severity: 'medium',
    title: 'Duplicate dedupe copies in papers repository',
    problem: 'Four separate deduplication copies existed across different code paths in the papers repository.',
    howDiscovered: 'Phase 3 audit identified repeated dedupe logic.',
    why: 'Each code path implemented its own deduplication rather than using a shared helper, leading to code duplication and potential inconsistencies.',
    fix: 'Collapse four dedupe copies into one shared helper function used by all read paths.',
    codeLocation: 'apps/web/src/features/papers/infrastructure/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'BUG-08',
    category: 'bug',
    severity: 'medium',
    title: 'listSummaries typed as full Paper instead of summary',
    problem: 'listSummaries was typed to return full Paper objects but actually returned summary projections, causing type mismatches.',
    howDiscovered: 'Phase 3 audit of papers repository return types.',
    why: 'The type claimed to return abstract, bibtex, metadata etc. but the query only fetched summary fields. This caused card write-backs to drop fields they thought existed.',
    fix: 'Type listSummaries as the summary projection it actually fetches (PaperSummary), not Paper. Required card projections are now explicit on the port.',
    codeLocation: 'apps/web/src/features/papers/application/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'BUG-09',
    category: 'bug',
    severity: 'high',
    title: 'Zotero push drops live argument',
    problem: 'A shared pushWith(client, paperId) that filters to local annotations drops the live: true third argument, turning the live Zotero write into a silent dry run.',
    howDiscovered: 'Phase 1 audit of Zotero integration code.',
    why: 'The live: true parameter tells Zotero to keep the annotation in sync. Without it, changes are written once and not kept live, defeating the purpose of the integration.',
    fix: 'Preserve the live: true argument in all Zotero write operations. Do NOT filter it out in shared helper functions.',
    codeLocation: 'apps/web/src/features/integrations/zotero/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-10',
    category: 'bug',
    severity: 'high',
    title: 'Realtime channel not released on dispose',
    problem: 'ProjectLwwInvalidator.dispose() did not release the realtime channel, causing memory leaks and stale subscriptions.',
    howDiscovered: 'Phase 5 audit of container teardown and resource cleanup.',
    why: 'Without releasing the channel, the subscription remains active even after the component is unmounted, leading to memory leaks and potential state updates on unmounted components.',
    fix: 'ProjectLwwInvalidator.dispose() now leaves the channel. The session reset calls it, and so does container teardown.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'BUG-11',
    category: 'bug',
    severity: 'medium',
    title: 'Reset register called before workspace setup',
    problem: 'The reset register was called before workspace setup, making the TDZ (temporal dead zone) unreachable but still requiring cleanup.',
    howDiscovered: 'Phase 5 audit of session reset ordering.',
    why: 'Registering the reset hook before the workspace is available means the hook runs against an uninitialized state, even if the effect is unreachable.',
    fix: 'Move the reset register below workspace setup. The TDZ was unreachable but free to remove.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'BUG-12',
    category: 'bug',
    severity: 'high',
    title: 'Offline outbox pump not running in production',
    problem: 'SyncEngine.cycle() is called only from tests. Production runs exactly one pass inside enable(), with an access token frozen at that moment.',
    howDiscovered: 'Phase 1 audit of offline sync implementation.',
    why: 'Without a running pump, pending offline operations are never processed after the initial sync. This makes BUG-12/BUG-13 severity higher than expected.',
    fix: 'Wire the pump to run continuously in production, not just on enable(). This is a prerequisite for fixing BUG-12/BUG-13 properly.',
    codeLocation: 'apps/web/src/features/offline-sync/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-13',
    category: 'bug',
    severity: 'high',
    title: 'Token frozen at enable() time',
    problem: 'The access token used for offline sync is frozen at enable() time, meaning token refreshes are not picked up.',
    howDiscovered: 'Phase 1 audit of offline sync token handling.',
    why: 'When the token expires or is refreshed, the sync engine continues using the old token, causing authentication failures.',
    fix: 'The pump must fetch fresh tokens on each cycle, not use a token captured at enable() time.',
    codeLocation: 'apps/web/src/features/offline-sync/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-14',
    category: 'bug',
    severity: 'high',
    title: 'Experiment run can be stranded as running',
    problem: 'Failed flush on success path left experiment marked as running forever.',
    howDiscovered: 'Python SDK audit - tracking.py _finalise function.',
    why: 'The original code wrote status before attempting flush. If flush failed, the status was already written and could not be corrected.',
    fix: 'Status is now written LAST, under a guard. Steps that can fail run first. The terminal status write cannot be skipped.',
    codeLocation: 'python/weaveforge/tracking.py',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-15',
    category: 'bug',
    severity: 'critical',
    title: 'Mirror finished before flush completes',
    problem: 'Stamping terminal status first would finish the mirrored run, then attach artifacts to an experiment the mirror had already closed.',
    howDiscovered: 'Python SDK audit of Run.set_status and mirror handling.',
    why: 'Run.set_status calls mirror.finish(status) and nulls the field. Every finalisation fix must respect that ordering or it trades a stuck row for a lying remote run.',
    fix: 'Flush artifacts first, then call set_status which finishes the mirror. Never reverse this order.',
    codeLocation: 'python/weaveforge/features/experiments/application/run.py',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-16',
    category: 'bug',
    severity: 'high',
    title: 'Finalise re-raises exception contradicting docstring',
    problem: 'RunFinaliser.succeeded ending with except Exception: self.failed(); raise contradicts its own never raises docstring.',
    howDiscovered: 'Python SDK audit of finalise.py.',
    why: 'Re-raising the flush failure out of with track(...) shifts warnings.warn attribution by one frame and contradicts the documented behavior.',
    fix: 'On success path, re-raise after status written (caller can do something about it). On failure path, warn and swallow (do not replace caller exception).',
    codeLocation: 'python/weaveforge/tracking.py',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-17',
    category: 'bug',
    severity: 'medium',
    title: '@track_experiment positional parameter issue (refuted)',
    problem: 'Audit claimed decorator cannot inject run into positional parameter, so README train(run, beta=4.0) fails.',
    howDiscovered: 'Audit reviewed Python decorator implementation.',
    why: 'REFUTED by execution. run is positional-or-keyword, so kwargs.setdefault fills it. The README shape works. Real failure modes are positional-only parameters and a caller filling the run slot positionally.',
    fix: 'No fix needed for the claimed issue. Document the actual failure modes: positional-only parameters and callers passing run positionally.',
    codeLocation: 'python/weaveforge/tracking.py',
    status: 'refuted',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-18',
    category: 'bug',
    severity: 'high',
    title: 'Failed index build sets ready flag',
    problem: 'A failed index build set ready in a .finally block, so every caller took the ranked path, got an empty result set, and lost substring fallback.',
    howDiscovered: 'Search index audit - builds that fail still marked index as ready.',
    why: 'The .finally block ran regardless of success/failure, setting ready=true even when the index build threw an exception. Callers then used the ranked search path and got no results.',
    fix: 'Flip ready only on success, not in finally. The hook takes an injected container and schedules with globalThis.',
    codeLocation: 'apps/web/src/lib/search/',
    status: 'confirmed',
    phase: 'Phase 7'
  },
  {
    id: 'BUG-19',
    category: 'bug',
    severity: 'medium',
    title: 'Conflict detection uses literal serverVersion 0',
    problem: 'conflict() persists a literal serverVersion: 0, which produces unmatched row_version guard when baseVersion is null.',
    howDiscovered: 'Audit of conflict resolution logic.',
    why: 'Treating null baseVersion as unguarded misses the reachable path where serverVersion is explicitly set to 0, creating a guard that never matches.',
    fix: 'Handle null baseVersion explicitly - do not treat it as unguarded. The conflict path persists serverVersion: 0 intentionally for this case.',
    codeLocation: 'apps/web/src/features/vault/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'BUG-20',
    category: 'bug',
    severity: 'high',
    title: 'Stale refresh clears before awaiting snapshot',
    problem: 'refreshStale cleared the staleness set BEFORE awaiting the snapshot, so a read that rejected lost the kinds for good.',
    howDiscovered: 'Phase 6 audit of search index refresh logic.',
    why: 'Clearing staleness before the snapshot completes means if the snapshot read rejects (e.g., network error), the kind is no longer marked stale and no later ensure() looks again.',
    fix: 'Clear staleness LAST, after the snapshot completes successfully. Per kind, not all at once.',
    codeLocation: 'apps/web/src/features/search/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'BUG-21',
    category: 'bug',
    severity: 'critical',
    title: 'Reconciliation can rewrite colleague run status',
    problem: 'Reconciliation runs over the merged list which includes other users shared runs, so opening the screen can rewrite a colleague run status.',
    howDiscovered: 'Phase 3 audit of experiments facade reconciliation logic.',
    why: 'The reconciliation logic did not filter to owned runs only. When loading the experiments screen, it would check all runs including shared ones and potentially update their status.',
    fix: 'Filter reconciliation to owned runs only. A missing map entry makes isStaleRunningExperiment fall back to startedAt, and the facade persists status = abandoned. Two-minute threshold.',
    codeLocation: 'apps/web/src/features/experiments/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'BUG-22',
    category: 'bug',
    severity: 'high',
    title: 'Container has no teardown path',
    problem: 'bootstrap rebuilt the container on every provider change and dropped the reference, so accumulated repository registrations, session hooks, and joined private channel all survived.',
    howDiscovered: 'Phase 5 audit of container lifecycle.',
    why: 'Without teardown, memory grows unbounded and invalidation walks dead entries. The session hook and realtime channel accumulate on each rebuild.',
    fix: 'createAppContainer returns dispose(). bootstrap calls it when replacing a container - after the new one is built, so a bad config cannot tear the app down.',
    codeLocation: 'apps/web/src/bootstrap.ts',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'BUG-23',
    category: 'bug',
    severity: 'medium',
    title: 'Session hooks accumulate on rebuild',
    problem: 'registerSessionReset returned void, so a rebuild left a generation whose hook ran on every later sign-out.',
    howDiscovered: 'Phase 5 audit of session reset registration.',
    why: 'Without a disposer return, the container could not clean up old hooks. Each rebuild added a new hook that ran on every subsequent sign-out.',
    fix: 'registerSessionReset returns a disposer, and the container holds it. A rebuild no longer leaves accumulating hooks.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'BUG-24',
    category: 'bug',
    severity: 'high',
    title: 'IndexedDB connection not memoized with stale handling',
    problem: 'Memoising openAppDb without onversionchange/onclose handlers hands out a dead handle that every caller swallows.',
    howDiscovered: 'Phase 5 audit of IndexedDB connection management.',
    why: 'After another tab upgrades the database version, the memoised handle becomes stale. Without handlers to detect this, every caller gets an error they swallow.',
    fix: 'Memoised with onversionchange/onclose handlers. Without them a memoised handle goes stale after another tab upgrades. Closed at the END of the device wipe, not before.',
    codeLocation: 'apps/web/src/lib/db/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'BUG-25',
    category: 'bug',
    severity: 'medium',
    title: 'Semantic corpus retained causing staleness',
    problem: 'Clearing this.docs when semantic search is off referenced non-existent EMPTY_DOCS and broke re-enabling.',
    howDiscovered: 'Phase 5 audit of semantic search document management.',
    why: 'The retained copy meant a note added after the build could never be found semantically. Also nobody calls setSemanticIndex when the arm is off, so the clearing never happened.',
    fix: 'Projected on demand instead of retained. This fixes both the staleness (notes added after build are found) and the re-enable issue (audit own patch would have broken it).',
    codeLocation: 'apps/web/src/features/search/',
    status: 'confirmed',
    phase: 'Phase 5'
  },

  // OPTIMIZATIONS
  {
    id: 'PERF-01',
    category: 'optimization',
    severity: 'medium',
    title: 'Regex with captured path fails existing test',
    problem: 'One regex with a captured path, tested inside the replacer, fails an existing test. The capture group stops at ), and the suite feeds a+b(1).png.',
    howDiscovered: 'Phase 3 audit of image URL processing regex.',
    why: 'The regex capture group was too greedy and stopped at the first ) rather than matching balanced parentheses. The test case a+b(1).png exposed this.',
    fix: 'Use a non-greedy match or explicit character class that does not stop at ). Test against the actual file naming patterns used.',
    codeLocation: 'apps/web/src/lib/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-02',
    category: 'optimization',
    severity: 'medium',
    title: 'O(pins x shares) scan in pin loop',
    problem: 'Keeping input.shares.some(...) inside the pin loop does not remove the O(pins x shares) scan it set out to remove.',
    howDiscovered: 'Phase 3 audit of pin/share processing.',
    why: 'A naive one-pass index would silently drop blanket (project-wide) share grants, which the first loop deliberately skips. The audit fix did not address the fundamental complexity.',
    fix: 'Build a share-grant index first (one pass), then use it for lookups. Handle blanket grants explicitly to not drop them.',
    codeLocation: 'apps/web/src/features/library/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-03',
    category: 'optimization',
    severity: 'high',
    title: 'computeRollup quadratic scan',
    problem: 'computeRollup had O(n squared) behavior building rows. On a 400-row table with 20,000 field values and three rollup columns, building took 5624ms.',
    howDiscovered: 'Phase 3 audit with actual measurement on real data.',
    why: 'Every row was compared against every other row for rollup computation. With 20k field values, this became 30 million map inserts.',
    fix: 'Build a value index per table (one pass), then look up values in O(1). Measured: 5624ms to 5ms on the same data. Guard is a 1500ms budget.',
    codeLocation: 'apps/web/src/features/experiments/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-04',
    category: 'optimization',
    severity: 'medium',
    title: 'select(*) projections in adapters',
    problem: '45 select(*) sites across 17 adapters were fetching all columns when only a few were needed.',
    howDiscovered: 'Phase 4 check:dry lint rule found starred projections.',
    why: 'Fetching all columns when only identity/status needed wastes bandwidth and memory. However, narrowing the port is a breaking change to @weaveforge/core.',
    fix: 'Eighteen fixed; twenty-seven remain as counted ratchet. New ones forbidden. The narrow identity port (IPaperIdentityLookup) added for citation linker.',
    codeLocation: 'apps/web/src/features/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'PERF-05',
    category: 'optimization',
    severity: 'low',
    title: 'Scope read and token resolution separate',
    problem: 'Scope read and token resolution are separate RPC calls, doubling latency for auth-checked operations.',
    howDiscovered: 'Phase 3 audit of auth flow.',
    why: 'The token RPC returns a uuid and the JWT is HMAC-signed in Node with an app-only secret. Folding into one call is not implementable without changing the auth architecture.',
    fix: 'Not implementable as proposed. The two-halves check exists so one edit cannot weaken both. Keep separate.',
    codeLocation: 'apps/web/src/',
    status: 'deferred',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-06',
    category: 'optimization',
    severity: 'medium',
    title: 'Bounded decode for extractPageTitle',
    problem: 'Decoding 64KB and stopping at end changed behavior - titles between 64KB and 200KB would be lost.',
    howDiscovered: 'Phase 3 audit of page title extraction.',
    why: 'extractPageTitle already clamps at 200,000 chars. A title between 64KB and 200KB would be lost with the proposed change. Also readCapped refuses over-cap bodies rather than truncating.',
    fix: 'Keep the 200KB clamp. Do not change to 64KB. The premise was wrong - readCapped refuses, not truncates.',
    codeLocation: 'apps/web/src/lib/',
    status: 'refuted',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-07',
    category: 'optimization',
    severity: 'medium',
    title: 'Canvas round trip for small images',
    problem: 'Drawing small images to canvas and back added unnecessary processing for files already small and in the right format.',
    howDiscovered: 'Phase 3 audit of image processing pipeline.',
    why: 'For files that are already small and already in a format we would have produced, the canvas round trip adds latency without benefit.',
    fix: 'Skip canvas processing for files that meet size and format criteria. Only process when actually needed.',
    codeLocation: 'apps/web/src/features/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-08',
    category: 'optimization',
    severity: 'medium',
    title: 'One service-role client per config',
    problem: 'Creating a new Supabase client for each operation instead of reusing a configured client.',
    howDiscovered: 'Phase 3 audit of database client usage.',
    why: 'Each new client incurs connection setup overhead. A single service-role client per config can be reused across operations.',
    fix: 'Create one service-role client per configuration and reuse it. Do not create new clients for each query.',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-09',
    category: 'optimization',
    severity: 'low',
    title: 'listStamps() since parameter (refuted)',
    problem: 'Audit proposed listStamps() should take a since parameter and push predicate down.',
    howDiscovered: 'Audit reviewed stamp listing API.',
    why: 'REFUTED. The protocol rejects changed since T precisely because deletions are invisible. The caller needs the complete stamp set to compute drop. A gt updated_at would also silently drop rows whose updated_at is null.',
    fix: 'No change needed. The current API is correct for the use case.',
    codeLocation: 'packages/core/src/',
    status: 'refuted',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-10',
    category: 'optimization',
    severity: 'medium',
    title: 'Metric chunking not scheduled',
    problem: 'experiment_metrics is a view over chunks, but nothing schedules the rollup that creates chunks.',
    howDiscovered: 'Phase 3 audit of metric storage.',
    why: 'WF-P09 real gap: chunks are an archive written by a batch rollup, but nothing runs that rollup. The view works but grows unbounded without the rollup.',
    fix: 'Two npm scripts and docs/running/metrics-maintenance.md with a suggested cron. Not running it costs space rather than data.',
    codeLocation: 'supabase/migrations/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-11',
    category: 'optimization',
    severity: 'medium',
    title: 'Local PostgREST client range() not implemented',
    problem: 'Local PostgREST client did not implement .range() at all, so any paged read threw range is not a function on local backend only.',
    howDiscovered: 'Phase 3 work found this while implementing other fixes.',
    why: 'Paging is how a caller reads a table larger than one response. The client exists to speak the same protocol the browser repositories speak.',
    fix: 'Implement .range() on the local client. Also fixed array binding to function arguments sent as JSON (caused malformed array literal errors).',
    codeLocation: 'apps/web/src/backend/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'PERF-12',
    category: 'optimization',
    severity: 'high',
    title: 'PapersFacade reaching 39 members with no limit',
    problem: 'PapersFacade had 39 public members (35 methods + 4 getters) and 16 constructor deps with nothing to stop growth.',
    howDiscovered: 'Phase 7 audit of facade size.',
    why: 'Without a size ceiling, facades grow unboundedly. Each new method adds to the surface area and makes the facade harder to test and maintain.',
    fix: 'check:solid measures each facade members and constructor dependencies with the TypeScript parser. Fails past a per-file limit. PapersFacade split into PapersFacade, PaperFieldsFacade, ZoteroFacade.',
    codeLocation: 'apps/web/src/features/papers/',
    status: 'confirmed',
    phase: 'Phase 7'
  },
  {
    id: 'PERF-13',
    category: 'optimization',
    severity: 'medium',
    title: '86 inline core type imports across 34 files',
    problem: 'ARCH-04 found 86 occurrences of inline import("@weaveforge/core").X pattern across 34 tracked files, max 10 in one file.',
    howDiscovered: 'Phase 4 boundary lint.',
    why: 'Inline lazy imports of core types add complexity and can cause issues with static analysis. The pattern is import("@weaveforge/core").X used as a type.',
    fix: '95 across 40 files hoisted to top-level import type. A check-dry rule keeps them out. Both boundary gates now search container/',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'PERF-14',
    category: 'optimization',
    severity: 'medium',
    title: 'Bundle budget exceeded on list screens',
    problem: '/papers is 483 KB, /report 475 KB, /notes 467 KB first-load JS. Lead: components/markdown/markdown.tsx statically imports katex and is loaded by four route modules.',
    howDiscovered: 'Phase 7 bundle budget check.',
    why: 'Large first-load bundles slow initial page load. The markdown component with katex is loaded on routes that may not need it.',
    fix: 'check-bundle-budget.mjs measures every route first-load JS and fails past a per-route ratchet. Dynamic import katex where needed.',
    codeLocation: 'apps/web/src/components/markdown/',
    status: 'confirmed',
    phase: 'Phase 7'
  },
  {
    id: 'PERF-15',
    category: 'optimization',
    severity: 'medium',
    title: 'Feature UI statically imported (refuted)',
    problem: 'Audit claimed feature UI is statically imported into shared layout/registry, landing graph/PDF/chart/Yjs libraries in first-load JS.',
    howDiscovered: 'Audit reviewed module loading patterns.',
    why: 'REFUTED. The registry imports feature descriptors, not UI. Routes statically import exactly one screen each. Force-graph is next/dynamic, pdf.js and Yjs are dynamically imported, uPlot is void import("uplot").',
    fix: 'No fix needed. The half of WF-P07 the audit could not confirm is correct - heavy libraries are already behind dynamic imports.',
    codeLocation: 'apps/web/src/',
    status: 'refuted',
    phase: 'Phase 7'
  },

  // SECURITY
  {
    id: 'SEC-01',
    category: 'security',
    severity: 'medium',
    title: '010.127.0.1 SSRF bypass claim (refuted)',
    problem: 'Audit claimed 010.127.0.1 passes the guard as public while the stack dials loopback.',
    howDiscovered: 'Audit reviewed URL guard logic.',
    why: 'REFUTED by measurement. new URL() canonicalises every non-canonical IPv4 form (octal, hex, integer) before the guard sees it. undici parser agrees, so guard and socket always see the same address.',
    fix: 'Keep the hardening; drop the impact claim. The tests asserted something false and were fixed.',
    codeLocation: 'apps/web/src/backend/',
    status: 'refuted',
    phase: 'Phase 1'
  },
  {
    id: 'SEC-02',
    category: 'security',
    severity: 'medium',
    title: 'Fetch URL allowlist too permissive',
    problem: 'Allowlist included ports 3000 and 5000 which could be used for internal service access.',
    howDiscovered: 'Phase 7 audit of fetch URL security.',
    why: 'Internal ports should not be accessible through the fetch proxy. The allowlist had already been trimmed in Phase 1.',
    fix: 'Allowlist trimmed: no 3000, no 5000. docs/SECURITY.md now says what the policy is and where an operator extends it.',
    codeLocation: 'apps/web/src/backend/',
    status: 'confirmed',
    phase: 'Phase 7'
  },
  {
    id: 'SEC-03',
    category: 'security',
    severity: 'medium',
    title: 'Generic error body breaks convention',
    problem: 'Returning a generic body plus crypto.randomUUID() correlation id breaks the repo stated convention.',
    howDiscovered: 'Phase 1 audit of error response formatting.',
    why: 'formatErrorForResponse is documented as the one way a route writes { error }. Erasing the deliberate 503-vs-500 signal loses important debugging information.',
    fix: 'Keep formatErrorForResponse as the single way to write error responses. Do not return generic bodies.',
    codeLocation: 'apps/web/src/backend/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'SEC-04',
    category: 'security',
    severity: 'low',
    title: 'Pass [] instead of undefined to allowedTools (no-op)',
    problem: 'Passing [] instead of undefined to allowedTools is a no-op because [].length is falsy.',
    howDiscovered: 'Phase 1 audit of MCP tool filtering.',
    why: 'The facade still falls back to the full tool list because an empty array is falsy. Only the facade change matters.',
    fix: 'No change needed for this specific fix. The facade change is what matters.',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'SEC-05',
    category: 'security',
    severity: 'high',
    title: 'Connect not pinned to vetted IP',
    problem: 'Outgoing connections were not pinned to vetted IPs, allowing DNS rebinding attacks.',
    howDiscovered: 'Phase 7 audit of outbound connection security.',
    why: 'Without pinning, an attacker could redirect connections to internal services through DNS manipulation.',
    fix: 'pinnedRequest dials the vetted IP while presenting the hostname as TLS SNI, as the Host header and as the certificate name. Supplies a lookup returning the same address. Redirect hops resolve, check and pin again.',
    codeLocation: 'apps/web/src/backend/',
    status: 'confirmed',
    phase: 'Phase 7'
  },
  {
    id: 'SEC-06',
    category: 'security',
    severity: 'high',
    title: 'No rate limiting on fetch-url endpoint',
    problem: 'The /api/fetch-url?as=image endpoint had no rate limiting, allowing amplification attacks.',
    howDiscovered: 'Phase 7 audit of API endpoint security.',
    why: 'Without rate limiting, an attacker could use the server to fetch arbitrary URLs at high volume, using server bandwidth for attacks.',
    fix: 'Per-user token bucket: twenty in a burst, one refilled every two seconds. Per process (suffices for single deployment). Streaming variant stays undone - it removes server-side copy but not client.',
    codeLocation: 'apps/web/src/app/api/fetch-url/',
    status: 'confirmed',
    phase: 'Phase 7'
  },

  // ACCESSIBILITY
  {
    id: 'ACC-01',
    category: 'accessibility',
    severity: 'high',
    title: 'Accessibility permission blocks payment apps',
    problem: 'When users grant accessibility or device admin permissions to the app, they cannot use payment apps anymore.',
    howDiscovered: 'User report and Android accessibility service documentation.',
    why: 'Android accessibility service and device admin APIs have high privilege levels. When an app holds these, Android security model restricts other apps from receiving certain input events or accessing secure windows (like payment dialogs). This is by design to prevent malicious apps from intercepting sensitive input.',
    fix: 'SCOPE the accessibility service to only monitor specific windows/applications that need it. Use AccessibilityServiceInfo flags to: 1) Set canRetrieveWindowContent = false for payment app windows, 2) Use event filtering to ignore TYPE_WINDOW_STATE_CHANGE for payment apps, 3) Consider using a separate limited accessibility service for non-sensitive monitoring, 4) Document to users that accessibility service may affect payment apps and provide instructions to temporarily disable. Alternative: If accessibility is only needed for specific features, make it opt-in per feature rather than always-on.',
    codeLocation: 'Android accessibility service implementation',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-02',
    category: 'accessibility',
    severity: 'high',
    title: 'Screen reader cannot access dynamic content',
    problem: 'Dynamic content updates (real-time collaboration cursors, live metric updates) are not announced to screen readers.',
    howDiscovered: 'WCAG 4.1.3 (Status Messages) compliance review.',
    why: 'ARIA live regions must be used for content that updates dynamically. Without them, screen reader users do not know when content changes.',
    fix: 'Add aria-live="polite" regions for: 1) Real-time collaboration cursors and user presence, 2) Metric chart updates, 3) Sync status changes, 4) Notification arrivals. Use role="status" or aria-live with appropriate politeness settings.',
    codeLocation: 'All components with dynamic content',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-03',
    category: 'accessibility',
    severity: 'high',
    title: 'Focus management on route transitions',
    problem: 'When navigating between routes, focus is not managed, leaving screen reader users lost.',
    howDiscovered: 'WCAG 2.4.3 (Focus Order) and 2.4.7 (Focus Visible) review.',
    why: 'Without focus management, after a route change the focus may remain on the old content or reset to body, making navigation confusing.',
    fix: 'Implement focus management: 1) On route change, move focus to the main content area or h1, 2) Use React Router useNavigate with focus management, 3) Add skip links for keyboard users, 4) Ensure focus visible styles are clear (not just browser default).',
    codeLocation: 'App shell and route components',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-04',
    category: 'accessibility',
    severity: 'medium',
    title: 'Color contrast in dark theme',
    problem: 'Some text and UI elements in dark theme may not meet WCAG 1.4.3 contrast requirements.',
    howDiscovered: 'WCAG 1.4.3 (Contrast) review of dark theme.',
    why: 'The theme system uses CSS variables but some combinations may not provide sufficient contrast, especially for secondary text and disabled states.',
    fix: 'Audit all color combinations: 1) Normal text: minimum 4.5:1 contrast, 2) Large text: minimum 3:1 contrast, 3) UI components: minimum 3:1 contrast, 4) Test with tools like axe, Lighthouse, or WebAIM contrast checker.',
    codeLocation: 'apps/web/src/app/themes/',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-05',
    category: 'accessibility',
    severity: 'medium',
    title: 'Keyboard navigation gaps',
    problem: 'Some interactive elements may not be reachable or operable via keyboard alone.',
    howDiscovered: 'WCAG 2.1.1 (Keyboard) and 2.1.2 (No Keyboard Trap) review.',
    why: 'Custom components (dropdowns, modals, drag-and-drop) may not have proper keyboard handlers or may trap focus.',
    fix: 'Ensure all interactive elements: 1) Are focusable (tabindex appropriate), 2) Have keyboard event handlers (Enter/Space for activation), 3) Do not trap focus unless intentional (modals should trap, then release), 4) Have visible focus indicators, 5) Support arrow key navigation where appropriate (menus, grids).',
    codeLocation: 'Custom components',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-06',
    category: 'accessibility',
    severity: 'medium',
    title: 'Images missing alt text',
    problem: 'Some images (charts, figures, avatars) may not have appropriate alt text.',
    howDiscovered: 'WCAG 1.1.1 (Non-text Content) review.',
    why: 'Screen readers cannot interpret images without alt text. Charts and figures need descriptive alternatives.',
    fix: 'Add alt text: 1) Informative images: descriptive alt text, 2) Charts: provide data table alternative or summary, 3) Decorative images: alt empty, 4) Figures with captions: ensure caption is associated.',
    codeLocation: 'Image components, chart components',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-07',
    category: 'accessibility',
    severity: 'low',
    title: 'Error messages not associated with inputs',
    problem: 'Form validation errors may not be programmatically associated with their inputs.',
    howDiscovered: 'WCAG 3.3.1 (Error Identification) review.',
    why: 'Screen readers need to know which input has an error and what the error is.',
    fix: 'Use aria-describedby to link error messages to inputs, or aria-invalid + aria-errormessage. Ensure errors are announced when they appear.',
    codeLocation: 'Form components',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },
  {
    id: 'ACC-08',
    category: 'accessibility',
    severity: 'medium',
    title: 'Collaboration cursors not accessible',
    problem: 'Real-time collaboration cursors (showing where other users are typing) are visual only.',
    howDiscovered: 'Collaborative editing accessibility review.',
    why: 'Users who cannot see the cursor positions do not know where collaborators are working.',
    fix: 'Provide an alternative: 1) Announce collaborator presence and location via live region, 2) Show collaborator names in a list with current section, 3) Consider audio cues for cursor movements (optional, user-controlled).',
    codeLocation: 'Collaborative editing components',
    status: 'confirmed',
    phase: 'Accessibility remediation'
  },

  // MEMORY
  {
    id: 'MEM-01',
    category: 'memory',
    severity: 'medium',
    title: 'Registrations not disposable',
    problem: 'registerRepoCacheEntry returned void, so cache entries could not be cleaned up.',
    howDiscovered: 'Phase 5 audit of cache registration.',
    why: 'Without a disposer, the invalidator could not clean up registered entries on container rebuild.',
    fix: 'registerRepoCacheEntry returns a disposer, delivered through the register hook the invalidator already offered.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'MEM-02',
    category: 'memory',
    severity: 'medium',
    title: 'Write-only cache set never read',
    problem: 'ProjectLwwInvalidator.caches was written to but never read, wasting memory.',
    howDiscovered: 'Phase 5 audit of cache usage.',
    why: 'The caches property was maintained but no code ever read from it, making it pure overhead.',
    fix: 'ProjectLwwInvalidator.caches deleted. Nothing ever read it.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'MEM-03',
    category: 'memory',
    severity: 'low',
    title: 'Module hooks cleared on rebuild',
    problem: 'clearProjectCacheHooks was needed to prevent next container writes being reported to previous one invalidator.',
    howDiscovered: 'Phase 5 audit of cache hook lifecycle.',
    why: 'Without clearing hooks, a rebuild would leave old hooks that report to the wrong invalidator.',
    fix: 'clearProjectCacheHooks() called on rebuild, or the next container writes are reported to the previous one invalidator.',
    codeLocation: 'apps/web/src/container/',
    status: 'confirmed',
    phase: 'Phase 5'
  },
  {
    id: 'MEM-04',
    category: 'memory',
    severity: 'low',
    title: 'Metric port has append with zero call sites',
    problem: 'IMetricRepository has append method with zero call sites - dead API surface.',
    howDiscovered: 'Phase 4 audit of metric repository interface.',
    why: 'The append method exists on the interface but nothing implements or calls it. IMetricRepository has two implementors but append has zero call sites.',
    fix: 'Remove append from the interface or add the missing implementation. The port is already narrow.',
    codeLocation: 'packages/core/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'MEM-05',
    category: 'memory',
    severity: 'low',
    title: 'describeRejection has one consumer in private package',
    problem: 'describeRejection function has exactly one consumer in a private package.',
    howDiscovered: 'Phase 4 audit of utility function usage.',
    why: 'A function used only once in a private package may not warrant being a separate exported function.',
    fix: 'Consider inlining at the call site or making it truly private to the package.',
    codeLocation: 'packages/core/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'MEM-06',
    category: 'memory',
    severity: 'low',
    title: 'Freshness constants use different clocks',
    problem: 'Both freshness constants should use the same clock for consistency.',
    howDiscovered: 'Phase 4 audit of cache freshness.',
    why: 'Using different clocks (e.g., Date.now vs performance.now) for freshness calculations can cause inconsistencies.',
    fix: 'Two freshness numbers in one module with the distinction written down. One cache entry type with fetchedAt required so caller says which moment it means.',
    codeLocation: 'apps/web/src/lib/cache/',
    status: 'confirmed',
    phase: 'Phase 4'
  },

  // STRUCTURAL
  {
    id: 'ARCH-01',
    category: 'optimization',
    severity: 'medium',
    title: 'Seven LoadScreenUseCase files repeat merge logic',
    problem: 'Seven LoadScreenUseCase files exist and the merge is already extracted in core. The residue is the surrounding orchestration.',
    howDiscovered: 'Phase 6 audit of screen use case duplication.',
    why: 'The merge logic itself is in core, but each screen use case repeats the orchestration around it.',
    fix: 'loadPinnedScreenData takes the resource type once instead of six screens spelling it twice. buildListMembership replaces the map built by hand in four places.',
    codeLocation: 'apps/web/src/features/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-02',
    category: 'optimization',
    severity: 'medium',
    title: 'Required card projections not on ports',
    problem: 'Six web fallbacks and seventh in core handled missing card projections.',
    howDiscovered: 'Phase 4 audit of repository ports.',
    why: 'listSummaries is required on both ports; the fallbacks were for when it was not present. With the requirement, fallbacks are gone.',
    fix: 'listSummaries is required on both ports. Six web fallbacks and seventh in core are gone, along with two contract suites when present branches.',
    codeLocation: 'packages/core/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-03',
    category: 'optimization',
    severity: 'medium',
    title: 'PapersFacade split needed',
    problem: 'PapersFacade had grown to handle papers, fields, and Zotero integration.',
    howDiscovered: 'Phase 6 audit of facade responsibilities.',
    why: 'The facade had too many responsibilities. The audit 69-call-site estimate was the whole facade surface.',
    fix: 'Four concerns became three classes: custom fields to PaperFieldsFacade, everything Zotero to ZoteroFacade. The two extracted slices have ten call sites between them.',
    codeLocation: 'apps/web/src/features/papers/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-04',
    category: 'optimization',
    severity: 'low',
    title: 'Inline core type imports pattern',
    problem: '86 occurrences of import("@weaveforge/core").X pattern across 34 files.',
    howDiscovered: 'Phase 4 boundary lint.',
    why: 'The pattern adds complexity. However, @typescript-eslint/consistent-type-imports is not the right enforcement - it would flag every value import used as type.',
    fix: '95 across 40 files hoisted to top-level import type. check-dry rule keeps them out. Both boundary gates now search container/',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-05',
    category: 'bug',
    severity: 'low',
    title: 'fetchBlobs dead batch-fetch fallback (refuted)',
    problem: 'Audit claimed fetchBlobs is optional on IPaperImageStore, hence a duplicate batch-fetch fallback.',
    howDiscovered: 'Audit reviewed IPaperImageStore interface.',
    why: 'REFUTED. fetchBlobs is required (zotero.ts), no fetchBlobs? exists anywhere, and git log -S shows it never was optional. The facade fallback is unreachable dead code.',
    fix: 'fetchBlobs is required on the port. The fallback was unreachable. The cited production bug was a this-binding mistake, not optionality.',
    codeLocation: 'packages/core/src/',
    status: 'refuted',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-06',
    category: 'optimization',
    severity: 'medium',
    title: 'Local Zotero import not testable in browser',
    problem: 'Local Zotero import branch could only be tested with Electron.',
    howDiscovered: 'Phase 6 audit of Zotero integration testing.',
    why: 'The desktop bridge is needed for local Zotero access, making browser testing impossible.',
    fix: 'An application-layer use case with the desktop bridge injected, so the branch a browser user hits is testable without Electron.',
    codeLocation: 'apps/web/src/features/integrations/zotero/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-07',
    category: 'bug',
    severity: 'medium',
    title: 'Scoped helper methods do not exist',
    problem: 'Audit proposed using this.scoped(...) / PAPER_ID_COLUMNS but neither exists.',
    howDiscovered: 'Phase 3 audit of papers repository.',
    why: 'ProjectRepository exposes only db and a pid getter. The proposed helpers do not exist.',
    fix: 'Closed in Phase 3 where the papers repository was already open. The projection cannot be narrowed as proposed.',
    codeLocation: 'apps/web/src/features/papers/',
    status: 'confirmed',
    phase: 'Phase 3'
  },
  {
    id: 'ARCH-08',
    category: 'optimization',
    severity: 'medium',
    title: 'Push-to-Zotero rule duplicated and drifted',
    problem: 'Two copies of the Zotero push rule had drifted on the part that matters.',
    howDiscovered: 'Phase 6 audit of Zotero push logic.',
    why: 'The facade swallowed a failed push, the composition root let it escape a confirmed proposal after the paper was already added.',
    fix: 'One use case, with a stated outcome. proposalApplies is that rule, as a generic type predicate so callers keep their own row type.',
    codeLocation: 'apps/web/src/features/integrations/zotero/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-09',
    category: 'optimization',
    severity: 'medium',
    title: 'Append-note revision rule written three times',
    problem: 'The revision rule for appending notes was implemented three separate times.',
    howDiscovered: 'Phase 6 audit of note append logic.',
    why: 'Duplication means any change must be applied three times, and drift is likely.',
    fix: 'One append-note use case in core, with the port it satisfies (IAiPaperNoteAppender) already existing. proposalApplies is that rule.',
    codeLocation: 'packages/core/src/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-10',
    category: 'optimization',
    severity: 'medium',
    title: 'Auth flow duplicated across surfaces',
    problem: 'Both auth surfaces (web and relay) had separate implementations of the mint, verify, answer sequence.',
    howDiscovered: 'Phase 6 audit of authentication flows.',
    why: 'The relay surface answered 503 for every failure, so a bug of ours reached clients as try again later.',
    fix: 'Both surfaces now share the mint, verify, answer sequence. One policy now (503 only for a missing JWT secret), and one refusal wording per surface.',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-11',
    category: 'optimization',
    severity: 'medium',
    title: 'WorkspaceSearch has four pieces in one class',
    problem: 'WorkspaceSearch projection, extracted-text pruning, stale/index state, and related-document helper were all in one 542-line class.',
    howDiscovered: 'Phase 6 audit of search module structure.',
    why: 'The state object is where the class one real bug lived, and its invariant was not testable without a snapshot, worker, or IndexedDB.',
    fix: 'Four modules beside a 438-line class (was 542). The state object invariant is now testable without dependencies.',
    codeLocation: 'apps/web/src/features/search/',
    status: 'confirmed',
    phase: 'Phase 6'
  },
  {
    id: 'ARCH-12',
    category: 'optimization',
    severity: 'medium',
    title: 'Screen registry incomplete',
    problem: 'Screen registry the audit proposed would include a screen with no cache and omit one that has one.',
    howDiscovered: 'Phase 4 audit of screen caching.',
    why: 'SCREEN_IDS was not properly seeded from the real cache keys.',
    fix: 'SCREEN_IDS seeded from the ten real cache keys. The invalidation map is typed by it, the prefetch switch is exhaustive over it, and /report/overleaf is finally a screen.',
    codeLocation: 'apps/web/src/lib/screens/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-13',
    category: 'optimization',
    severity: 'low',
    title: 'Random bytes injected in wrong place',
    problem: 'randomBytes was in a directory about papers rather than with other system utilities.',
    howDiscovered: 'Phase 4 audit of system dependencies.',
    why: 'randomBytes is a system-level dependency like the clock and id generator, not paper-specific.',
    fix: 'randomBytes joined the clock and the id generator, in lib/system.ts rather than a directory about papers.',
    codeLocation: 'apps/web/src/lib/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-14',
    category: 'bug',
    severity: 'medium',
    title: 'RunFinaliser.succeeded contradicts docstring',
    problem: 'RunFinaliser.succeeded ending except Exception: self.failed(); raise contradicts its own never raises docstring.',
    howDiscovered: 'Phase 1 audit of Python finaliser.',
    why: 'Re-raises the flush failure out of with track(...), shifts warnings.warn attribution by one frame.',
    fix: 'Already addressed in tracking.py refactored _finalise.',
    codeLocation: 'python/weaveforge/',
    status: 'confirmed',
    phase: 'Phase 1'
  },
  {
    id: 'ARCH-15',
    category: 'optimization',
    severity: 'low',
    title: 'Cache policy and entry not unified',
    problem: 'Two freshness numbers in different modules without clear distinction.',
    howDiscovered: 'Phase 4 audit of cache freshness.',
    why: 'Without a unified cache entry type, callers may use the wrong timestamp.',
    fix: 'Two freshness numbers in one module with the distinction written down. One cache entry type, with fetchedAt required so a caller says which moment it means.',
    codeLocation: 'apps/web/src/lib/cache/',
    status: 'confirmed',
    phase: 'Phase 4'
  },
  {
    id: 'ARCH-16',
    category: 'optimization',
    severity: 'low',
    title: 'Prose out of policy module',
    problem: 'Reason codes had prose explanations in the policy module rather than beside the fetch that shows them.',
    howDiscovered: 'Phase 4 audit of error handling.',
    why: 'The reason codes are the contract (in core), but the sentences explaining them should be where they are shown.',
    fix: 'The reason codes stay in core as the contract. The sentences live beside the fetch that shows them.',
    codeLocation: 'apps/web/src/',
    status: 'confirmed',
    phase: 'Phase 4'
  },