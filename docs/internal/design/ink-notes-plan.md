# Ink notes — handwritten notes in the editor workspace

**Status:** proposal, not scheduled. Companion to
`editor-workspace-redesign.md` §3.3, which reserves the *slots* (kind tables,
`.ink.md` suffix, the ink tab in the prototype). This document is the plan for
filling them. It **supersedes** the redesign's §3.3 file-format sketch
(one `.ink.md` file, no sidecar, `chromium-hwr`) — see the note there — and
touches nothing else the hand-off owns.

**Revision 3, 2026-09-11.** Revision 2 moved to a WebGL2 worker pipeline,
binary compressed storage and OS stroke recognition. Revision 3 incorporates a
review (`ink-notes-plan-update.md`) and the primary sources it pointed at.
**§0.2 retracts four revision-1 conclusions; §0.3 retracts three revision-2
errors, including one where revision 2 invented a mechanism that the API's own
spec forbids.** The requirement driving all of it: ink must be fast on a
**Surface Pro with integrated graphics, no discrete GPU**, at 120 Hz — an
8.3 ms frame budget. The machine these benchmarks ran on turned out to be a
**Snapdragon Adreno X1-85 integrated GPU** (§11.4), i.e. the target hardware
class, not a proxy for it.

---

## 0. The one-paragraph version

WeaveForge already has a working pen: the PDF reader captures pressure-aware
ink, groups strokes, simplifies them to a byte budget, erases, paints a
highlighter, and rejects palms without a device API
(`packages/core/src/reader/ink-stroke.ts`,
`apps/web/src/features/reader/ui/pdf-reader/use-page-pointer.ts`). Ink notes
point that pen at a blank page instead of a PDF. One note is one `.md` whose
body is a **recognised text layer** — searchable, `[[linkable]]`, lintable,
diffable — beside **per-page binary stroke chunks**, recognised offline by the
OS's own handwriting engine where one exists. The pen never touches React,
never touches the DOM, and never rasterises on the main thread: pointer samples
go straight to a **WebGL2 render loop inside a worker**, while — when the
platform provides it — the OS compositor draws the wet tail via the Delegated
Ink Trail.

---

## 0.1 Decisions at a glance

| # | Decision | Why |
| --- | --- | --- |
| **D1** | **Stroke data never enters the `Y.Text` document** | Edit view blocks **0.8–8.5 s** on a dense note, and the block rides the CRDT and re-serialises on every save. §4.6 |
| **D2** | **Binary columnar storage + brotli, one chunk per page** | **39–53 kB** per dense page vs **2.11–3.18 MB** of JSON — **55×** — and **O(1)** load. Per-page, not per-note, so concurrent page edits do not collide in cloud sync. §4.3 |
| **D3** | **Variable width: pressure per point** | Costs ~13 kB compressed, and the trail takes a per-event `diameter`. Revision 1 gave this up for nothing. §0.2 |
| **D4** | **WebGL2 in a worker is the render surface** | Fixed geometry, GPU-expanded, no CPU rasterisation; Canvas 2D full re-raster is **186–354 ms**. The *ratio* is the point; the exact GPU time is not measurable here (§11.4). |
| **D5** | **All ink rendering in an `OffscreenCanvas` worker** | React/Yjs/CodeMirror stall the main thread by **16–74 ms** measured; the pen must not be behind them. §6.2.2 |
| **D6** | **Draw incrementally: only new segments per frame** | Incremental vs redrawing the growing stroke; the flush-verified Canvas 2D equivalent was **0.5 ms vs 4.8 ms**. §6.2.7 |
| **D7** | **Delegated Ink Trail *or* desynchronized canvas — never both** | The API's own non-goals make them alternatives: desynchronized canvas exists to *bypass* the compositor the trail *uses*. §6.2.6 |
| **D8** | **Windows Ink on desktop, online stroke model on web** | Windows Ink ships with the OS: **0 MB download**. TrOCR was 330 MB and **6–20 s/page**. Reached out-of-process, not as an addon. §5.2, §5.3 |
| **D9** | **R-tree (Flatbush) + tombstone liveness bitmask** | No cell size to mistune; tombstones make erasing O(1) with no per-frame index rebuild. §6.2.4 |
| **D10** | **A new width module in 0.1 mm; do not reuse the reader's** | `clampInkWidth` clamps to `[0.75, 24]` PDF units — a 6 mm highlighter becomes 2.4 mm. §6.3 |
| **D11** | **`pointerrawupdate` + coalesced; prediction only when *not* delegating** | Predicting while the OS also predicts produces a visual "fork" — the spec says so. §6.2.6, §6.2.7 |
| **D12** | **Per-page byte budget is primary; stroke caps derive from it** | Revision 1's three caps contradicted each other. §4.7 |
| **D13** | **Adaptive 1-Euro filter on pressure *and* position** | Revision 2's blanket ban on position filtering was wrong; 1-Euro is designed to add ~0 lag at speed. §6.2.5 |
| **D14** | **Stencil buffer, not an offscreen FBO, for highlighter dedupe** | Saves a ~22 MB full-res target and a full-screen composite per frame. §6.2.3 |

---

## 0.2 What revision 1 got wrong

Revision 1 was a careful repair of the wrong machine. Four conclusions are
retracted, each falsified by measurement recorded in §11.3.

**1. Retracted: "constant width, one width per stroke" (was D2).**
Revision 1 argued that per-point pressure was unaffordable and that the
Delegated Ink Trail could not match a variable-width stroke, so it made every
stroke rigidly uniform. Both halves were wrong:

- *The storage argument evaporates under compression.* Binary + brotli gives
  **52.5 kB** for a dense page *with* per-point pressure and **39.0 kB**
  without — a **13 kB** difference on the largest page the format allows
  (§11.3.5). Revision 1 traded away calligraphic taper to save 13 kB.
