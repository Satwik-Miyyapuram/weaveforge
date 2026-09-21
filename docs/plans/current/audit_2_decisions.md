# Decisions needed — code audit

Nothing here is blocked on analysis. Each item is a real finding whose fix has a
**choice** in it that belongs to the project owner, not to the auditor. Each has a
recommendation and the cost of each branch.

Companion documents: `audit_2_verification.md` (what is true) and
`audit_2_progress.md` (what has landed).

---

## D1 — Screen-cache cancellation (WF-N05, second half)

**The finding.** `useScreenData` calls `loadRef.current()` with no `AbortSignal`.
A slow load keeps running after unmount or after a project switch, and its answer
is discarded by the `requestSeq` guard — so the work is wasted and the socket
stays busy on a tablet. The guard protects *which* answer is written; it does not
stop the work.

**Why it is a decision.** The fix changes a published contract:
`LoadScreenUseCase.execute` and the ten `useScreenData` call sites would take a
signal. The audit itself says to do this "with the Phase 4 contract work, not
before" — and Phase 4 has landed, so the sequencing argument is now about blast
radius rather than order.

| Option | What it costs | What it buys |
| --- | --- | --- |
| **A. Add `AbortSignal` now** (recommended) | A widening change to `LoadScreenUseCase` and 10 call sites; every use case must pass the signal to its repository or the abort is decorative | A project switch stops the previous project's reads; the tablet-still-feels-sluggish-after-a-switch symptom goes away |
| B. Leave it, document it | Nothing | The wasted work stays; the `requestSeq` guard already prevents wrong data, so the visible damage is bandwidth and battery, not correctness |
| C. Abort at the call sites only | No core change; each screen wires its own controller | Half a fix — the signal stops at the use case unless the use case forwards it, and ten copies of the wiring is how it drifts |

**Recommendation: A**, as its own PR with the contract diff reviewed on its own.
It is mechanical and the compiler enumerates every call site — which is exactly
the property the audit values in required-parameter changes.

**If you pick A**, the shape is: `load(signal: AbortSignal)`, an `AbortController`
in a ref keyed by `requestSeq`, aborted in the effect cleanup and at the start of
each `reload`, and every repository call that reaches the network takes the signal.

---

## D2 — Metric `append`: keep the ingest port or delete it? (WF-N04, MEM-04)

**Where it stands.** `append` works. It inserts through the `experiment_metrics`
view, and `0114`/`0115` install the `INSTEAD OF INSERT` trigger that routes the
row into `experiment_metric_points` and fills `user_id` — the finding's claim that
this fails at runtime is wrong. It lives on its own `IMetricWriter` port, is
implemented twice, and is exercised by the shared contract suite. Its only
*production* caller is the Python SDK's ingest API, not the web app.

What is genuinely absent is a **round-trip test through the real database**, which
is why the write path has never been exercised against the trigger.

| Option | What it costs | What it buys |
| --- | --- | --- |
| **A. Keep it, add the round-trip test** (recommended) | One integration test in `apps/web/src/backend/test/` | The documented write path is proven; a future migration that drops the trigger fails a test instead of silently breaking the SDK's ingest |
| B. Delete `append` and `IMetricWriter` | Removes a port the SDK ingest path and the contract suite depend on; the SDK would need a different write path | A smaller surface; but it deletes a live capability to close a documentation gap |
| C. Keep it, change nothing | Nothing | The trigger remains an undocumented dependency with no test |

**Recommendation: A.** The port is deliberate — `metric-point.ts:68-75` explains
the composition as "nothing depends on a method it does not call" — and the
finding's premise (that the method is broken) is refuted, so deleting it would be
fixing a bug that does not exist.

---

## D3 — Android release build: signing and shrinking (WF-N19)

**Where it stands.** `release { isMinifyEnabled = false }` and no
`signingConfig`: a release APK is unminified and unsigned, so `assembleRelease`
produces something that cannot be installed over the debug build. The README lists
"Release signing" under *Not done*.

