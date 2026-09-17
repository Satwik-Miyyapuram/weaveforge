# The Windows Ink recogniser helper

A ~400-line C# console program that wraps `Windows.UI.Input.Inking.Analysis.InkAnalyzer`
and speaks newline-delimited JSON on stdin/stdout. The desktop app spawns it once
per session (`apps/desktop/src/ink-recogniser.ts`); the thinking behind it is §5.3
of `docs/internal/design/ink-notes-plan.md`.

## Why a helper process

`InkAnalyzer` is WinRT, and Electron cannot call it from JavaScript. Three options
were considered and the first is the one implemented:

| Option | Verdict |
| --- | --- |
| A bundled helper executable over stdio | **Chosen.** No Electron ABI coupling, no prebuild per Electron bump, and a crash in the recogniser kills the helper rather than the app. |
| A C++/WinRT N-API addon | Rejected: a native addon crash is an app crash, and it needs a rebuild on every Electron ABI bump. |
| `node-api-dotnet` / `edge-js` | Rejected: heavier than the helper for the same ABI coupling. |

## Why it is worth shipping at all

The engine is **already installed on Windows, offline, with its language models**.
Measured on the target hardware (Snapdragon X, Windows 11 arm64, .NET 9):

| | |
| --- | --- |
| Cold start (CLR + SDK load), once per session | ~90–170 ms |
| Warm, three-line page (engine's own timing) | 32–63 ms |
| Warm, two-line page (wall clock through the client) | ~39 ms |
| Published size, self-contained and trimmed | 13.4 MB (x64) / 13.8 MB (arm64) |

Compare the retracted alternative in §0.2: 240–330 MB of image-OCR weights and
6–20 seconds a page. The 14 MB is per architecture, so a Windows installer grows by
about 28 MB rather than 14 MB — see §10 of the plan.

## The protocol

One JSON object per line, in both directions. Every request carries an `id` and its
answer repeats it, so two pages can be in flight at once.

```jsonc
// startup, once
{"type":"ready","engine":"windows-ink@1","version":"windows-ink analyser ready on Microsoft Windows NT 10.0.26200.0"}

// in
{"id":1,"type":"recognise",
 "lines":[{"strokes":[400,400,128, 410,420,128, 420,400,128]}],
 "vocabulary":["Graph-prior module"],"lang":"en-US"}

// out
{"id":1,"type":"recognised","engine":"windows-ink@1","ms":38,
 "lines":[{"text":"hello","confidence":1,"alternatives":["hello","hell o"]}]}

// in
{"type":"quit"}
```

Points are `x, y, pressure` triples in **tenths of a millimetre**, 0–255 pressure,
exactly what the note's sidecar stores. The helper converts to the
device-independent pixels the recogniser was trained on.

`ping` answers with a fresh `ready` line, which is what the client uses to tell a
live helper from a hung one.

## Three things the API does not do, recorded rather than papered over

1. **There is no confidence score.** `InkAnalysisLine.RecognizedText` is a string;
   nothing exposes how sure the engine is. The helper reports `1` for a line it
   produced text for and `0` for one it did not. The plan's "map each engine's score
   into [0,1]" is therefore a no-op for this engine, and the correction UI's
   dotted underline will never fire on Windows Ink — which is honest, where an
   invented score would make the UI lie about which lines to check.
2. **There are no vocabulary hints.** §5.4 says "Windows Ink accepts a word list as
   a recognition guide". Neither `InkAnalyzer` nor `InkRecognizerContainer` has any
   such parameter. The fields stay on the wire because the engine interface is
   engine-agnostic, but this engine ignores them, so §5.4's post-match against
   known titles is the *only* path that helps here rather than a fallback for
   engines that cannot take hints.
3. **`InkRecognizerContainer.GetRecognizers()` is unusable on this stack.** It is
   the only API that lists the installed handwriting recognisers, and touching it
   makes the process **fail-fast at teardown** with `0xC0000409`. The helper does
   not call it; availability is proved by an `InkAnalyzer` constructing, which is
   the engine being present. The recogniser *names* were only ever a diagnostic.

## The exit code, and why it is `TerminateProcess`

Windows Ink's objects make this process fail-fast with `0xC0000409` while it shuts
down, after every answer has been written and flushed. Isolated with controls:

| Program | Exit |
| --- | --- |
| a trivial .NET console app | 0 |
| + `InkAnalyzer` + `AnalyzeAsync`, one stroke | 0 |
| + a page's worth of strokes and the analysis tree walk | **`0xC0000409`** |
| the same, with `GC.Collect()` + `WaitForPendingFinalizers()` before the end | **0**, then `0xC0000409` at teardown |
| the same, ending with `TerminateProcess(GetCurrentProcess(), 0)` | 0 |
| the same, ending with `Environment.Exit(0)` | **`0xC0000409`** |

So collecting the objects is safe and *terminating* is where it dies — and
`Environment.Exit` does not avoid it, because that still runs DLL detach. The helper
therefore terminates itself explicitly. The client reads exit codes, so without this
it would see correct recognition followed by "the helper crashed", restart a working
process, and raise a Windows Error Reporting event every time a page was recognised.
Delete this the moment a Windows update stops needing it.

## Building

```bash
npm run build:ink --workspace @weaveforge/desktop          # both architectures
node apps/desktop/scripts/build-ink-recogniser.mjs --arch=arm64
```

Needs a .NET SDK (9 verified). **A missing SDK is not an error**: the script prints
what it skipped and exits 0, and the app falls back to the web recogniser, which is
a supported configuration rather than a degraded one. `npm run package` builds both
before `electron-builder` runs, and `extraResources` in `apps/desktop/package.json`
puts the right one under `process.resourcesPath` per architecture.

The contract test (`apps/desktop/test/ink-recogniser.test.ts`) drives a fake helper
on every platform and runs the real one when it has been built, so a checkout
without the SDK still tests the protocol, the timeouts and the failure paths.