- *The trail argument was based on a misreading.* Revision 1 claimed a
  "guaranteed visible width pop". The trail only ever covers the gap between
  the last rendered frame and the pen tip — one animation frame, a few
  millimetres. Passing the instantaneous width
  (`updateInkTrailStartPoint(e, { color, diameter: nibWidth(pressure, velocity) })`,
  which is what the WICG spec's own example does) makes the seam sub-pixel.
  There is no pop to avoid.

Revision 1 also noted, correctly, that constant width made full-page raster
**39 % slower** (258 ms vs 186 ms). It accepted that cost for a storage saving
that does not exist. **Variable width is restored.**

**2. Retracted: "WebGL2 is not the answer" (§6.2.3 of revision 1).**
The argument was that geometry build and upload dominate, and that
`drawImage`-ing WebGL into a 2D canvas is a GPU→CPU readback. The second half
was a straw man — in a real engine the canvas *is* WebGL2; nothing is ever
copied back. Measured, with geometry resident in VRAM:

| Operation, 5 000 strokes / 295 000 segments | ms |
| --- | --- |
| instanced draw (6 verts × 295 k instances) | **< 0.001** (below timer resolution) |
| pan (uniform update + draw) | **< 0.001** |
| instanced upload (5.9 MB) | 0.5 |
| points-only upload (2.4 MB) | 0.2 |
| instanced build (one-time JS) | 22.7 |
| Canvas 2D, for contrast: full re-raster | **258–327** |

Revision 1 concluded from ~13 ms of `bufferData` that WebGL was "not a v1
need". That was the wrong inference: **upload is a per-geometry-change cost of
0.5 ms, draw is free, and pan/zoom become uniform updates** — exactly what
Canvas 2D cannot do without bitmap caching, dirty rects and a blurry zoom
frame. **WebGL2 is the render surface.**

**3. Retracted: TrOCR as the v1 recogniser (§5.2 of revision 1).**
Revision 1 chose an **offline image OCR** model. The user is writing on a
digitiser that reports `(x, y, t, pressure)` at 240 Hz; rasterising that to a
384 px bitmap and running a ViT over it discards the stroke order, direction
and timing that make online recognition work. Cost: 240–330 MB of weights and
**6–20 s per page**, because the pipeline does not batch. Meanwhile the target
platform ships `InkAnalyzer` already installed, offline, at **0 MB** download.
**Windows Ink is the desktop engine; an online stroke model is the web
fallback.**

**4. Retracted: "the 40× storage claim is overstated."**
Reviewing the critique I estimated binary packing would give "4–8×, not 40×".
Measured: **55×** at practical settings (§11.3.5). Delta-encoded coordinates
are close to incompressible *as text* and highly compressible *as entropy-coded
binary*. I was wrong in the same direction twice — first keeping JSON, then
underestimating its replacement.

**What survives from revision 1, and is still load-bearing:** D1 (strokes out
of `Y.Text`), the readback rule (now fallback-only, §6.2.8), the raster budget
as a *gate*, incremental live-stroke drawing, memory eviction, the palm
rejection layers, and the whole §11 evidence base. The CodeMirror measurements
remain the reason D1 exists.

---

## 0.3 What revision 2 got wrong, and what the review got wrong

A review (`ink-notes-plan-update.md`) was checked against primary sources and
against measurement. Three revision-2 errors are confirmed and fixed; three of
the review's claims are overstated or unsupported; one of the review's claims
that revision 2 missed is also fixed. And the review's citation apparatus
contains fabricated numbers that must not be quoted onward.

### Retracted from revision 2

**1. Retracted: "desynchronized canvas and the Delegated Ink Trail both feed
the compositor and merge without a handshake" (§6.2.6).** This mechanism was
invented. The Edge/WICG explainer that produced the API lists as an explicit
**non-goal**:

> *Co-exist with desynchronized canvas — one of the purposes of desynchronized
> canvas is to bypass the system compositor.*

and its own sample code uses desynchronized canvas + prediction **only in the
`catch` branch**, i.e. when the presenter is unavailable:

```js
try {
  let presenter = await navigator.ink.requestPresenter(...);
  ...
} catch (e) {
  // Ink presenter not available, use desynchronized canvas, prediction,
  // and pointerrawmove instead
  renderer.usePrediction = true;
  renderer.desynchronized = true;
}
```

They are **alternatives, not complements**. The review is right. The canvas is
`desynchronized: false` when the trail is in use, and `desynchronized: true`
on the fallback path. §6.2.6 and §6.2.8 corrected.

**2. Retracted: "use `getPredictedEvents()` for the live-stroke tail" while
delegating (D11).** The review did not catch this; the same non-goals list did:

> *Co-exist with input prediction — since the operating system will be
> rendering points before the application sees them, the application should no
> longer perform prediction, as doing so may result in a visual 'fork' between
> the application's rendering and the system's rendering.*

Prediction and delegation are mutually exclusive for the same reason
desynchronization and delegation are. Prediction belongs to the fallback path
only.

**3. Retracted: "filter pressure and velocity; never filter position."** Too
absolute. The 1-Euro filter exists precisely to break the smoothness-versus-lag
trade: its cutoff rises with speed, so it damps grid quantization and hand
tremor at slow speeds and phases out to ~zero lag at speed. Revision 2's blanket
ban would leave visible staircasing on deliberate writing. The review is right;
softened to D13.

The related "Catmull-Rom splines" suggestion is **not** adopted as written — see
below.

### Overstated or unsupported in the review

**4. The "10–15× overdraw" figure is roughly right only for unsimplified
geometry, and is ~5× too high for what the plan actually stores.** Measured by
additive accumulation into a float target and `readPixels` (a method that does
not depend on timing, unlike the review's figures):

| Geometry | Quad overdraw (mean / over covered px) | Peak |
| --- | --- | --- |
| raw 60 points/stroke (live-stroke density) | **8.47 / 9.95** | 75 |
| simplified 16 points/stroke | **3.09 / 4.06** | 31 |
| simplified 8 points/stroke (a committed page) | **1.83 / 2.70** | 19 |

The plan only ever draws **simplified committed strokes** (§4.4), so the number
that matters is **~1.8–3.1×**, not 10–15×. The concern is directionally real and
the mitigation (below) is cheap; the magnitude was overstated.

**5. The review's GPU-time table is fabricated.** It reports "GPU Execution Time
(5k Strokes): SDF 3.2 ms / ribbons 1.1 ms \[cite: 1, 11.4\]" and "Minimum
Measured Latency: unstable, 8–25 ms \[cite: 1, 6.2.6\]". **Neither measurement
exists in this document.** §11.4 is a methodology note; §6.2.6 contains no
latency measurement. Other citations are decorative rather than evidentiary —
ref [4] (cited for overdraw and fill rate) is a Hacker News thread about **CSS
box shadows**; ref [11] is a blog about **foliage** overdraw; refs [24] and [25]
(an App Store listing and a lifestyle blog) are cited for the **Concepts**
engine's rendering architecture. Treat every number in that review as
unverified until re-measured.

**6. The review's own SDF-versus-ribbon table is internally inconsistent, and
its "1.0× overdraw" claim does not survive contact with joins.** It credits
ribbons with 5.9 MB VRAM transfer while crediting SDF with 2.4 MB — but 5.9 MB
is this document's *instanced quad* figure (§11.3.3), and the measured ribbon
costs are **4.8 MB of vertices plus 7.1 MB of indices without AA**, or **9.6 MB
plus 21.2 MB with an AA skirt** (§11.3.9). A 2-vertex ribbon has **no
anti-aliasing at all** — it trades ragged edges for the overdraw it saves — and a
continuous strip still needs join handling at every point, which restores either
overdraw or geometry at exactly the places handwriting is densest.

**7. "Thermal throttling" is asserted, not shown.** No temperature, power or
clock data is presented, and the 8.3 ms budget is never compared against a
measured frame cost. What *can* be said is in §11.4: real GPU time is not
measurable on this hardware, so **neither the review's throttling claim nor
revision 2's "free" claim is established.** The honest position is that
overdraw is known and small after simplification, and the frame cost must be
measured with a GPU timer or ETW before either claim is believed.

### Adopted from the review

Stencil-buffer highlighter dedupe (D14), tombstone liveness bitmask (D9),
per-page binary chunks (D2), and the out-of-process recognition daemon (§5.3).
All four are genuine improvements and are now in the plan. Details, with the
caveats each needs, are in the sections cited.

---

## 1. What a research user does with a pen

| Use | Example | Needs |
| --- | --- | --- |
| **Meeting notes** | supervisor meeting, reading group | fast capture, later searchable, links to papers/notes mentioned |
| **Derivations** | working through a loss, a bound | maths that stays as ink, page can be long |
| **Margin notes on a paper** | annotating a PDF page | *already exists* in the reader; ink note can embed a page image |
| **Figures / architecture sketches** | encoder → prior → decoder | shapes, lasso-move, export to PNG for the report |
| **Whiteboard capture** | photo of a whiteboard | image + ink on top; recognition of the photo is out of scope |
| **Todo / decisions** | "re-run seed 43 before Friday" | checkbox stroke → `- [ ]`; decision lines → `> [!decision]` |

What follows:

1. **The text layer is the product.** Ink that cannot be found in `⌘P`, cannot
   be `[[linked]]`, and does not show in backlinks is a photo.
2. **Maths stays ink.** A derivation is read back as ink, not as LaTeX.
   Recognising it is a later, optional, cloud-backed engine (§5.2).
3. **Pages, not an infinite canvas.** Research notes are read in order and
   printed for a supervisor. Pages also give the recogniser a natural unit and
   keep one sidecar bounded.

---

## 2. What the best apps do, and which of it to take

Surveyed: GoodNotes 6, Notability, MyScript Notes (ex-Nebo), Apple Notes,
OneNote, Samsung Notes, Xournal++, reMarkable, Excalidraw, Obsidian InkedMark.

| Feature | Who does it best | Take? | Why |
| --- | --- | --- | --- |
| Searchable handwriting without converting | GoodNotes, Apple Notes, Samsung | **Yes — core** | the text layer, §4.2 |
| Convert-as-you-write to typed text | MyScript Notes | **No** | it fights the writer; recognise on stroke-end, show text beside, never replace ink |
| **Pressure/velocity taper** | GoodNotes, Samsung, Apple | **Yes, per point** | restored in this revision; ~13 kB compressed and the trail takes a per-event diameter (§0.2, §4.4). Tilt: no. |
| Scribble-to-erase | Apple Notes, GoodNotes | **Yes** | zig-zag over a word deletes it; cheap (§6.4) |
| Shape snap (draw, hold, straightens) | Apple Notes, GoodNotes, Samsung | **Yes, v2** | line, rect, ellipse, arrow |
| Lasso select → move / resize / copy / convert | everyone | **Yes** | needed to tidy a page |
| Zoom window (write large, lands small) | GoodNotes | **No** | tablet-first; desktop pen users zoom the page |
| Pinned audio synced to strokes | Notability | **No (later maybe)** | consent + storage growth are their own plan |
| Paper templates | GoodNotes, Xournal++ | **Yes, three** | blank, dotted, ruled; CSS background, zero storage |
| Infinite canvas | OneNote, Excalidraw | **No** | pages (§1) |
| PDF page insert, ink on top | Xournal++, GoodNotes | **Yes** | reuse the reader's page raster |
| Maths recognition | MyScript | **Optional cloud engine** | §5.2 |
| Palm rejection | OS on iPad/Samsung; app elsewhere | **Yes, three layers** | §3 |
| Straightening / "smart script" | Apple Notes | **No** | rewrites the user's hand |
| Ink-to-text of a *selection* | GoodNotes, OneNote | **Yes** | lasso → "Copy as text" / "Insert below" |
| Export page to PNG/PDF | everyone | **Yes** | figures for the report |
| Open file format | Xournal++ `.xopp`, Excalidraw JSON, InkedMark `.md` | **Yes** | markdown body + documented binary sidecar (§4) |

Two things nobody does that a research tool should:

- **Wikilinks in ink.** A recognised `[[Graph-prior module]]` resolves like a
  typed one. The recogniser is given existing titles as hints (§5.4).
- **Recognised checkboxes become tasks.** `☐`/`☑` at line start becomes
  `- [ ]`/`- [x]`, which the todo views already read.

---

## 3. Palm rejection

There is no web API for palm rejection. `PointerEvent` reports a resting palm
as an ordinary `touch` pointer, indistinguishable from a fingertip. On a device
whose OS handles it (iPad + Pencil, Samsung + S Pen, **Surface + Surface Pen**)
the palm never reaches the page. The reader already has layer one.

### 3.1 Layer one — pen seen, touch stops drawing (exists)

`use-page-pointer.ts:105-121, 229-241` — once any `pointerType === "pen"` event
has been seen, `touch` pointers never draw again for the session; they scroll.
One pointer owns a stroke (`inkPointerId`, `:395`). **Keep exactly this**, and
lift it into `features/ink/application/use-pen-capture.ts`. **But see §7 step
2**: the lift must also move the live stroke out of React state and into the
worker, or the slow pattern becomes the shared foundation of both features.

### 3.2 Layer two — touch that looks like a palm

| Signal | Threshold | Source |
| --- | --- | --- |
| contact area `width × height` | > 25 mm² → palm | `PointerEvent.width/height`. **These are CSS pixels, not millimetres** — document the threshold as a CSS-px² heuristic, or derive mm from `devicePixelRatio` and a nominal DPI. Do not silently mix units. |
| second `touch` while one is drawing | → both palm; cancel the first if < 150 ms old | multi-touch is never writing |
| touch in the lower-right (right-handed) / lower-left quadrant within 300 ms before or after a pen down | → palm | the hand precedes the pen. **The rule most likely to be wrong — it should be the first thing "Pen only" overrides.** |
| touch `pointerdown` with no move > 2 px for 120 ms | → palm | Apply to **`touch` only.** A `pen` pointer is never a palm and must start immediately; deferring a pen by 120 ms would add the exact latency this document exists to remove. |

A palm is ignored: no `setPointerCapture`, no `preventDefault`, so the browser
can still scroll. A stroke cancelled by a late palm decision is removed from
the draft, not saved.

### 3.3 Layer three — the user's hand

- **Wrist-guard "Pen only" toggle** in the ink bar. Default: on the first pen
  event. Stored per device in `localStorage`, not in the note.
- **Handedness** (right/left) in settings; only used by the quadrant rule.
- `touch-action: none` only while a pen is down or "Pen only" is on; otherwise
  `pan-y` so a finger scrolls a long page. The reader already flips this.

### 3.4 What is *not* done

No pressure-based rejection, no ML classifier, no `tiltX` guessing. Three
deterministic layers, each testable with synthetic `PointerEvent`s.

---

## 4. File format

### 4.1 Layout — markdown body plus per-page binary chunks

```
Supervisor meeting 11 Feb.md                     ← the note: frontmatter + text layer
.ink/01J…/                                       ← keyed by the note's weaveforge-id, not its title
  01JABC.inkb                                    ← page 1 strokes (columnar binary, brotli q5)
  01JABD.inkb                                    ← page 2 strokes
  01JABE.inkb                                    ← page 3 strokes
```

**One chunk per page, ordered by the note's frontmatter — not a manifest file.**
Revision 2 packed all pages into one blob, which creates an unresolvable
conflict the moment two devices edit different pages of the same note: no sync
engine (OneDrive, iCloud, Dropbox) or git can three-way merge an opaque binary,
so the user is asked to pick a winner and one device's work is lost. Separate
filesystem nodes make concurrent page edits **non-conflicting by construction**.

Two deliberate deviations from the review that proposed this:

- **No `manifest.json`.** Page order lives in the note's frontmatter (§4.2),
  which is markdown and therefore merges as *text* under the CRDT and under git.
  A separate JSON manifest would be one more file whose concurrent edits
  conflict, for no benefit.
- **Chunk filenames are ULIDs, not page numbers.** Renaming on reorder would
  touch every file and churn sync; order is metadata, identity is the filename.
- **The sidecar directory is keyed by `weaveforge-id`, not the title.** A
  rename must not move or orphan strokes, and two notes may share a title.
  The indexer already resolves a note by its id; the directory name is that id.

The cost is more inodes and more file-watcher events, which revision 1 rightly
flagged. It is worth it, and it is bounded: a 50-page note is 51 files, and
chunks are written only when their page changes.

The note:

```markdown
---
weaveforge-id: 01J…
weaveforge-type: ink_page
title: Supervisor meeting 11 Feb
updated-at: 2026-02-11T15:02:11Z
created-at: 2026-02-11T14:00:00Z
ink:
  pages: 3
  paper: dotted
  pageOrder: [01JABC, 01JABD, 01JABE]
  recognised: 0.94
  engine: windows-ink@1
  hand: right
---
Drop the β sweep for §3.2 — ranking unchanged. Structured prior instead,
see [[Graph-prior module]].

Open q: does the prior collapse when k > 16 ?

- [x] Re-run ablation, seed 43, before Friday

<!-- page 2 -->
![](vault:papers/kipf-2016/page-3.png)
Compare against [[VGAE]] table 2, not the appendix.
```

The body is the text layer (§4.2). Strokes are **never** in this file's text
(§4.6) — the editor renders `<!-- page N -->` markers and nothing else.

### 4.2 Body = text layer

One paragraph per recognised line group, in page order, `<!-- page N -->`
between pages. Everything that reads a note body — search index, wikilink
resolver, backlinks, wiki lint, mirror, git diff, quick-open preview — works on
an ink note unchanged. A user can correct a word in the Edit view and the
correction is kept: `lines[].text` in the sidecar is the *recognised* text, the
body is the *accepted* text; re-recognition never overwrites a body line whose
`confidence` was raised to `1` by a manual edit.

### 4.3 A chunk = binary columnar, compressed

**One page per chunk**, so the page table of revision 2's monolithic sidecar is
gone; each chunk is self-describing and independently loadable.

```
magic "WFIK" u8[4] | version u16 | flags u16 | pointCount u32 | strokeCount u32
page    : { w u16, h u16, paper u8, bg u8 }        // bg = index into attachments, 0 = none
strokeTable : { pointOffset u32, pointCount u16, width u8, tool u8, colour u8, t0 u32, lineIndex i16, shape u8 }
points      : Int16Array [ x0, y0, p0,  dx1, dy1, p1,  dx2, dy2, p2, … ]
lines       : { strokeStart u16, strokeCount u16, yMin i16, yMax i16, textHash u32, conf u8 }
texts       : UTF-8 blob for the recognised strings, referenced by offset
```

Coordinates are delta-encoded after the first pair, exactly as revision 1's JSON
was and revision 2's sidecar kept — the encoding was never the problem, the
*container* was. Loading is `new Int16Array(buffer, offset, count)`: **O(1), no
parse.** The real open cost of a compressed chunk is therefore the **inflate**,
which the harness did not time; step 1 measures it on the target CPU.

**Measured, dense page (5 000 strokes × 60 points):**

| Format | Size | Load |
| --- | --- | --- |
| JSON, `dx,dy,p` per point *(revision 1's first draft)* | 3.18 MB | 17.8 ms |
| JSON, `dx,dy` per point *(revision 1's constant width)* | 2.11 MB | 11.9 ms |
| **binary, `Int16` + pressure** | **1.77 MB** | **~0 ms** |
| **binary + brotli q5, with pressure** | **52.5 kB** | ~0 ms after inflate (inflate itself **not yet measured** — step 1) |
| **binary + brotli q5, no pressure** | **39.0 kB** | ~0 ms |
| binary + deflate L6, no pressure | 73.4 kB | ~0 ms |
| JSON + gzip (for contrast) | 372 kB | 12 ms |

**Per-point pressure costs 13.5 kB compressed.** That single number is why D3
restores variable width.

**Compression settings matter enormously.** Node's brotli defaults to quality
11, which took **3 272 ms** to produce 38.5 kB — unusable on a save path, and
enough to make the right answer look wrong. The knee:

| Codec | Size | vs JSON | Compress |
| --- | --- | --- | --- |
| brotli q1 | 69.6 kB | 31× | 1.1 ms |
| **brotli q5** | **39.0 kB** | **55×** | **6.1 ms** |
| brotli q6 | 38.7 kB | 56× | 9.7 ms |
| brotli q11 *(Node default)* | 38.5 kB | 56× | **3 272 ms** |
| deflate L6 *(browser-reachable)* | 73.4 kB | 30× | 7.3 ms |

**Pin brotli quality to 5.** Above q6 the extra bytes saved are noise and the
time is not. Choose the codec by runtime:

- **Desktop/Electron:** `node:zlib` brotli q5 — 39 kB, 6 ms.
- **Web:** `CompressionStream("deflate-raw")` or `fflate` (already a
  dependency) — 73 kB, 7 ms. CompressionStream does **not** expose brotli.
  If the web build needs the last 2×, ship a small zstd wasm; do not do that
  until measured.

Keep a `flags` bit for **uncompressed**: a small page (< ~64 kB uncompressed)
is stored raw, because inflating a 4 kB page costs more than it saves and the
sidecar is then readable by tooling.

> **Measured correction, step 1 (2026-09-11).** The container is built and the
> table above re-measured against the same harness data. Three things changed in
> the telling, and one of them changes a budget.
>
> 1. **"brotli q5, with pressure = 52.5 kB" is a quality-11 figure.** 52 487
>    bytes is what `brotliCompressSync` produced at its **default** quality in
>    `ink-gold-standard.mjs`; the companion row (39.0 kB, q5) comes from
>    `ink-compression-levels.mjs`, a slightly different generator. Re-measured at
>    the q5 this section pins, the harness's own 300 000-point page is **74.5 kB**
>    without pressure and **87.4 kB** with it — the same bytes, the right label.
> 2. **The harness's generator is not a handwriting model.** Its LCG multiplies
>    past 2⁵³, so successive draws are far more predictable than noise, which is
>    why 300 000 coordinates compress to tens of kilobytes. A page built the way
>    §4.4 says one is stored — 5 000 handwriting-shaped strokes, simplified to
>    **12.8 points a stroke** — costs **188 kB at q5 with per-point pressure**
>    (142 kB without) against **1 108 kB** of equivalent JSON: **~6×**, not 55×.
>    That page carries roughly 150 kB of genuine entropy, so no container gets
>    under it. **D3 still stands** — variable width is worth 46 kB a page here,
>    not 13.5 kB — but the *absolute* per-page figure to plan against is
>    hundreds of kilobytes.
> 3. **The budget in §4.7 survives this; the "~150 dense pages" gloss does not.**
>    8 MB compressed is about **forty** pages of that density, which is still
>    consistent with 50 pages a note, and the soft 5 000-stroke cap is what keeps
>    it so.
>
> 4. **The point array stays `Int16 [x, y, p, …]` interleaved, as sketched.** A
>    three-plane split was measured and is *worse*: 85.3 kB against 71.6 kB at q5
>    on the harness page, because a `0x00` high byte between every pair of
>    coordinate deltas is cheaper to code than three separate streams. The
>    container stores the sketch's layout, checks the sketch's every offset, and
>    inflates a 300 000-point page in **2.4–3.2 ms**.

### 4.4 Stroke fields

| Field | Meaning |
| --- | --- |
| `tool` | `0` pen, `1` highlighter, `2` shape |
| `colour` | **palette index** into `text \| accent \| warn \| good \| info \| danger` — never a hex (the redesign's palette rule) |
| `width` | base nib width, 0.1 mm (`6` = 0.6 mm pen, `60` = 6 mm highlighter) |
| `t0` | stroke start, ms from page creation — segmentation needs gaps, not per-point time |
| `p` | **per-point pressure**, `Uint8` 0–255. Drives the variable-width nib. |
| `shape` | optional, on snapped strokes (§6.3) |
| `lineIndex` | segmentation output (§5.4) |

Coordinates are **integers in 0.1 mm** (a PDF point is ~0.35 mm; 1/10 of that
is well below what the eye resolves at 100 % zoom). Points pass through the
reader's existing budget (`shouldAppendInkPoint` → RDP `compactInkPath` →
`INK_MAX_POINTS`).

A stroke's rendered width at point *i* is `f(width, p[i], velocity[i])`
(§6.2.5) — the calligraphic taper GoodNotes produces. Because the first
geometric RDP pass is pressure-blind, run a second, pressure-aware pass before
packing: a point whose pressure deviates from the linear interpolation of its
surviving neighbours by more than a threshold must be kept, or taper is lost
while the centreline stays correct.

### 4.5 Recognised lines

Per page: which strokes make which line, its y-band, its text and confidence.
Kept so a correction maps back to strokes, a lasso can "copy as text", and
re-recognition can be incremental. Stored in a small parallel array in the
sidecar, not in the markdown body.

### 4.6 The stroke data is not in the collaborative document

**Still the single most important correctness decision, and unchanged from
revision 1.**

The original plan asserted that Markdown and CodeMirror "treat a fenced block
as opaque… neither learns anything." Opaque to the *parser* is not opaque to
the *editor*. In the current code:

- `apps/web/src/features/collab/ui/collaborative-markdown-editor.tsx:167-168`
  runs `yText.observe(onYText)` → `scheduleSave(yText.toString())`. The
  `toString()` is **eager on every change**; only the persist is debounced
  (`SAVE_MS = 1500`, `:17`).
- The save writes the **entire body** (`:91-94`).
- `apps/web/src/features/collab/domain/seed-document.ts:30-37` inserts the whole
  body into a throwaway `Y.Doc` and `Y.encodeStateAsUpdate`s it — a full CRDT
  encode on open.
- The editor is built as `EditorState.create({ doc: yText.toString() })` with
  `lineWrapping()` (`:170-179`). A multi-megabyte **single line** with wrapping
  is the worst case for a line-based editor.
- **No body-size cap exists.** The only `MAX_BODY_BYTES` constants in the tree
  are for blob/artifact/MCP uploads.

Measured (real CodeMirror 6, markdown + `lineWrapping`):

| Ink JSON as one line | `EditorState.create` | **first paint** | keystroke+paint |
| --- | --- | --- | --- |
| 137 kB — typical page | 24 ms | 334 ms | 74 ms |
| 3.13 MB — dense page | 33 ms | **1 333 ms** | 17 ms |
| 23.6 MB — revision-0 worst case | 178 ms | **8 483 ms** | 46 ms |

The Read view is unaffected (it is `VaultMarkdown`, not CodeMirror), but §4.2
promises correction in the Edit view.

**With the binary sidecar (§4.1) this problem disappears rather than
shrinking** — there is no large text in the document at all. That is a stronger
fix than revision 1's, which kept a fenced block in the body and merely capped
it. Supporting changes in the same PR:

- `yText.observe` must stop calling `yText.toString()` eagerly.
- Saves should compare a cheap digest (length + rolling hash), not full strings
  — `shouldPersistBody`'s current string compare is a multi-megabyte scan per
  change once bodies are large.

### 4.7 Size budgets

| Quantity | Budget |
| --- | --- |
| **Sidecar per note** | **8 MB compressed**, hard. At 39–53 kB/page that is ~150 dense pages. |
| Strokes per page | 5 000 (soft) — beyond it, warn and continue |
| Points per stroke | `INK_MAX_POINTS` = 400, unchanged |
| Pages per note | 50, unchanged — now consistent with the byte budget, which revision 1's was not |
| Compression | brotli q5 (desktop) / deflate-raw (web); raw below 64 kB |

A note over budget refuses new strokes with a status-bar message. Revision 1
had three caps that contradicted each other (a 23.6 MB page against a 20 MB
note cap); with compression the page cap and the note cap agree with room to
spare.

### 4.8 Remaining format rules

- **Attachments stay attachments.** An inserted PDF page or photo is an
  `![](vault:…)` in the body and a `bg` entry in the sidecar; the raster lives
  in the vault attachment folder as today. Nothing binary in the markdown.
- **Zotero stays out of it.** Reader ink is a Zotero annotation shape (PDF
  space, width-only, no tool field — `ink-stroke.ts:62-72`). Ink notes are not
  synced to Zotero; reader-ink → ink-page is a one-way helper.
- **Suffix**: `ink_page` → `.ink.md` in `KIND_SUFFIX`
  (`packages/core/src/workspace/folder-layout.ts`) — one row, the only core
  change in step 1. The sidecar is a second file; the note stays `.md` so the
  vault's resolvers keep working.
- **Evict aggressively.** Do not hold every page's geometry: a 50-page dense
  note is ~90 MB of decoded `Int16` points, ~43 MB of float geometry, plus GPU
  buffers. Keep the compressed buffer, decode a page on demand, and drop GPU
  buffers for pages out of view.

---

## 5. Recognition

### 5.1 The interface

```ts
// packages/core/src/ink/recognise.ts — pure types, no engine
export interface InkLine { strokes: InkStroke[]; yBand: [number, number] }
export interface RecognisedLine { text: string; conf: number; alternatives?: string[] }
export interface InkRecogniser {
  readonly id: string;              // "windows-ink@1" | "stroke-ctc-small@1"
  readonly offline: boolean;
  readonly online: boolean;         // consumes stroke trajectories, not bitmaps
  available(): Promise<boolean>;
  recognise(lines: InkLine[], hints: { vocabulary: string[]; lang: string }): Promise<RecognisedLine[]>;
}
```

`online` is new and load-bearing: it tells the UI whether the engine can use
`(x, y, t, pressure)` directly. An ink note with no engine is a valid note —
title from frontmatter, links typed by hand, strokes only.

### 5.2 Engines, in order

| Engine | Where | Offline | Cost | Status |
| --- | --- | --- | --- | --- |
| **Windows Ink (`InkAnalyzer`)** | desktop IPC, Windows only | **yes, already installed** | free; 0 MB download; ~20 ms per page | **v1 desktop engine.** The OS has the engine, the language models and the shape/math recognisers. Reached from Electron via a native addon (§5.3). |
| **Online stroke model (CTC / stroke transformer)** | web + desktop fallback, WASM in the existing worker | yes | 3–10 MB weights, <100 ms/page | **v1 web engine.** Consumes the raw trajectory. |
| Chromium Handwriting Recognition API | `navigator.queryHandwritingRecognizer`; **verified absent** on Windows/Electron (§11.2) | yes | free | Use when `available()`. On-line. Wrapped, never relied on. |
| ~~TrOCR (image OCR)~~ | — | — | 240–330 MB, **6–20 s/page** | **Removed from v1.** Retained only as a documented last-resort experiment if both online engines prove inadequate on a real hand (§0.2, §11.3.6). |
| MyScript iink (cloud) | iinkTS SDK, key required | no | paid | **Opt-in only**, for maths → LaTeX and many languages. Off by default; the note records `engine: myscript` so a reviewer knows text left the machine. |

Privacy line: engines 1–2 never send strokes anywhere. Engine 5 does, and the
first use shows one dialog that says so, once.

### 5.3 Why online recognition, and what the native addon costs

**Online recognition wins because the information is already there.** A stroke
is a trajectory: direction, order, speed, pen-up gaps, pressure. Image OCR
throws all of it away and re-infers it from pixels — which is why it needs a
330 MB ViT and still takes seconds. Windows Ink has been solving this from the
trajectory since Windows 7, offline.

**Honest cost of the desktop path.** `InkAnalyzer` is WinRT; Electron cannot
call it from JS directly. Options considered:

1. **A bundled helper executable** (C#/WinRT, ~100 lines), spawned once per
   session over stdio with a newline-delimited JSON protocol. **Chosen.** No
   Electron ABI coupling, no prebuild-per-Electron-bump, and a crash in the
   recogniser kills the helper, not the app. Cost: a second process, one IPC
   round-trip per page, and a per-arch (x64 + arm64) build of the helper —
   which the electron-builder config already targets.
2. A C++/WinRT N-API addon. Rejected: a native addon crash is an app crash,
   and it needs a rebuild on every Electron ABI bump — the maintenance line
   item this revision would rather not own.
3. `node-api-dotnet` / `edge-js`. Rejected: heavier than the helper for the
   same ABI coupling as option 2.

This is a **real dependency** the desktop app does not have today — revision 1
priced that correctly and then declined to pay it. Given that it removes a
330 MB download and a 6–20 s wait, it is worth paying. Budget it as its own
step (§7 step 3), and **keep the web engine working on desktop too**, so a
missing or broken helper degrades to a slower recogniser rather than to nothing.

### 5.4 Segmentation and hints — the parts that make a bad hand work

- **Line segmentation** (`packages/core/src/ink/segment.ts`): sort strokes by
  first-point time; a stroke joins the current line if its y-centre is within
  0.6 × the running median stroke height of the line's y-band and it started
  within `INK_GROUP_WINDOW_MS` (2 s); else it starts a new line. Highlighter
  and shape strokes are never segmented. Re-sort top-to-bottom for the body.
- **Vocabulary hints.** Windows Ink accepts a word list as a recognition guide
  — a genuine advantage over an image model, which has none. Pass existing
  note/paper/list titles and citation keys. For engines without hint input,
  keep the post-match: Damerau–Levenshtein ≤ 2 per word, ≤ 25 % of the span,
  against `[[…]]`-shaped spans and titles; a match rewrites to the exact title.
- **Symbols researchers write:** `β`, `§`, `→`, `≤`, `∈`. Windows Ink's math
  recogniser covers much of this natively; for other engines keep a small,
  listed, reversible post-map (`->` → `→`, `<=` → `≤`), and do **not** attempt
  general maths → LaTeX here.
- **Confidence.** Map each engine's score to `[0,1]`. Lines with
  `conf < 0.75` render with a dotted underline in the text-layer column;
  clicking shows alternatives and a text field. Accepting writes the body and
  sets that line's `confidence` to `1`.
- **When it runs.** On the **first** recognition of a page: **on demand, with
  per-line progress**, never a background surprise while writing. After that,
  debounced 1500 ms for changed lines only, plus a "Recognise page again" menu
  item. Recognition is always off the pen thread.

### 5.5 Verify before committing

The corrected engine plan rests on two claims **not** measured on this machine:
the Windows Ink per-page time, and the web stroke model's accuracy. Neither is
in doubt in principle, but both must be measured before step 5 (§9 items 9–10):

- Windows Ink end-to-end through the chosen IPC path, on a real 20-line page.
- Corrections-per-line across 10 real pages, per engine. If either averages
  > 1 correction per line, escalate — within the online family, not back to
  image OCR.

---

## 6. The ink view

`document-host.tsx` gains one case: `kind === "ink_page"` → `InkHost`.

### 6.1 Layout

```
┌ ink bar ─────────────────────────────────────────────────────┬──────────────┐
│ Pen · Highlighter · Eraser · Lasso │ ● ● ● │ Shape │ ⤓ PDF page │ Recognise  │ page 1 / 3 · pen · pressure │
├──────────────────────────────────────────────────────────────┼──────────────┤
│                                                              │ Text layer   │
│   page  (WebGL2 canvas, owned by the ink worker)             │ 94 % · 2 unsure │
│                                                              │              │
│   scrolls vertically page after page                         │ recognised   │
│                                                              │ lines, links │
│                                                              │ live, low-   │
│                                                              │ conf dotted  │
└──────────────────────────────────────────────────────────────┴──────────────┘
status bar: Page 1/3 · 184 strokes · Pen · pressure on · Recognised 94 % · Ink
```

The right column is the text layer, not a minimap. Same width as the minimap
column so panes line up when split. Hidden below 1100 px, toggleable from the
ink bar.

**Stacking:** the ink canvas must be the topmost element in the page area, and
the text-layer column and ink bar must be siblings *outside* the page
container — a translucent `desynchronized` canvas with DOM above it silently
loses the low-latency path (§6.2.8).

### 6.2 Rendering — WebGL2 in a worker

Revision 1 kept drawing on the main thread and leaned on bitmap caching, dirty
rects and blits to hide Canvas 2D's full-re-raster cost. That was a defensive
repair. This is the pipeline it should have been.

#### 6.2.1 Measured baseline

5 000 strokes / 295 000 segments, A4 at 2× DPR, real GPU:

| Operation | WebGL2 | Canvas 2D (rev 1) |
| --- | --- | --- |
| draw / redraw, geometry resident | **< 0.001 ms** | 258–327 ms |
| pan (uniform update + draw) | **< 0.001 ms** | ~0 ms (blit) |
| zoom | **< 0.001 ms, crisp** | ~0 ms (blurry scaled blit, then async re-raster) |
| upload after geometry change | 0.5 ms (5.9 MB instanced) | n/a |
| geometry build, one-time JS | 22.7 ms (instanced) | 17–23 ms (outlines) |
| erase / undo | drop an instance range | dirty-rect re-raster from vectors |

Consequences: **pan and zoom need no special machinery, no blurry frame and no
per-page bitmap.** Erase and undo are buffer edits, not repaints. The only
non-trivial remaining cost is the JS geometry build — 22.7 ms for a whole dense
page, and **incremental per stroke** in normal use.

#### 6.2.2 The worker owns the pipeline

```
MAIN THREAD (thin, never renders ink)
  pointerrawupdate → getCoalescedEvents()
                     (+ getPredictedEvents() ONLY on the fallback path — D11)
  → 1-Euro filter on position and pressure (D13) → instantaneous nib width
  → delegated path: presenter.updateInkTrailStartPoint(e, { color, diameter: w })
  → postMessage samples to the worker (batched per frame, §6.2.13)

INK WORKER  (OffscreenCanvas, transferControlToOffscreen)
  WebGL2 render loop, requestAnimationFrame
  live stroke appended to a dynamic vertex buffer
  committed strokes resident in GPU buffers
  pan/zoom = uniform update
  picks (eraser, lasso) via the spatial index
  writes back only stroke-complete events and text-layer updates
```

Why the worker is not optional: this app's main thread runs React, CodeMirror,
Yjs, file indexing and wiki lint. Measured main-thread tasks here reach
**16–74 ms** (§11.3.1) — one CodeMirror keystroke is 2–9 dropped frames at
120 Hz. Whatever the renderer is, it must not be in that queue. The worker also
means a page-level handler doing DOM work cannot stutter the pen.

Cost: `pointerrawupdate` must still be handled on the main thread (the canvas
element lives in the DOM) and forwarded. That per-event cost is a coordinate
read and a `postMessage` — microseconds — and the Delegated Ink Trail covers
the gap if the main thread stalls.

#### 6.2.3 Geometry model

- Per page, in the worker: a `Float32Array` of `x, y` plus a parallel
  `Uint8Array` of pressure and a stroke table, decoded from the `Int16` sidecar
  once, on demand.
- **Expansion to triangles happens on the GPU.** Upload per-stroke points and
  per-stroke width once; generate the strip in the vertex shader with
  `gl_VertexID`/instancing so the CPU never materialises 1.77 M vertices.
  Measured upload for the points alone: **2.4 MB, 0.2 ms** — versus 14.2 MB and
  61.7 ms to build a triangle soup in JS. **Never build a soup.**
- **Batching is correct here.** Revision 1's "never batch" warning was about
  Canvas 2D `Path2D`, where one huge path is pathological (1 400 ms). In WebGL,
  many strokes in **one instanced draw call** is the point and costs nothing.
- **Joins and caps are analytic, not geometric.** Do **not** add a second
  instanced pass of join discs. Use a single instanced pass whose fragment
  shader computes the distance to the segment and discards outside it:

  ```glsl
  // per-fragment, for segment [A,B] with radius r
  vec2 pa = p - A, ba = B - A;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * t);
  float alpha = 1.0 - smoothstep(r - fw, r + fw, d);   // fw = 0.5 * fwidth(d)
  ```

  Each instance is a quad enclosing the segment plus `r`. This gives round caps
  and round joins for free, **free sub-pixel anti-aliasing** via `fwidth`, no
  notch geometry, and half the draw calls of the two-pass approach. It also
  removes a bug the geometric approach has: overlapping join discs z-fight and
  double-blend.

  **The cost of SDF is overdraw, and it is known.** The quad must be inflated by
  the radius *plus* the AA margin, so adjacent quads overlap — worst where
  handwriting is densest. Measured by additive accumulation and `readPixels`
  (§11.3.9):

  | Geometry | Quad overdraw (mean, and over covered px) | Peak |
  | --- | --- | --- |
  | raw 60 points/stroke — live-stroke density | 8.47 / 9.95 | 75 |
  | simplified 16 points/stroke | 3.09 / 4.06 | 31 |
  | **simplified 8 points/stroke — a committed page** | **1.83 / 2.70** | 19 |

  What the engine draws is the **simplified** form, so the realistic figure is
  **~1.8–3.1×**. A review claimed 10–15× and attributed a 3.2 ms frame cost to
  this document; neither is supported (§0.3). Two levers keep it small, both
  already in the plan: **simplify before committing** (§4.4), and **keep the AA
  margin to ~1 px** rather than inflating generously.

  A triangle-ribbon renderer was proposed as the alternative. **Not adopted for
  v1**, for three reasons: a 2-vertex ribbon has *no* anti-aliasing (it trades
  ragged edges for the overdraw it saves); a continuous strip still needs join
  handling at every point, which restores overdraw or geometry exactly where the
  path bends hardest; and WebGL2 has **no geometry shader**, so extrusion is CPU
  work at stroke end — measured at **53.6 ms** to build 5 000 stroke ribbons,
  **98.7 ms** with an AA skirt, plus **7.1 MB / 21.2 MB** of index buffers
  against 5.9 MB for the instanced form (§11.3.9). Keep the renderer behind one
  interface (§6.2.10) so a ribbon path can be added if a real GPU profile ever
  shows SDF fill rate is the limit.

  **If profiling does show fill rate matters:** render the *live* stroke with a
  cheaper shader (it is one stroke, never 5 000) and cap simultaneously visible
  pages. Do not pre-emptively trade away anti-aliasing.

  **One caveat the SDF does *not* fix**, and it matters for the highlighter:
  per-segment quads still **overlap at every joint**, so a translucent stroke
  drawn directly to the target double-blends at each overlap and beads darker.
  The SDF fixes geometry, not compositing. So:

  - **Pen** (opaque, `alpha = 1`) → single-pass SDF straight to the target.
  - **Highlighter** (translucent) → **hardware stencil buffer**, not an offscreen
    FBO. Request `stencil: true` on the context; per frame clear stencil to 0,
    then `stencilFunc(EQUAL, 0, 0xFF)` + `stencilOp(KEEP, KEEP, INCR)` and draw
    the highlighter instances with multiply blending directly to the backbuffer.
    The first fragment on a pixel passes and sets the bit; every later
    overlapping fragment is rejected by fixed-function hardware **before the
    fragment shader runs**. This replaces a full-resolution RGBA target
    (~**22 MB** at 2880 × 1920) plus a full-screen composite per frame with one
    stencil clear.

    **State the semantics deliberately:** global `EQUAL 0 / INCR` dedupes across
    *all* highlighter strokes in the frame, so two different highlighter strokes
    crossing do **not** darken at the crossing. Per-stroke dedupe would need
    stencil isolation per stroke (a scissored clear, or cycling reference
    values), which costs more than it is worth. One density for all highlighter
    ink is the intended look — but it is a choice, so it belongs in the tool's
    description.

    **If an offscreen target is ever needed anyway** (export, or the fallback
    renderer), attach a depth-stencil renderbuffer — a colour-only FBO has no
    stencil and the pass will silently fail to dedupe.
- **Eraser** is stroke-level: remove the instance range, compact or swap with
  the last instance. No repaint.
- **Text is never drawn on the canvas** — the text layer is DOM. A real
  advantage here: no font atlas, no glyph cache.

#### 6.2.4 Spatial index for picking

Eraser and lasso need "which strokes are near this point/region". Use an
**R-tree over stroke bounding boxes** (`flatbush`, ~3 kB) — it needs no
cell-size tuning, handles a 2 cm highlighter stroke and a 1 mm dot in the same
structure, and keeps diagrams and margin scribbles fast. A uniform grid was
revision 1's choice; measured, a 10 mm grid left **mean 785 / max 1 623 strokes
per occupied cell** on a dense page (§11.3.7) — it did not index. Query by the
nib radius intersected with the pointer's swept segment; assert **≤ 50
candidates** on a 5 000-stroke page.

`flatbush` is a new dependency: 3 kB, MIT, **static** — it has no update or
delete, only rebuild. Bending the no-new-deps rule here is deliberate; the
alternative is a hand-written tree with the same bugs. But "static" is the trap:
**do not rebuild it during a gesture.**

**Tombstone the index; rebuild on `pointerup`.** An eraser sweep delivers
120–240 events/sec and can remove dozens of strokes, and rebuilding a packed
Hilbert R-tree per removal re-sorts every bounding box and allocates fresh
`Float64Array`/`Uint32Array` buffers each time — continuous typed-array churn
and GC inside the worker, during the gesture. Instead:

1. Keep the R-tree immutable for the duration of the stroke/erase gesture.
2. Keep a parallel `Uint8Array` **liveness bitmask**, one bit per stroke.
3. On a hit, clear the bit — **O(1), zero allocation** — and swap the stroke's
   GPU instance range with the tail of the draw buffer so it stops rendering
   immediately.
4. Skip dead entries when consuming query results.
5. **Rebuild the R-tree once, at `pointerup`**, consolidating every removal into
   a single pass.

Assert both halves: `stroke-index.test.ts` requires **≤ 50 candidates** on a
5 000-stroke page *and* **zero index allocations across a 200-event simulated
erase sweep**.

#### 6.2.5 Variable-width nib

Per point: `w_i = f(baseWidth, pressure_i, velocity_i)`. Pressure gives the
light/heavy response; velocity gives the natural thinning on fast strokes that
makes handwriting look written rather than drawn. Both are in the sample stream
already. The GPU expands the strip at `w_i` per point, so the taper is free —
this is the case WebGL makes easy and Canvas 2D made expensive, which is the
second reason D3 is affordable.

**Adaptive 1-Euro filtering on pressure *and* position (D13).** Revision 2
banned position filtering outright. That was wrong, and the fix is the filter
itself: an active digitiser is a physical sensor grid, not a mathematical
vector, and it reports sub-pixel quantization from grid pitch, electromagnetic
ripple, and hand tremor. Unfiltered, slow deliberate writing shows visible
staircasing. A **1-Euro filter** (Casiez et al. 2012) resolves the trade rather
than picking a side, because its cutoff frequency rises with speed:

```
fc = fcMin + β · ‖dx/dt‖        // slow → heavy damping; fast → filter phases out
```

- At low velocity `fc → fcMin` (order 1 Hz): damps grid stepping and tremor.
  The lag this adds is real but imperceptible *because the pen is not moving* —
  which is exactly why revision 2's blanket ban was the wrong call.
- At high velocity `fc → ∞`: lag approaches zero, so fast strokes are not
  retarded or "rubber-banded".

Tune `fcMin` and `β` on the device, not in the abstract; start near the
literature values (`fcMin ≈ 1 Hz`, `β ≈ 0.007`) and record the chosen pair in
the PR. Apply the same filter shape to the pressure channel (lower `fcMin`).

**One filter, one state, on the main thread.** The trail (§6.2.6) needs a
diameter now and the worker needs the width it bakes into geometry. If the two
filter separately — or only one filters — the trail and the committed stroke
disagree and the seam reappears. The worker uses the filtered values as given.

**Splines: deferred, with a reason.** Centripetal Catmull-Rom interpolation
(α = 0.5) is the standard way to avoid polygonal facets between 240 Hz samples,
and it is worth doing — but note an interaction with D7: the **delegated tail is
drawn by the OS through the same sample points**, roughly straight between
them. If the app fits a spline that visibly departs from the polyline, the wet
tail and the dry ink disagree in *shape*, which is the same class of artifact as
the width pop revision 1 worried about. It is one frame's worth of divergence, so
it is likely invisible — but it is measurable, and it is why spline fitting is a
step-8 quality item gated on the on-device comparison (§9), not a v1 default.

#### 6.2.6 Delegated Ink Trail — or desynchronized canvas, never both

`navigator.ink.requestPresenter()` lets the OS compositor draw the segments
between the last rendered frame and the pen tip. Enabled by default since
**Chrome 92**; present in Electron 33 (§11.2). On a Surface this is the single
biggest pen-feel lever — Microsoft rates the Surface Slim Pen 2 at **9 ms** on
Surface Pro 11 — but it is one of two **mutually exclusive** low-latency paths,
not a layer on top of the other.

**Read the non-goals, not just the API surface.** The explainer that produced
this API states three exclusions that bind the implementation (§0.3):

| Non-goal | Consequence |
| --- | --- |
| *Co-exist with desynchronized canvas* | Canvas is `desynchronized: false` on this path. Desynchronized canvas exists to **bypass** the compositor the trail **uses**; running both puts two presentation paths out of phase. |
| *Co-exist with input prediction* | **Do not call `getPredictedEvents()` while delegating.** The OS is already rendering points the app has not seen; predicting too produces a visual "fork". |
| *Take over all ink rendering* | The trail covers "the last few pixels" only. The app still renders the committed stroke and the dry ink. |

So the branch is explicit:

```
presenter available AND expectedImprovement worthwhile
  → canvas: { desynchronized: false }
  → pointerrawupdate + coalesced events ONLY (no getPredictedEvents)
  → presenter.updateInkTrailStartPoint(e, { color, diameter })
  → samples posted to the worker

otherwise (Firefox, Safari, no presenter, or low expected improvement)
  → canvas: { desynchronized: true }
  → pointerrawupdate + coalesced + PREDICTED
  → no presenter calls
```

Note the API has drifted since the archived explainer:
`requestPresenter({ presentationArea })` and
`updateInkTrailStartPoint(event, { color, diameter })` are the WICG shapes;
the explainer's `requestPresenter(type, area)` / `setLastRenderedPoint` /
`radius` / `expectedImprovement` are the older proposal. **Code against the
WICG spec** (§12.1). Where `expectedImprovement` is unavailable, gate on
`availability` plus a measured on-device check (§9).

```ts
// main thread, in the pointerrawupdate handler — NOT after a worker round-trip:
presenter.updateInkTrailStartPoint(e, {
  color,
  diameter: nibWidth(filteredPressure(e), velocityAt(e)),   // instantaneous
});
// ...and only then hand the sample to the worker.
```

**Coordinate space.** `updateInkTrailStartPoint` takes the raw `PointerEvent`,
so the trail is drawn where the *event* is, in the canvas's CSS client space.
The worker projects the same sample through its own transform (DPR × zoom ×
pan, §6.2.5). These must agree to the pixel or the trail and the committed
stroke visibly diverge at pen-up. Rules: the `presentationArea` is the ink
canvas element itself; the worker's projection is derived from the *same*
`getBoundingClientRect()` + `devicePixelRatio` + view transform the main thread
uses, re-posted on every resize/zoom/pan; and the seam is checked on device at
DPR 1, 1.5 and 2 with CSS zoom applied (§9 item 4).

**Dispatch immediately.** An earlier draft said "on each render frame, after the
worker has drawn up to `e`". That is wrong: waiting for the worker to confirm
injects a whole IPC round-trip into the wet tail, which is the one path that
must not have latency. Call it inline in the pointer handler.

**But pass the last point that is actually on screen, not the newest sample.**
The API means "the last rendering point for the current frame" — the presenter
draws the gap from there to the pen tip. Passing a point the worker has not
rendered tells the compositor to start drawing *after* a region the app has not
painted, and you get a visible gap. So:

- Track the last sample **posted** to the worker. The worker draws on its own
  `rAF` and its per-frame geometry work is far below the frame budget
  (§11.3.9), so the last posted point is the last rendered point by the time the
  compositor composites.
- Have the worker post back a **one-byte progress counter** (or write it to a
  `SharedArrayBuffer` where one exists — §6.2.13) after each frame. If it shows
  the worker more than one frame behind, fall back to the last **confirmed**
  point until it catches up. That is the only case in which worker progress is
  allowed to influence the trail, and it is a byte read, not a round-trip.

Revision 1 rejected variable width because it believed this API forced a
constant diameter and would produce a "width pop" at pen-up. The trail covers
**one animation frame** — a few millimetres at most — so passing the
instantaneous width makes the seam sub-pixel. The WICG example passes a
pressure-derived diameter. Passing the *filtered* width (§6.2.5) is what makes
it match the committed stroke. Two further constraints:

- **Dry and wet ink must not double-draw in the same frame**, or translucent
  highlighter strokes flash darker. That is the API's stated motivation.
- It is absent on Firefox/Safari — guard it and degrade to the fallback path.

**Why immediate dispatch is safe here:** the canvas is *synchronized* on this
path, so the worker's swapchain and the DWM-composited wet tail are both
phase-locked to the panel's VSync. That is the opposite of revision 2's
rationale, which claimed the two merge *because* they were desynchronized and
therefore unphased.

#### 6.2.7 Capture: raw, coalesced, and prediction only off the delegated path

> **Prediction is conditional (D11).** `getPredictedEvents()` is used **only**
> when the Delegated Ink Trail is *not* active. Delegating and predicting at the
> same time forks the rendering — the OS draws ahead and the app draws ahead
> differently. §6.2.6.

- **`pointerrawupdate`** for un-throttled samples; it fires before
  `pointermove` and batches into rAF.
- **`getCoalescedEvents()`** returns the events coalesced *into* the dispatched
  one — it does **not** include the dispatched event itself. Render both, or the
  newest sample is dropped every frame.
- **`getPredictedEvents()`** extrapolates 1–2 frames ahead from digitiser
  dynamics. Use it for the tail of the live stroke so the drawn ink keeps up
  with the nib where delegation is unavailable, or during fast sketching.
  Revision 1 listed this as available and then did not use it.
- **Draw incrementally**: append only the new segments to the dynamic vertex
  buffer each frame. Measured on an in-progress 1 000-point stroke, clear +
  redraw + flush: whole polyline **4.8 ms**, incremental **0.5 ms**. Width
  choice is irrelevant here; incrementality is worth 10×.
- At `pointerup`: simplify, append to committed geometry, notify the main
  thread. Never inline in the pointer handler.

#### 6.2.8 Canvas attributes and the readback rule

**WebGL2 context attributes — choose by path, and set them at creation:**

```ts
// delegated path (the presenter is active)
{ alpha: false, antialias: false, stencil: true, desynchronized: false }

// fallback path (no presenter: Firefox/Safari, or delegation unavailable)
{ alpha: false, antialias: false, stencil: true, desynchronized: true }
```

`stencil: true` is required for the highlighter pass (§6.2.3). `desynchronized`
follows §6.2.6 — passing `true` on the delegated path puts two presentation
paths out of phase, which is the bug revision 2 shipped. `preserveDrawingBuffer`
only if a readback is genuinely needed (it is not, on the primary path: export
renders to an offscreen target, §6.2.12). **Attributes are immutable after the
first `getContext`, and the first call wins silently** — decide the path before
creating the context, and if the path can change at runtime (a presenter that
appears late), recreate the canvas rather than trying to flip the attribute.

**Canvas 2D rules — these govern the fallback renderer (§6.2.10) and any
offscreen rasterisation** (thumbnails, export, recognition striping). WebGL2 has
no equivalent of Chromium's 2D software-fallback heuristic, so this is moot on
the primary path, but it is not optional where 2D is used:

- Create every 2D canvas with explicit
  `{ willReadFrequently: false, alpha: false, desynchronized: true }` — except
  that `desynchronized` follows the same path rule as above when the 2D canvas
  *is* the ink surface (fallback path only).
- **Never read back from a canvas that is being drawn to.** Chromium silently
  drops such a canvas to software rendering after as few as **two**
  `getImageData` calls; measured, redraws went from **12.7 ms to 61.4 ms** and
  never recovered (§11.3.2).
- Add a test that fails if `getImageData`/`toBlob`/`toDataURL` touches a
  drawing canvas.

#### 6.2.9 Context loss

WebGL on integrated graphics can lose its context (driver reset, GPU hang,
switching GPUs). This is the main new failure mode of D4 and must be built in,
not retrofit:

- Listen for `webglcontextlost` (prevent default) and `webglcontextrestored`.
- All state is reconstructible from the sidecar plus the worker's geometry
  arrays, so recovery is "re-upload buffers", not "recover user data".
- While lost, fall back to the Canvas 2D renderer (§6.2.10) and say so in the
  status bar. The user keeps writing.
- Never let a context loss discard an uncommitted stroke.

#### 6.2.10 Fallback renderer

Keep the renderer behind one interface (`ink-renderer.ts`): a WebGL2
implementation primary, a Canvas 2D implementation for context loss and for
machines/drivers where WebGL is unavailable or blocklisted. The Canvas 2D path
is what revision 1 specified (incremental live stroke, per-page bitmaps, blit
pan, dirty-rect erase, the §6.2.8 rules) — keep that design as the fallback,
and keep its measured budget as the reason it is the fallback and not the
primary.

#### 6.2.11 Memory

- A 50-page dense note is ~90 MB as decoded `Int16` points and ~43 MB as float
  geometry. Keep the **compressed** buffer resident (~2 MB for the whole note at
  39–53 kB/page) and decode pages on demand.
- GPU buffers for out-of-view pages are freed; a page's R-tree is rebuilt on
  demand (sub-millisecond).
- Budget against `performance.memory` **on the Surface Pro**, not a dev desktop.

#### 6.2.12 Save and export

- **Save**: debounced 1500 ms, in the worker or a separate one — pack, compress
  (brotli q5 ≈ 6 ms), write. The main thread never sees the bytes.
- **Export**: render the page to an offscreen framebuffer at print DPR and read
  it back **once**, into a fresh canvas never drawn to afterwards. Reading back
  from the *live* WebGL canvas is what `preserveDrawingBuffer` is for, and it
  costs compositing performance — prefer an offscreen target.
- **Paper**: CSS background on the page element (blank / dotted / ruled),
  tokens only; A4 aspect by default.

#### 6.2.13 The worker message protocol

A 240 Hz digitiser produces thousands of samples per second. Building an object
per sample on the main thread and `postMessage`-ing it is real garbage: enough
transient allocation to trigger a minor GC on the main thread, and a 2–5 ms
hitch there is a dropped frame on the pen path. So the protocol must not
allocate per event. Three ways to do that, and the repo decides which:

**1. Batch per frame (the baseline, and enough).** Accumulate samples into a
reusable `Float32Array` and transfer **once per `rAF`**, not once per event.
`getCoalescedEvents()` already collapses the digitiser's burst into one
dispatch, so this is ~120 transfers/sec rather than 240+. Layout is `[x, y,
pressure, t]` per sample.

**2. Pool the buffers — do not "reuse" a buffer you transferred.** A single
shared `sampleBuf` as in the naive snippet **is a bug**: `postMessage(buf,
[buf])` *neuters* the sender's buffer, so the next event reads from a detached,
zero-length array. Either:

- transfer and replace (double-buffer: two buffers, swap, refill the returned
  one), or
- **don't transfer** — structured-clone a small typed array. It still copies
  and allocates a little, but the allocation is one small array per frame rather
  than one object per sample, which is the part that mattered.

Take the worker returning buffers via a `postMessage` back-channel, or simply
allocate a fresh small array per frame. Measure before optimising further; at
120 allocations/sec of 1 kB this is not the bottleneck.

**3. `SharedArrayBuffer` + a ring buffer (zero-copy, best, and currently
unavailable).** This is the genuinely allocation-free design: the main thread
writes samples into a ring and bumps an index; the worker polls. No transfer, no
copy, no GC — and the same buffer can carry the worker's progress counter and
the filter state (§6.2.5).

**But it is not available in this repo today, and enabling it is not free.**
Verified:

- **Neither build sends COOP/COEP headers.** `apps/web/next.config.mjs:109-127`
  (`securityHeaders`) and `apps/desktop/src/app-protocol.ts:74-101`
  (`appHeaders`) set CSP, `X-Frame-Options`, `X-Content-Type-Options` and
  `Referrer-Policy` — no `Cross-Origin-Opener-Policy` and no
  `Cross-Origin-Embedder-Policy`. Without both, `crossOriginIsolated` is
  `false` and `SharedArrayBuffer` is not constructible. There is no existing
  `SharedArrayBuffer` usage in the tree.
- Turning COOP/COEP on for the **web** build is a breaking change: it blocks
  cross-origin embeds and subresources that do not opt in, which is exactly the
  surface the reader, Overleaf and Zotero integrations live on. Do not do it for
  ink.

**Decision: ship option 1 with option 2's buffer discipline. Keep
`SharedArrayBuffer` as a desktop-only optimisation**, gated behind a measured
need — and note that the desktop shell is the easy place to add it, because
`app://` is served by our own protocol handler
(`apps/desktop/src/main.ts:336-341`, `app-protocol.ts`), so adding COOP/COEP
there touches nothing third-party.

**CSP must be widened for the worker, on web only.** The desktop CSP already
allows blob workers (`worker-src 'self' blob:`,
`apps/desktop/src/app-protocol.ts:95`). The **web** CSP does not set
`worker-src` at all, so it falls back through `child-src` to `script-src`
(`next.config.mjs:114`) — which is `'self' 'unsafe-inline' 'unsafe-eval'`,
**without `blob:`**. If the bundler emits the ink worker from a blob URL (the
desktop comment implies it does), **ink rendering will fail on web and work on
desktop** — a confusing, environment-specific break. Add `worker-src 'self'
blob:` to the web CSP in step 2, and add a browser test that constructs the
worker in a production build rather than only in dev.

### 6.3 Tools

| Tool | Behaviour | Reuses |
| --- | --- | --- |
| Pen | pressure + velocity width, 3 token colours, 3 widths | reader pen |
| Highlighter | 6 mm, multiply blend, straightens if height/length < 0.1 | reader highlighter semantics |
| Eraser | stroke eraser (whole stroke under nib), `ERASER_RADIUS`; ⌥ for partial — v2 | reader eraser + R-tree |
| Lasso | free polygon; dashed bound; move / resize / duplicate / delete / **Copy as text** / **Insert below** / **Convert to shape** | `translateInkPaths`, `inkPathsBounds` |
| Shape | rough line / rect / ellipse / arrow, hold 400 ms → snapped; `shape` field | new, small (§7 step 8) |
| Insert PDF page | picker → page raster as `bg` of a new page | reader page raster |
| Recognise | re-run this page (§5.4) | §5 |
| Undo / redo | per page, ⌘Z / ⌘⇧Z, stroke-granular; a GPU buffer edit, not a repaint | new, trivial |

> **Unit trap — do not reuse the reader's width helpers verbatim.** The reader
> is in **PDF units**; the sidecar is **0.1 mm integers**. `clampInkWidth`
> (`ink-stroke.ts:82-85`) clamps to `[0.75, 24]`, which in 0.1 mm is
> `[0.075 mm, 2.4 mm]` — a 6 mm highlighter (`width: 60`) would clamp to
> 2.4 mm, thinner than the pen's maximum. `HIGHLIGHTER_MIN_WIDTH = 8` and
> `HIGHLIGHTER_WIDTH = 14` are also PDF units; against 0.1 mm a 0.9 mm pen is
> classified as a highlighter and a 0.6 mm pen is not. **Write one
> `packages/core/src/ink/width.ts` in 0.1 mm with its own constants and leave
> `ink-stroke.ts` alone.** Reuse the *geometry* (`shouldAppendInkPoint`,
> `simplifyInkPath`, `inkPathsHitTest`, `inkPathsBounds`) — that part is
> genuinely shared.

### 6.4 Gestures

- **Scribble-to-erase**: a stroke whose bbox is small, whose path reverses
  x-direction ≥ 4 times, and which overlaps ≥ 60 % of another stroke's bounds
  deletes the overlapped strokes and itself. ~30 lines.
- **Two-finger scroll** always scrolls (layer 3.2).
- **Barrel-button double-tap** (`event.button === 5` / `buttons & 32`) toggles
  pen ↔ eraser — Surface and Wacom report it; Apple Pencil's does not reach the
  web.

### 6.5 Keyboard

`P` pen, `H` highlighter, `E` eraser, `L` lasso, `S` shape, `1–3` colours,
`⌘Z / ⌘⇧Z`, `⌘⇧R` recognise page, `⌘⇧E` export page PNG. `⌘E` (Edit/Read) is
hidden for ink: the text-layer column is its Read view, and "Open source" in the
tab context menu opens the markdown (which contains no stroke data — §4.6).

---

## 7. Plan — steps, each its own PR

| # | Step | Files | Done when | Tests |
| --- | --- | --- | --- | --- |
| 1 | **Format + kind.** `ink_page` kind, `.ink.md` suffix, **binary sidecar** reader/writer, page+stroke tables, brotli q5 / deflate-raw with a raw escape hatch, byte budget | `packages/core/src/workspace/folder-layout.ts` (one row), new `packages/core/src/ink/{ink-note.ts,ink-binary.ts,segment.ts,recognise.ts,width.ts}`, `kind.ts` row | a note + sidecar round-trips byte-for-byte; a note with no sidecar is a valid empty ink note; a 5 000-stroke page packs to < 60 kB; **inflate + view time for that page is measured and recorded** (budget: < 5 ms on the target CPU, else drop to deflate-raw or raw) | `ink-binary.test.ts`: round-trip identity, **inflate timing recorded per run**, delta ↔ absolute, corrupt/truncated buffer rejected, raw-vs-compressed flag; `width.test.ts`: 6 mm highlighter survives clamping |
| 2 | **Shared pen capture + worker skeleton.** Lift capture out of `use-page-pointer.ts`; `pointerrawupdate` + coalesced (+ **predicted only on the fallback path**, D11); **1-Euro filter on position and pressure** (D13, one filter state, main thread); `transferControlToOffscreen`; **batched, pooled** message protocol (§6.2.13); **`worker-src 'self' blob:` added to the web CSP**; **live stroke never enters React state** | `use-page-pointer.ts`, new `features/ink/application/{use-pen-capture.ts,capture-protocol.ts,one-euro-filter.ts}`, `features/ink/worker/ink-worker.ts`, `apps/web/next.config.mjs` (one CSP token) | reader behaviour unchanged (its tests pass); a 240 Hz synthetic stroke causes **no** React render and **no measurable GC**; a forced 500 ms main-thread stall does not drop worker frames; **the worker constructs in a production web build**, not only in dev | `use-pen-capture.test.ts`: pen→touch scroll, palm rules, handedness; **no-render-during-stroke**; `one-euro-filter.test.ts`: a jittery pressure ramp is smoothed, a step is not over-damped, a slow staircased position is smoothed and a fast straight sweep is not lagged; `capture-protocol.test.ts`: transferred buffers are never read after transfer; CSP build test |
| 3 | **Desktop recogniser.** C#/WinRT **helper exe** over stdio (§5.3, chosen over an N-API addon) wrapping `InkAnalyzer`; x64 + arm64 builds; graceful absence | new `apps/desktop/native/ink-recogniser/`, `features/ink/application/recognise-page.ts` | on Windows, `recognise()` returns lines for a real page in well under a second; without the helper the app falls back and says so | helper contract test against recorded strokes over the stdio protocol; absence + crash-restart test; per-page timing recorded |
| 4 | **Ink host: WebGL2 renderer.** `InkHost` in `document-host.tsx`, single-pass **SDF capsule** shader with analytic caps/joins/AA, highlighter via the **hardware stencil buffer** (D14, `stencil: true`, no offscreen FBO), variable-width nib, R-tree picking, erase/undo as buffer edits, paper, save through the debounce | `ui/document-host.tsx` (one case), new `features/ink/application/{page-buffer.ts,stroke-index.ts}`, `features/ink/ui/{ink-host.tsx,ink-page.tsx,ink-bar.tsx}`, `features/ink/render/{ink-renderer.ts,webgl-renderer.ts}`, `features/ink/worker/*` | draw, erase, highlight, zoom, pan, add page, reload — strokes are there and pan/zoom are crisp; a highlighter crossing itself shows **no darker bead**; opaque strokes have anti-aliased edges | `page-buffer.test.ts` round-trip; `stroke-index.test.ts` **≤ 50 candidates** on 5 000 strokes; `ink-renderer.test.ts` both implementations behind the interface; **`sdf.test.ts`: a zero-length segment renders a round dot**; perf gate: live stroke < 4 ms, pan < 1 ms, recorded in the PR |
| 5 | **Recognition wiring + text layer.** Text-layer column, confidence, correction UI, on-demand page run with per-line progress, incremental re-run, vocabulary hints | `ui/ink-text-layer.tsx`, `features/ink/application/{recognise-page.ts,vocab-match.ts}` | write "see [[Graph-prior module]]" by hand → body has the link, backlinks show it, `⌘P` finds the note by a word in it | `segment.test.ts` on recorded strokes; `vocab-match.test.ts`; engine mocked in UI tests; a manual correction survives re-recognition |
| 6 | **Canvas 2D fallback renderer + context-loss recovery** | `features/ink/render/canvas-renderer.ts`, `ink-renderer.ts` | forcing `WEBGL_lose_context` keeps the app writing and recovers without data loss | `context-loss.test.ts`: loss mid-stroke loses nothing; fallback renders the same page |
| 7 | **Web stroke-model engine.** WASM online recogniser in the existing worker, behind the same interface; engine selection + privacy line in settings | `features/search/infrastructure/embedding-worker.ts` (second pipeline), `model-cache.ts`, settings | on non-Windows, recognition works offline without the 330 MB image model | engine-order test; accuracy/corrections-per-line recorded per §9 |
| 8 | **Lasso, shape snap, scribble-erase, copy-as-text, PDF page insert, export PNG** | `features/ink/ui/{lasso.ts,shape-snap.ts,gestures.ts}` | figures for the report can be drawn, tidied and exported | `shape-snap.test.ts`; `gestures.test.ts`; `export.test.ts`: export never reads the live canvas |
| 9 | **Delegated Ink Trail + wrist guard + handedness** | `features/ink/ui/ink-page.tsx` (presenter), settings | on Surface hardware the wet tail is delegated and there is no seam at pen-up; the absent-API path is a no-op | presenter absent → no throw; diameter follows pressure |
| 10 *(optional)* | **MyScript maths** | opt-in key, maths → LaTeX in a `$$` block | a derivation converts on demand | contract test against a recorded response |

Steps 1–4 give a fast, complete pen. 5–7 give the research value. 8–9 are
polish. 10 is the owner's call and costs money.

Not in this plan: audio recording, infinite canvas, tilt shading, a mobile app,
Zotero sync of ink notes, OCR of photographed pages, collaborative ink (strokes
in a `Y.Array` is a later plan; the text layer is already collaborative).

---

## 8. Host shell and Electron

The desktop app is **Electron 33.4.11** (Chromium 130) — an advantage: you
control Chromium's flags and can raise Chromium when an upstream ink fix lands.

- **Do not call `app.disableHardwareAcceleration()`.** It is the tempting "fix"
  for iGPU driver bugs and would force the software path in §6.2.10 for
  everyone.
- For Intel-specific tearing or resets, the targeted knob is an ANGLE/feature
  selection, not disabling the GPU. **Check `chrome://gpu` in the packaged app
  first** (§9).
- `--force_low_power_gpu` / `--force_high_performance_gpu` are irrelevant on a
  single-GPU Surface Pro; ship neither.
- **Add the native recogniser to the build matrix** (§5.3): x64 and arm64
  prebuilds, rebuilt on every Electron ABI bump.
- Add "test the ink path on every Electron bump" to the release checklist.

---

## 9. Verify on the target hardware before step 4

In order of value:

1. **`chrome://gpu` in the packaged app** — confirm hardware acceleration and
   note the GPU/ANGLE backend.
2. **WebGL2 frame time** with the real pen at 120 Hz on a dense page, and pan/
   zoom during a 5 000-stroke page. Confirm the worker is not blocked by a
   forced main-thread stall.
3. **Full-page geometry build** through the real pipeline (target: near the
   22.7 ms measured here, and incremental per stroke).
4. **Delegated trail**: present, and no seam at pen-up with a per-event
   diameter — at DPR 1, 1.5, 2 and with CSS zoom / pan applied (§6.2.6).
   **Also confirm the presenter works at all while the canvas is owned by a
   worker via `transferControlToOffscreen()` in Electron 33** — unverified;
   if not, the trail runs on the fallback path only.
5. **Context loss**: force it mid-stroke; confirm recovery and no data loss.
6. **Sidecar**: pack/compress/save time for a dense page on the actual CPU
   (target ≈ 6 ms brotli q5), **inflate time per dense page**, and open time
   for a 20-page note.
7. **Prediction**: `getPredictedEvents` improving the tail during fast
   sketching.
8. **`stroke-index` candidate count** on a 5 000-stroke page (target ≤ 50).
9. **Windows Ink** per-page time through the chosen IPC path, on a real page.
10. **Corrections-per-line across 10 real pages**, per engine. If > 1/line,
    escalate within the online family — not back to image OCR.

---

## 10. Risks, stated

- **The native recogniser is now a real dependency** (§5.3). A helper exe
  built per arch, a stdio protocol to keep stable, a Windows-only code path. Mitigated by keeping
  the web engine as a desktop fallback. This is the largest new engineering
  commitment in this revision.
- **WebGL context loss** on integrated graphics is real (§6.2.9). Mitigated by
  a state model fully reconstructible from the sidecar plus a Canvas 2D
  fallback — but it must be built in from the start.
- **Online recognition accuracy on a real hand is unmeasured here** (§5.5).
  Windows Ink is very good on print and mixed handwriting and weaker on heavy
  cursive and Greek, like every engine. Vocabulary hints and the cheap
  correction UI are the mitigations; §9 item 10 is the gate.
- **Binary sidecars are not hand-editable.** A deliberate trade for a 55× size
  reduction and zero parse cost (§4.3). The *text layer* remains plain
  markdown, which is the part a human edits. Provide `wf ink dump <note>` to
  render a sidecar as readable JSON for debugging, so the format stays
  inspectable without being the storage.
- **Two ink models** (reader ink in Zotero shape, note ink in the sidecar) is
  deliberate — one syncs to Zotero and must stay that way. Shared code is the
  geometry and the capture, not the record.
- **`flatbush` is a new dependency** (§6.2.4), breaking the no-new-deps rule
  knowingly, for 3 kB.
- **Variable width is restored, so the pressure-aware simplification pass is
  required** (§4.4) — a pressure-blind RDP pass silently flattens taper. Easy
  to get subtly wrong; it needs its own test.
- **The trail diameter and the committed width must come from one filter**
  (§6.2.5). Two filters, or a filter on only one side, reintroduces exactly the
  seam that D3 was changed to remove — and it will look like a rendering bug,
  not a data-flow bug.
- **`SharedArrayBuffer` is not available today** and enabling COOP/COEP on the
  web build would break cross-origin embeds (§6.2.13). The protocol is designed
  to work without it; the zero-copy path stays a desktop-only option.
- **Performance is budgeted against measurement, not assumption** (§11.3). The
  three things that keep a dense page bounded: geometry expanded on the GPU,
  strokes appended incrementally to a resident buffer, and nothing
  re-rasterised on the pen path.

---

## 11. Reference

### 11.1 The no-lag configuration, in one place

1. **Renderer:** WebGL2 in a worker `OffscreenCanvas`, `{ alpha: false,
   antialias: false, stencil: true }`; **single-pass SDF capsules** (analytic
   caps, joins, `fwidth` AA); per-point width; keep the AA margin at ~1 px.
2. **Two mutually exclusive low-latency paths (D7).** Delegating → canvas
   `{ desynchronized: false }` **and no `getPredictedEvents()`**. Not delegating
   (no presenter, Firefox/Safari, or low expected improvement) → canvas
   `{ desynchronized: true }` **and** predicted events. Never both at once.
3. **Highlighter** uses the **hardware stencil buffer** (`EQUAL 0` / `INCR`),
   multiply-blended straight to the backbuffer — no offscreen FBO, no composite
   blit. Global dedupe is deliberate: crossing highlighter strokes do not darken.
4. **Main thread:** `pointerrawupdate` + coalesced (+ predicted only off the
   delegated path) → **adaptive 1-Euro filter on position *and* pressure** → nib
   width → Delegated Ink Trail called **inline, immediately** (`diameter` =
   filtered instantaneous width) → batched, pooled `postMessage`. No rendering,
   no React state, no per-sample allocation.
5. **Draw incrementally** — new segments only.
6. **Pan/zoom** are uniform updates. No bitmaps, no blurry frame.
7. **Erase/undo** update a **tombstone liveness bitmask** in O(1) and swap the
   GPU instance range; the R-tree is **rebuilt once at `pointerup`**, never per
   event. Picking via the R-tree (≤ 50 candidates).
8. **Geometry built once, incrementally**, never as a triangle soup, and never
   tessellated on the CPU (no ribbon path in v1, §6.2.3).
9. **Storage:** binary `Int16`/`Uint8` **per-page chunks**, brotli **q5**
   (desktop) or deflate-raw (web); raw below 64 kB.
10. **Strokes never enter `Y.Text`**; the body carries only the text layer.
11. **Recognise on demand** with per-line progress; incremental after that.
12. **Canvas 2D rules for the fallback only:** explicit canvas attributes, zero
    readbacks on any drawing canvas, a test that enforces it.
13. **Context loss** handled: buffers re-uploaded, fallback renderer, no lost
    strokes.
14. **`worker-src 'self' blob:` in the web CSP** (§6.2.13) — the desktop shell
    already has it, so omitting it fails on web only.
15. **Never quote a GPU frame time from this document** (§11.3.10); measure it
    on device before believing any fill-rate claim, in either direction.

### 11.2 Feature support, verified

Over a secure origin (`http://127.0.0.1`), Chromium:

| Feature | Present |
| --- | --- |
| `getCoalescedEvents` / `getPredictedEvents` | ✅ |
| `pointerrawupdate` | ✅ |
| `navigator.ink` (Delegated Ink Trail) | ✅ |
| `OffscreenCanvas` + `transferControlToOffscreen` | ✅ |
| `desynchronized` on 2d **and** webgl2, accepted | ✅ |
| `{ alpha: false, willReadFrequently: false }` accepted | ✅ |
| WebGL2 + instancing (`vertexAttribDivisor`) | ✅ |
| `navigator.gpu` (WebGPU) | ✅ — not required by this plan |
| `queryHandwritingRecognizer` | ❌ absent — ChromeOS-only in practice |

> **Method note.** On `about:blank` (not a secure context) `getCoalescedEvents`,
> `navigator.gpu` and others read as **absent**. Verify feature detection over a
> secure origin or you will conclude APIs are missing when they are not.

### 11.3 Measured evidence

Windows, Chromium, real GPU where stated. Harnesses in §12.2.

#### 11.3.1 Editor cost (real CodeMirror 6, markdown + `lineWrapping`)

| Ink JSON, one line | `EditorState.create` | first paint | keystroke+paint |
| --- | --- | --- | --- |
| 137 kB — typical page | 24 ms | 334 ms | 74 ms |
| 3.13 MB — dense page | 33 ms | **1 333 ms** | 17 ms |
| 23.6 MB — revision-0 worst case | 178 ms | **8 483 ms** | 46 ms |

Main-thread tasks of 16–74 ms are the reason the ink pipeline must not live
there.

#### 11.3.2 Canvas 2D GPU→software cliff *(fallback path only)*

300 strokes × 60 points, 1024×768, forced flush:

| Canvas | redraw |
| --- | --- |
| default, untouched | 12.7 ms |
| default, after **2× `getImageData`** | **61.4 ms** |
| `willReadFrequently: true` | 69.2 ms |
| `willReadFrequently: false` | **7.1 ms** |
| `willReadFrequently: false`, then 2 reads | 16.5 ms |

#### 11.3.3 WebGL2 pipeline — **and why its timings are not usable**

5 000 strokes / 295 000 segments, A4 at 2× DPR:

| Operation | Wall clock | Trustworthy as GPU time? |
| --- | --- | --- |
| instanced draw (6 verts × 295 k) | < 0.001 ms | **No** |
| pan (uniform + draw) | < 0.001 ms | **No** |
| instanced upload (5.9 MB) | 0.5 ms | Partly — `bufferData` does CPU-side work |
| points-only upload (2.4 MB) | 0.2 ms | Partly |
| triangle-soup upload (14.2 MB) | 2.5 ms | Partly |
| instanced build (JS, one-time) | 22.7 ms | **Yes** — pure CPU |
| triangle-soup build (JS, one-time) | 61.7 ms | **Yes** — pure CPU |
| `desynchronized` granted on webgl2 | yes | Yes |

**The draw figures must not be quoted.** A control experiment (§11.3.10) showed
this machine's GL timing cannot resolve GPU work at all: a fragment shader with a
200-iteration ALU loop measured *faster* than a trivial colour write, and 64
full-screen fills (228 M pixels) "took" 0.03 ms. `EXT_disjoint_timer_query_webgl2`
is exposed but returns **0** for every query. So:

- Revision 2's "< 0.001 ms draw" and this document's implied "WebGL is 1000×
  faster than Canvas 2D" are **not established**. What is established is that
  WebGL draws fixed geometry with no CPU rasterisation, while Canvas 2D costs
  **186–354 ms** measured *with a real flush* (§11.3.4) — a direction, not a
  ratio.
- The CPU-side numbers (geometry build, and the Canvas 2D figures, which are
  forced by an actual `getImageData` readback) remain valid.
- Anyone quoting a WebGL frame time from this document is quoting noise.

#### 11.3.4 Canvas 2D raster budget *(fallback path)*

| Strategy, 5 000 strokes | Real GPU | Software |
| --- | --- | --- |
| variable width, filled outline per stroke | 186 ms | 1 091 ms |
| `stroke()` per stroke, round caps | 327 ms | 1 296 ms |
| merged `Path2D`, one call | 1 400 ms | 1 639 ms |
| quad-per-segment merged, one `fill()` | build 15 111 ms @ 1 k | — |
| append one stroke to cached bitmap | ~1–29 ms | ~1 ms |
| live stroke, incremental / whole | 0.5 / 4.8 ms | — |
| pan (blit) | ~0 ms | ~0 ms |
| full-page `getImageData` | 1 006 ms | 2 138 ms |

#### 11.3.5 Storage

Dense page = 5 000 strokes × 60 points.

| Format | Size | vs JSON | Compress | Load |
| --- | --- | --- | --- | --- |
| JSON, `dx,dy,p` | 3.18 MB | 1× | — | 17.8 ms |
| JSON, `dx,dy` | 2.11 MB | 1.5× | — | 11.9 ms |
| binary, `Int16`+`Uint8`, pressure | 1.77 MB | 1.8× | — | **~0 ms** |
| binary, `Int16`, no pressure | 1.20 MB | 1.8× | — | ~0 ms |
| **binary + brotli q5, pressure** | **52.5 kB** | **61×** | 6 ms | ~0 ms |
| **binary + brotli q5, no pressure** | **39.0 kB** | **55×** | 6 ms | ~0 ms |
| binary + deflate L6, no pressure | 73.4 kB | 30× | 7 ms | ~0 ms |
| JSON + gzip | 372 kB | 6× | 89 ms | 12 ms |

Compression-level sweep (binary, no pressure): q1 69.6 kB/1.1 ms · q2 50.6/2.4 ·
q3 49.2/2.7 · q4 43.2/4.3 · **q5 39.0/6.1** · q6 38.7/9.7 · q7 38.4/11.9 ·
q9 38.5/23.6 · **q11 38.5/3 272** (Node default — avoid).

#### 11.3.6 Recognition cost

| Approach | Download | Per page |
| --- | --- | --- |
| TrOCR image OCR (revision 1) | 240–330 MB | **6–20 s** (pipeline does not batch: one `generate()` per line) |
| Windows Ink `InkAnalyzer` | **0 MB** (already installed) | order of 20 ms *(OS figure — verify, §9 item 9)* |
| Online stroke model | 3–10 MB | < 100 ms *(target — verify)* |

#### 11.3.7 Spatial index

10 mm uniform grid on a dense page: **mean 785 strokes per occupied cell, max
1 623** — it does not index. Revision 1 proposed narrowing the cells; this
revision replaces the structure with an R-tree (§6.2.4).

#### 11.3.8 Memory and allocation

| Quantity | Measured |
| --- | --- |
| A4 page bitmap @ 2× DPR (RGBA) | ~14.3 MB |
| allocate+fill one page canvas | 9.9 ms |
| allocate+fill 20 × 512² tiles | 89.9 ms |
| 50 dense pages, decoded points | ~90 MB |
| 50 dense pages, compressed sidecar | ~2 MB |

#### 11.3.9 SDF overdraw and the ribbon alternative

Overdraw measured by **additive accumulation into an RGBA32F target and
`readPixels`** — a method that does not depend on timing, which matters because
timing is broken here (§11.3.10). 5 000 strokes, pen half-width 2.2 px, A4 at
2× DPR:

| Geometry | Mean segments/stroke | Quad overdraw (mean) | Over covered px | Peak | Ink overdraw (mean) |
| --- | --- | --- | --- | --- | --- |
| raw, 60 points/stroke | 60 | **8.47** | 9.95 | 75 | 3.59 |
| simplified, 16 points/stroke | 16 | **3.09** | 4.06 | 31 | 1.46 |
| simplified, 8 points/stroke | 8 | **1.83** | 2.70 | 19 | 0.91 |

Segment length is what drives it: 6.39 px mean unsimplified vs 17.39 px at 8
points/stroke. **Simplification is the overdraw control.** A 10–15× figure quoted
in review applies only to unsimplified live-stroke density, and even there the
measurement is 8.5×.

Ribbon build cost (CPU, one-time per stroke, JS — this *is* a valid measurement):

| Variant | Build | Vertex bytes | Index bytes | AA |
| --- | --- | --- | --- | --- |
| instanced quads (chosen) | 0 (GPU-expanded) | 5.9 MB | none | analytic, free |
| ribbon, 2 verts/point | **53.6 ms** | 4.8 MB | **7.1 MB** | **none** |
| ribbon + 1 px AA skirt, 4 verts/point | **98.7 ms** | **9.6 MB** | **21.2 MB** | alpha skirt |

The instanced form needs no index buffer and no tessellation, and gets AA for
free from `fwidth`. That, plus WebGL2's lack of a geometry shader, is why the
ribbon path is not adopted for v1 (§6.2.3).

#### 11.3.10 Timing control — why no GPU time is reported

Before any draw time from §11.3.3 could be used, the method was validated with a
control: the same geometry and the same draw calls, with fragment shaders of
deliberately different cost, plus an empty draw as an overhead baseline, timed
with `fenceSync`/`waitSync`.

| Fragment shader, 295 k instances | Time per frame |
| --- | --- |
| empty (0 instances) | 0.010 ms |
| trivial (flat colour) | 0.010 ms |
| SDF capsule (the real shader) | 0.025 ms |
| ~10× SDF ALU | 0.010 ms |
| **~200× SDF ALU** | **0.005 ms** |

`heavy ×200` measuring *faster* than trivial is impossible if the timer measures
GPU work. Confirmed with a geometry-independent probe: 1×, 4× and 16× full-screen
fills all measured 0.010 ms, and 64× (228 M pixels) measured 0.030 ms —
≈ 7.6 Tpixel/s, which no integrated GPU can do. `EXT_disjoint_timer_query_webgl2`
is exposed but returns **0** for every query on this driver.

**Conclusion: GPU time is not measurable on this machine.** Overdraw (a
readback of actual accumulated fragments) and all CPU-side times stand; every
GL draw duration does not. To settle the fill-rate question properly, measure on
device with a GPU timer query, or externally with ETW/GPUView on Windows or a
RenderDoc capture — not with `performance.now()` around GL calls.

### 11.4 Methodology, so the numbers are not over-read

- **The benchmark machine is a Snapdragon `Adreno X1-85`** — an *integrated*
  GPU with a shared power budget (verified via `WEBGL_debug_renderer_info`),
  i.e. the hardware class this document targets, not a stand-in for it. That
  makes the CPU-side and Canvas 2D results directly relevant, and it also means
  "it was fast on the dev machine" is a real signal rather than a discrete-GPU
  artifact.
- Canvas 2D and WebGL commands are **queued asynchronously**, so a timer around
  them measures *submission*. Canvas 2D figures here are forced by an actual
  `getImageData` readback, which does serialise and is therefore meaningful.
  **WebGL draw times are not meaningful at all** — see §11.3.10.
- Absolute values vary with GPU and CPU; the software-raster column is
  SwiftShader, hence 3–6× slower.
- **Not measured here, and flagged as such:** Windows Ink timing, the web stroke
  model's accuracy, end-to-end per-page recognition (§5.5, §9), and **any GPU
  frame time whatsoever** (§11.3.10).

---

## 12. Sources and harnesses

### 12.1 Sources

- **Online vs image recognition:** [Windows ink to text](https://learn.microsoft.com/en-us/windows/apps/develop/input/convert-ink-to-text), [`InkAnalyzer`](https://learn.microsoft.com/en-us/uwp/api/windows.ui.input.inking.analysis.inkanalyzer), [Chrome Handwriting Recognition API](https://developer.chrome.com/docs/web-platform/handwriting-recognition), [WICG handwriting-recognition](https://wicg.github.io/handwriting-recognition/), [MyScript iinkTS](https://github.com/MyScript/iinkTS) — TrOCR (`microsoft/trocr-*-handwritten`) retained as a documented last resort only
- **Delegated Ink Trail / low latency:** [WICG Ink API](https://wicg.github.io/ink-enhancement/), **[Microsoft Edge explainer — read the non-goals; they make this API and desynchronized canvas mutually exclusive](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/WebInkEnhancement/explainer.md)**, [enabled by default since Chrome 92](https://chromestatuslite.com/feature/5961434129235968), [desynchronized hint](https://developer.chrome.com/blog/desynchronized)
- **Capture:** [`getCoalescedEvents`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents), [`getPredictedEvents`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents), [Pointer Events](https://www.w3.org/TR/pointerevents/)
- **Worker rendering:** [web.dev — OffscreenCanvas](https://web.dev/articles/offscreen-canvas)
- **Message protocol / no-alloc forwarding:** [`postMessage` transfer semantics](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage), [SharedArrayBuffer and cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer), [COOP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy) / [COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy), [CSP `worker-src` fallback chain](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)
- **SDF stroke rendering:** [Inigo Quilez — distance to a segment](https://iquilezles.org/articles/distfunctions2d/), [Drawing thick lines with SDFs](https://wwwtyro.net/2019/11/18/instanced-lines.html)
- **Pressure filtering:** [1-Euro filter (Casiez, Roussel, Vogel 2012)](https://gery.casiez.net/1euro/) — the standard jitter-vs-lag filter for noisy input devices
- **Canvas 2D fallback:** [Slow HTML Canvas Performance? `willReadFrequently`](https://www.schiener.io/2024-08-02/canvas-willreadfrequently), [MDN `getContext()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext), [Chromium issue 40133640](https://issues.chromium.org/issues/40133640)
- **Spatial index:** [flatbush](https://github.com/mourner/flatbush) — static packed Hilbert R-tree; no update/delete, which is why §6.2.4 tombstones
- **Stencil-based transparency dedupe:** [`glStencilOp`](https://registry.khronos.org/OpenGL-Refpages/gl4/html/glStencilOp.xhtml), [WebGL `stencilFunc`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/stencilFunc)
- **Palm rejection:** [Android stylus palm rejection](https://developer.android.com/develop/adaptive-apps/cookbook/stylus-palm-rejection)
- **Surface pen:** [Surface Slim Pen 2 latency](https://www.vividrepairs.co.uk/surface-slim-pen-2-latency-milliseconds-surface-pro-11), [Microsoft Pen Protocol](https://en.wikipedia.org/wiki/Microsoft_Pen_Protocol)
- **Electron:** [command line switches](https://www.electronjs.org/docs/latest/api/command-line-switches), [native Node addons](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- **Stroke geometry:** [perfect-freehand](https://github.com/steveruizok/perfect-freehand), [Excalidraw freedraw PR](https://github.com/excalidraw/excalidraw/pull/3512)
- **App survey / formats:** [GoodNotes vs Notability](https://paperlike.com/blogs/paperlikers-insights/app-review-goodnotes-vs-notability), [Best iPad note apps](https://paperlike.com/blogs/paperlikers-insights/best-note-taking-apps-ipad), [noteapps.info](https://noteapps.info/best_note_taking_apps_2026), [InkedMark](https://community.obsidian.md/plugins/inkedmark), [Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)
- **In-repo:** `packages/core/src/reader/ink-stroke.ts`, `apps/web/src/features/reader/ui/pdf-reader/use-page-pointer.ts`, `apps/web/src/features/collab/ui/collaborative-markdown-editor.tsx`, `apps/web/src/features/collab/domain/seed-document.ts`, `apps/web/src/features/search/infrastructure/embedding-worker.ts`, `apps/desktop/src/model-cache.ts`, `docs/internal/design/editor-workspace-redesign.md` §3.3

### 12.2 Harnesses

Gitignored under `local-dev/`, re-runnable:

| File | Measures |
| --- | --- |
| `ink-bench.mjs` | JSON size, stringify/parse, typed-array memory, grid candidate counts |
| `ink-feature-probe.mjs` | secure-context feature detection (§11.2) |
| `ink-raster-sweep.mjs` / `ink-raster-decompose.mjs` | Canvas 2D raster strategies, flushed end-to-end, live stroke, WebGL2 geometry cost |
| `ink-surfacebook-probe.mjs` | **the canvas 2D GPU→software cliff** (§11.3.2), tile allocation |
| `ink-constant-width.mjs` / `ink-constant-width-2.mjs` | the constant-vs-variable comparison that §0.2 retracts |
| `ink-gold-standard.mjs` | binary vs JSON storage, compression, and the WebGL2 build/upload/draw split (§11.3.3, §11.3.5) |
| `ink-sdf-vs-ribbon.mjs` | **SDF vs ribbon draw, and real overdraw by additive readback** (§11.3.9) |
| `ink-sdf-overdraw-detail.mjs` | overdraw at raw vs simplified densities; segment-length stats; GPU identification |
| `ink-fillrate-control.mjs` | **the timing control that falsified every GPU draw time** (§11.3.10) |
| `ink-timer-query-probe.mjs` | `EXT_disjoint_timer_query_webgl2` availability — present, but reports 0 |
| `ink-compression-levels.mjs` | **brotli/deflate quality sweep** — finds q5 as the knee, and that Node's default q11 costs 3.3 s |
| `cm-longline-*.{ts,js}` + `ink-editor-bench.mjs` | CodeMirror against multi-MB single-line blocks (§11.3.1) |
| `cm-constwidth-*.{ts,js}` + `ink-constwidth-editor-bench.mjs` | CodeMirror at constant vs variable width |