| Option | What it costs | What it buys |
| --- | --- | --- |
| **A. Signing config + R8 + keep rule** (the audit's recommendation) | A keystore in the operator's environment; `proguard-rules.pro` must be created (it does not exist) with a keep rule for the reflection-called bridge methods — without it, inking silently stops working in release | 40–60 % APK reduction for a two-class app; a release artifact that is actually installable |
| B. Signing config only | Keystore only; no keep-rule risk | An installable release build; the APK stays large |
| C. Leave both, keep the README honest | Nothing | No risk of a release-only inking failure; the artifact remains a non-deliverable |

**Recommendation: B first, then A** as a separate change with the release APK
exercised on a device. The reason to split them: R8 stripping a
`@JavascriptInterface` method fails **only in release**, on the one platform path
that cannot be tested on a build machine — and this pass could not compile the
Android module at all (see below), so an R8 change here would be unverified twice
over.

**Separate sub-decision:** should CI build the APK? It cannot today. Adding it
would catch Kotlin breakage that nothing currently catches — this pass changed
the module and *no* check in the pipeline compiles it.

---

## D4 — A privileged-capability diagnostic screen (WF-X07)

**The finding.** Android's "Screen overlay detected" dialog names no package, so
the user's only recourse is to disable things one at a time — and the app they
blame is whichever they installed last. Nothing in the product shows the device's
own privileged-permission state. Everything needed is readable with no special
permission: `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`,
`Settings.canDrawOverlays`, `DevicePolicyManager.getActiveAdmins()`.

| Option | What it costs | What it buys |
| --- | --- | --- |
| **A. Android settings screen** (the audit's suggestion) | New UI in a module with no settings screen at all, plus a Kotlin build to verify it | Resolves the ticket that generated this whole review, on the device where it happens |
| B. Web-side settings panel | Needs a bridge method, which grows the `@JavascriptInterface` surface the origin policy now constrains — the wrong direction | Same content, but it widens the one capability the review recommends shrinking |
| C. Ship nothing, document the causes | Nothing | The finding's own root-cause list (overlay apps, accessibility services, device admin) is already written; users still cannot see it in the product |

**Recommendation: A, as its own change.** It is the one item in the X-series that
adds value *today* rather than preventing a future mistake. It also has a
prerequisite worth naming: the module has no settings surface, so this is "add a
settings screen" more than "add a row".

---

## D5 — Pen-only mode cannot honour its own documentation (WF-N03)

**The finding.** Tier D is `if (penOnly) return event.pointerCount < 2`, commented
"two fingers still pan and pinch the page beneath". That is unreachable: the first
finger's `ACTION_DOWN` arrives with `pointerCount == 1`, so Tier D returns `true`
and the overlay owns the stream. The second finger's `ACTION_POINTER_DOWN` then
reaches a view that already claimed the gesture, and returning `false` there does
not hand the earlier `ACTION_DOWN` back — no view below ever saw it. In pen-only
mode the page can only be scrolled with the pen outside the ink rect.

This is a genuine trade, not a bug to patch:

| Option | What it costs | What it buys |
| --- | --- | --- |
| **A. Defer the claim**: on `ACTION_DOWN`, record the candidate, return `false`, re-acquire when the pen appears | A **one-finger drag now scrolls the page in pen-only mode** — which is the thing pen-only exists to prevent. It cannot be recovered later: once the gesture belongs to the web view, the overlay cannot take it back | The documented two-finger pan/pinch works; the page is navigable |
| **B. Restructure**: put the overlay and the web view in a `FrameLayout` and take the gesture over from `onInterceptTouchEvent` | Layout surgery in `activity_main.xml` + `MainActivity`; `onInterceptTouchEvent` only exists on a `ViewGroup` parent, so the overlay stops being a sibling and becomes a child | Both behaviours: pen-only blocks single-finger contact *and* two-finger pan works, because interception is designed for exactly this |
| **C. Leave the code, fix the comment** | Nothing | The comment stops claiming a capability the code does not have; the limitation is documented |

**Recommendation: C now, B when it is next touched.** The comment has been
corrected in this pass, so the code no longer lies about itself. Option B is the
only answer that satisfies the feature, and it is a contained piece of work — but
it needs a device to verify, and B changes the view hierarchy that every inking
path depends on.

**Not recommended: A.** It trades a documented limitation for an undocumented
regression, and the regression is in the mode whose entire purpose is blocking
finger contact.

---

## Environment blocker (not a decision)

`apps/android` **cannot be compiled on this machine.** The only JDK present is
25.0.2 and the pinned Android Gradle Plugin 8.7.3 fails before Kotlin runs:

```
FAILURE: Build failed with an exception.
* What went wrong:
25.0.2
...
java.lang.IllegalArgumentException: 25.0.2
```

AGP 8.7.3 supports JDK 17–21; it cannot parse Java 25's version string. Nothing in
this repository is broken by that — `apps/android` also has no `local.properties`
committed, so it resolves the SDK from the environment on the machine that builds
it.

**What to do before trusting the Kotlin changes in this PR:** build the module on
a JDK 17 or 21 (`./gradlew :app:compileDebugKotlin`), then install a debug APK on a
tablet and check three things, because they are the three that cannot be read off
the source:

1. A palm down before the nib inks a stroke (WF-N02 — the headline fix).
2. A very long highlighter pass still commits (WF-N14's cap).
3. Navigating to an off-origin link is refused, and the app still loads normally
   (WF-N08's policy).
