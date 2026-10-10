# WeaveForge 0.8.11 — builder handoff (one file, everything you need)

## 0. Rules. Read first. Follow them exactly.

1. **Follow this document exactly.** Every value, selector, file path and line in it is deliberate. Do not "improve", rename, reorder, round, restyle or swap any value. Do not change a square to a circle, a 60ms to a 150ms, a 3px to a 2px. If something in the code does not match what this document says is there, **stop and report it**; do not guess a fix.
2. Touch **only** the files a work package (WP) names. If a change seems to need another file, stop and report.
3. Comments: one line, saying why. No history, no essays.
4. Say "Notes", never "vault", in any new text.
5. Tests first where a WP says so: write the test, run it, show it **failing**, then change the code, run it again, show it **passing**. Paste both outputs.
6. Never run git write commands (commit, push, reset, checkout, restore, clean, stash). Never run `rm -rf`, `Remove-Item -Recurse`, or any bulk delete.
7. Never touch the person's installed **WeaveForge** app or its workspace. Desktop checks use the **WeaveForge Dev** build only (section 7).
8. Never print tokens or secrets. Never use a Supabase MCP / connector. No database changes are needed for this release.
9. No release. When everything passes, stop and report.
10. Report for every WP: the full diff, every command you ran, and its output. A claim without output counts as not done.

Repo root: `C:\Users\Satwik\Documents\MSc\weaveforge` (Windows, Git Bash or PowerShell). Web code is `apps/web/src`. Styles live in `apps/web/src/app/styles/`, imported in order by `apps/web/src/app/styles/index.css`.

## 1. What 0.8.11 delivers

| # | Item | Files | Proof |
|---|---|---|---|
| WP1 | PDF text box: single click → Delete popover, double click → edit | mark-actions.ts (+test), annotation-overlay.tsx, pdf-reader.tsx | unit + CDP click / dblclick |
| WP2 | Notes ink: erasing the last stroke on a page persists (no side tray needed) | capture-protocol.ts, ink-page-logic.ts, ink-worker.test.ts, use-ink-worker-rpc.ts, ink-host.tsx, use-ink-note-store.ts | fail-first worker test + CDP reload |
| WP3 | **States and motion for every control** (buttons, icon buttons, back, links, tools, segmented, tabs, nav, chips, swatches, toggles, checkboxes, inputs, selects, every dropdown / menu / popover, toasts, modals, sheets), from the design system | states.css (new), index.css, editor-workspace.css (1 line) | Chromium computed-style numbers + screenshots |
| WP4 | Page transitions on by default, tiers: Calm (default), Reactive, CRT, CRT+Reactive, Off | view-transition.ts (+test), motion.css | unit + CDP animation names |
| WP5 | Back button: covered by WP3 (`.back-btn` → `wf-back`) | none | CDP computed style |
| WP6 | Graph zoom: node and label sizes from the mock formula | graph-sizing.ts (+test), graph-canvas.tsx (1 line) | unit table + CDP zoom screenshots |

Order: WP1, WP2, WP6, WP4, WP3. After all: section 7.

## 2. Themes and motion tiers (context for WP3 and WP4)

- Themes are `data-theme` on `<html>`. Paper = no `data-theme`. Families:
  - **Paper** (soft light): no attribute, plus light soft themes.
  - **Slate** (soft dark): `dark`, `mocha`, `dracula`, `amoled`, `contrast`, `vivid-dark`, `pastel-dark`, `confetti-dark`.
  - **Poster**: `brutal`, `brutal-dark`.
  - **CRT**: `crt`.
- Motion: `data-motion="reactive"` on `<html>` when the "Reactive motion" setting is on (`localStorage thesis.reactiveMotion=1`). Off = **Calm** (default).
- `prefers-reduced-motion: reduce` zeroes every duration and distance.

### 2.1 Per-theme state values (WP3; these come from states.css, do not hand-code them)

| Variable | Paper | Slate | Poster (brutal / brutal-dark) | CRT |
|---|---|---|---|---|
| border width `--wf-bw` | 1px | 1px | 2px | 3px |
| press sink `--wf-press` (x and y) | 1px | 1px | 3px | 4px |
| control radius `--wf-rc` | 8px | 8px | 6px | 8px |
| small radius `--wf-rm` | 6px | 6px | 4px | 6px |
| card radius `--wf-rcard` | 14px | 14px | 6px | 12px |
| hover tint `--wf-hover-pct` (text mixed into transparent) | 6% | 7% | 8% (brutal-dark 10%) | 8% |
| rest shadow `--wf-sh-rest` | `--sh-sm` or `0 1px 2px rgba(30,30,40,.08)` | `--sh-sm` or `0 1px 2px rgba(0,0,0,.4)` | `3px 3px 0 <line>` | `--sh-sm` or `3px 3px 0 #2b222b` |
| hover shadow `--wf-sh-up` | `--sh-btn` or `0 2px 4px rgba(30,30,40,.07), 0 10px 24px rgba(30,30,40,.07)` | `--sh-btn` or `0 2px 4px rgba(0,0,0,.42), 0 10px 24px rgba(0,0,0,.38)` | `4px 4px 0 <line>` | `--sh-btn` or `5px 5px 0 #12466e` |
| field focus lift `--wf-field-t` | none | none | `translate(-2px,-2px)` | `translateY(-2px)` |
| control font | sans 14px / 13px small, 600 | same | same | pixel font 1.25rem / 1.1rem small / 1.15rem ghost, 400 |
| easing | `cubic-bezier(.2,.7,.2,1)` | same | same | `steps(3,end)`; hover `steps(2,end)`; popups `steps(4,end)` |

### 2.2 Per-tier motion values

| Variable | Calm (default) | Reactive | CRT | CRT + Reactive | Reduced motion |
|---|---|---|---|---|---|
| state change `--wf-t` | 120ms | 200ms | 120ms | 160ms | 0 |
| press `--wf-t-press` | 60ms | 60ms | 60ms | 60ms | 0 |
| popup in `--wf-t-pop` | 120ms | 200ms | 120ms | 160ms | 0 |
| popup out `--wf-t-exit` | 80ms | 80ms | 80ms | 80ms | 0 |
| modal `--wf-t-modal` | 180ms | 260ms | 180ms | 220ms | 0 |
| hover lift `--wf-lift` | -1px | -2px | -1px | -2px | 0 |
| hover / popup ease | `cubic-bezier(.2,.7,.2,1)` | `cubic-bezier(.34,1.56,.64,1)` (spring) | steps(2) / steps(4) | steps(4) / steps(6) | — |
| popup enter from | 6px below, scale 1 | 10px below, scale .97 | no move: clip-path wipe top→down | same as CRT | none |
| tooltip enter from | 4px | 6px | no move | no move | none |
| toast enter from | 12px | 16px | clip wipe from bottom | same | none |
| modal enter from | 8px, scale .98 | 16px, scale .94 | clip from centre line out | same | none |
| menu items | appear together | stagger 18ms each (cap 8), `wf-item-in` | together | stagger | none |
| swatch hover scale | 1.08 | 1.15 | 1.08 | 1.15 | 1 |
| back arrow hover nudge | -2px | -4px | -2px | -4px | 0 |

### 2.3 Every state, every control (what states.css does)

Shared: **focus** = `outline: 3px solid var(--wf-focus); outline-offset: 2px` (tabs: offset -3px; swatches: 5px; menu items: inset 2px ring instead). `--wf-focus` = `--type-line` where the theme has it, else `--accent`. **Disabled** = opacity .5, `cursor: not-allowed`, no hover / press change.

| Control (app classes) | Rest | Hover | Press (60ms) | Selected / on | Notes |
|---|---|---|---|---|---|
| Button raised: `.btn-primary .btn-secondary .btn-danger .auth-wide .btn-google .dashboard-customize-btn .proj-chip` | border `--wf-bw` line, radius `--wf-rc`, shadow `--wf-sh-rest` | lift `0 --wf-lift`, shadow `--wf-sh-up` | translate `--wf-press --wf-press`, shadow none | — | primary = accent fill; danger = danger fill; `aria-busy` shows spinner |
| Button flat: `.btn-ghost .btn-cancel .card-menu-trigger .header-overflow-btn .list-toggle` | no shadow | hover tint bg + border + small shadow | sinks ⅔ of press | — | |
| Icon button: `.entity-icon-btn .entity-open-icon .paper-open-icon .pdf-reader-icon-btn` | flat, 34×34, svg 18 | as flat | as flat | — | `.btn-sm` icon = 28×28 |
| Back: `.back-btn` / `.back-btn-box` | box rest | box lifts, `--wf-sh-up`, accent-soft bg, arrow nudges `--wf-back-x` | box sinks, no shadow | — | WP5 |
| Link: `.link-btn .link .auth-link .auth-link-sm` | underline faint | underline currentColor 2px | opacity .7 | — | |
| Tool toggle: `.ink-tool .pdf-reader-create-icon .pdf-reader-pop-btn` | transparent | border line + hover tint | press tint | accent fill, accent-fg text; press = brightness .94 | selected = `aria-pressed/checked="true"` or `.seg-on .is-active .is-selected .sel .on .active` |
| Segmented: `.seg > button` | — | hover tint | press tint | accent fill | same selected aliases |
| Tabs: `.sub-tab .pane-tab .graph-drawer-tab .mcp-tab` | muted text, underline scale 0 | text colour, hover tint | press tint | underline grows to full width (`scale: 1 1`) | selected = `aria-selected`, `aria-current="page"`, `.active`, `.is-active` |
| Nav: `.nav-link .header-link` | — | hover tint | press tint | accent-soft bg, accent-ink text, 600 | `aria-current="page"` or `.active` |
| Chip: `.tag-chip .git-chip .jump-to-chip .graph-chip` (clickable) | rest shadow | lift + `--wf-sh-up` | sinks ⅔ | accent fill | link chips get `↗` |
| Chip remove: `.filter-chip-x .jump-to-chip-remove .tag-del` | — | danger-soft bg, danger text | scale .9 | — | |
| Swatch: `.ink-swatch .pdf-reader-pop-swatch .pdf-reader-create-swatch .pdf-reader-pill-swatch .list-color-pick` | — | scale `--wf-sw-hover` | scale .94 | ring `0 0 0 2px surface, 0 0 0 4px text` | **shape stays as the app has it** |
| Switch: `.appearance-switch` | 36×20 track | hover tint | knob widens | accent track, knob slides 16px | |
| Checkbox: `.themed-check .milestone-check` | border box | hover tint | scale .92 | accent fill + tick | |
| Input: `.themed-input .paper-field-input .search-input .input .explorer-filter .graph-search-input .settings-find .quick-open-input .pdf-reader-pop-input` | field bg | hover tint | — | focus: field shadow + `--wf-field-t` lift | invalid = danger border |
| Select trigger: `.custom-select-button` | as input | hover tint | — | open (`aria-expanded`) = focus look, chevron flips | |
| Popover / dropdown surface: `.popover-panel .custom-select-menu .card-menu-flyout .menu-flyout .header-menu .proj-menu .ink-menu-list .member-tree-menu .title-bar-menu .graph-edge-popover .pdf-reader-ref-popover .ink-figure-popover .note-comment-pop` | radius `--wf-rp`, bg `--elev`/surface, rest shadow | — | — | enter: `@starting-style` (tier table); exit only where the element gets `.wf-closing` / `data-state="closed"` before unmount | |
| Menu list: `.custom-select-menu .card-menu-flyout .menu-flyout .header-menu .proj-menu .ink-menu-list .member-tree-menu .title-bar-menu` | column, gap 2, padding 6, min-width 180 | — | — | — | |
| Menu item: `.custom-select-item .card-menu-item .menu-item .proj-menu-item .ink-menu-item .ms-item .title-bar-item` | — | hover tint (also `[data-highlighted]`) | press tint | `aria-checked/selected`: 600, accent-ink, ✓ | focus = inset 2px ring |
| Toast: `[data-sonner-toast]` | toast bg / fg | — | — | enter per tier | |
| Modal: `.modal` + scrim `.modal-backdrop` | card shadow | — | — | enter per tier; scrim fades `--wf-t-modal` | |
| Sheet: `.comments-sheet` | border-left, card shadow | — | — | slides in from 100% x | CRT: steps(4) |

## 3. Known deviations (decided; keep them, do not "fix")

- Press is **60ms** (the mock). The app's old docs say 150ms. Use 60ms.
- Focus ring colour is `--type-line` (falls back to accent) for contrast.
- CRT press sink 4px is derived from its 3px border.
- Popover background is `elev` where the theme defines it.
- The tab underline **grows** in place; it does not slide between tabs.
- Cards (`.card`, `.paper-card`, …) are **not** mapped in WP3: the status tint (`card-tint.css`) must keep winning.
- `.toggle` (a button with `.knob`) is **not** mapped; only the input switch `.appearance-switch` is.
- `.card-menu-trigger` loses its own opacity fade (states.css wins). Accepted.

## 4. Decisions (approved 2026-10-10)

WP3 below (States) supersedes any button-group wording here: the DS states.css decides raised vs flat.

- Page transitions run without the "Reactive motion" setting, in three tiers. Calm by default (small and short). Reactive motion on: bigger, with the title morph. CRT theme: its own stepped, scanline set. Reduced motion turns all of them off. See WP4.

- Button groups as listed. Raised: primary, secondary, chip link, .dashboard-customize-btn, .proj-chip, .custom-select-button. Flat: ghost, icon buttons, .card-menu-trigger, .header-overflow-btn, .list-toggle. Left alone: .dashboard-list-more-btn, .seg, title-bar, nav links.

- Text box: one click shows Delete under the Select and Text tools. Double-click edits local boxes under any tool.

- "Without side tray" = without the annotations side panel.

- Theme-toggle spin: out.

0.8.10 mock audit. Already in the code:

- Reader palette (1.1)

- Selected mark without the dashed outline (1.2)

## 5. Work packages (exact prompts; follow them exactly)

### WP1 — PDF text box: single click → Delete popover, double click → edit

Task: change how a text box on a PDF page reacts to clicks. Single click selects it and shows the mark popover (which offers Delete). Double click opens it for editing. Touch ONLY these files:
  A. apps/web/src/features/reader/application/mark-actions.ts
  B. apps/web/src/features/reader/application/test/mark-actions.test.ts
  C. apps/web/src/features/reader/ui/annotation-overlay.tsx
  D. apps/web/src/features/reader/ui/pdf-reader/pdf-reader.tsx

1) In A, add and export below markActions:
   /** A text box's popover shows under Select or Text; other marks under any tool. */
   export function markPopoverShown(ann: Pick<ReaderAnnotation, "type">, tool: string): boolean {
     return ann.type !== "text" || tool === "select" || tool === "text";
   }
2) In B, add tests: text + "select" → true; text + "text" → true; text + "highlight" → false; highlight + "highlight" → true.
   Run first WITHOUT step 1 to see it fail (import error is fine), then with it.

3) In C (annotation-overlay.tsx):
   - Add to AnnotationOverlayProps:  /** Double-click on a text box: edit it. */  onEditText?: (id: string) => void;
   - Destructure it with the other props.
   - On the non-picture <button className="pdf-reader-ann ..."> add:
       onDoubleClick={box.text != null && onEditText ? () => onEditText(box.id) : undefined}
   Do not change anything else in C.

4) In D (pdf-reader.tsx):
   a) In selectOnPage (~line 466) DELETE this block:
        if (canCreate && createTool === "text" && ann?.type === "text" && ann.origin === "local") {
          setEditingTextId(id);
          return;
        }
      Also remove `canCreate` from that useCallback's deps only if it is no longer used inside it, and remove the
      now-unused `const ann = ...` line only if nothing else uses it.
   b) In markPopover (~line 490) replace
        (ann.type === "text" && createTool !== "select")
      with
        !markPopoverShown(ann, createTool)
      and import markPopoverShown next to markActions.
   c) Add right after selectOnPage:
        // Double-click edits a text box this reader owns.
        const editTextOnPage = useCallback(
          (id: string) => {
            const ann = annotations.find((a) => a.id === id);
            if (!canCreate || ann?.type !== "text" || ann.origin !== "local") return;
            setMarkAt(null);
            setSelectedAnnId(id);
            setEditingTextId(id);
          },
          [annotations, canCreate],
        );
      (setSelectedAnnId / setEditingTextId are state setters, they need not be deps.)
   d) Line ~1538 `{!pendingCreate && canCreate && !penOpen && markPopover && (` →
      `{!pendingCreate && canCreate && (!penOpen || markPopover?.ann.type === "text") && markPopover && (`
   e) Line ~1585 comment + condition stays (a tap on a text box must not start a new box), but change the comment to:
        // A tap on a text box selects it; it does not start another box.
   f) Where <AnnotationOverlay onSelect={selectOnPage} ...> is rendered (~line 1620) add onEditText={editTextOnPage}.

Tests:
  cd apps/web
  TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/features/reader/application/test/mark-actions.test.ts src/features/reader/test/mark-popover.test.tsx
  npm run typecheck --workspace @weaveforge/web   (from repo root)
Report: the diff of each file and both outputs.

CDP proof: open a paper in Dev, Text tool, place a box. One click → .mark-popover present with a Delete button, no textarea. Delete → box gone and the annotation count drops by 1. New box, double click → textarea focused. Repeat with the pen tray open.





### WP2 — Notes ink: erasing the last stroke persists

Cause (reproduced in Dev): a page with 0 strokes saves bytes: null, and persist() writes nothing when bytes are null. The old chunk stays and the stroke comes back on reload. Fix: the worker says "cleared" only for a loaded, empty page. The store then removes the chunk.

Task: when the user erases the last stroke on an ink page, the page's stored chunk must be removed. Touch ONLY:
  A. apps/web/src/features/ink/worker/ink-page-logic.ts
  B. apps/web/src/features/ink/application/capture-protocol.ts
  C. apps/web/src/features/ink/ui/use-ink-worker-rpc.ts
  D. apps/web/src/features/ink/ui/use-ink-note-store.ts
  E. apps/web/src/features/ink/test/ink-worker.test.ts
(5 files: split into two builder runs, A+B+E first, then C+D.)

Run 1 (A, B, E):
 1) B, capture-protocol.ts ~line 222: the "page-saved" event type gets a new field
      /** True when a loaded page has no strokes: its stored chunk should go. */
      cleared: boolean;
 2) A, ink-page-logic.ts savePage (~line 158): widen the state param to
      Pick<InkPageState, "buffer" | "pageIndex" | "codec" | "loading">.
    The strokes === 0 branch posts { ..., bytes: null, strokes, cleared: !state.loading }.
    Every other page-saved post adds cleared: false.
    Fix every caller of savePage that now fails typecheck by passing the full state (do not invent values).
 3) E, ink-worker.test.ts: next to "an empty page saves as no bytes" (~line 195) add:
    - "an emptied loaded page saves as cleared": fresh(), draw one stroke, erase/clear it the way the existing tests do,
      send save, settle, assert last("page-saved").bytes === null and .cleared === true.
    - "a page still loading never reports cleared": send a load that has not settled, send save immediately,
      assert cleared === false.
    - In an existing non-empty save test assert cleared === false.
    Run E BEFORE step 2 to see the new asserts fail, then after.
  cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/features/ink/test/ink-worker.test.ts src/features/ink/test/capture-protocol.test.ts

Run 2 (C, D):
 4) C, use-ink-worker-rpc.ts: pendingSave resolves with { bytes: event.bytes, pageIndex: event.pageIndex, cleared: event.cleared }
    (lines ~92-95). requestSave (~125-131) returns Promise<{ bytes: Uint8Array | null; pageIndex: number; cleared: boolean }>.
    Export a type InkSave for that shape. Update ink-host.tsx callers at lines ~186 and ~243 ONLY by reading `.bytes`
    from the result (same behaviour as before). ink-host.tsx is the one extra file allowed here.
 5) D, use-ink-note-store.ts persist (~lines 122-138), replace the body inside trackInkWrite with:
      const saved = await requestSave();
      if (saved.bytes) {
        await chunks.write(noteId, current.chunkId, saved.bytes);
        current.chunk = saved.bytes;
        setChunkVersion((v) => v + 1);
      } else if (saved.cleared && saved.pageIndex === pageIndex && current.chunk) {
        // The last stroke went: drop the stored page so it does not come back.
        await chunks.remove(noteId, current.chunkId);
        current.chunk = null;
        setChunkVersion((v) => v + 1);
      }
      await saveBody();
    Keep `current` and pageIndex exactly as the code already defines them. Update the requestSave type at line ~47.
  npm run typecheck --workspace @weaveforge/web
  cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/features/ink/test/ink-chunk-store.test.ts src/features/ink/test/ink-worker.test.ts
Report: diffs + outputs.

CDP proof: in a fresh Dev note: draw one stroke, wait for the save, erase it, wait for the save, reload. Then the page has 0 strokes and the chunk row is gone from queryLocalDb. Same check with one stroke left out of two: that one survives.





### WP6 — Graph zoom: node and label sizes from the mock

Task: Touch ONLY:
  A. apps/web/src/features/relations/ui/graph-sizing.ts
  B. apps/web/src/features/relations/test/graph-sizing.test.ts
  C. apps/web/src/features/relations/ui/graph-canvas.tsx  (one line only, step 3)

Mock formula (bounded mode). z = graph zoom, base = node radius in graph units (already includes stamp scale):
  zz   = Math.max(0.01, z)
  s    = clamp(zz ** 0.45, 0.6, 3.2)
  R    = Math.max(5, base * s)            // on-screen px
  r    = R / zz                           // graph units
  line = Math.max(1.2, R * 0.13) / zz
  drop = Math.max(1.5, R * 0.18) / zz
  hit  = Math.max(r + line, 7 / zz)       // unchanged rule
  font = 10.5 * clamp(zz ** 0.35, 0.85, 2.2) / zz      (tags: same formula with 10 instead of 10.5)
  labelLine = Math.max(1, font * zz * 0.09) / zz
  gap  = 2 / zz

1) A: nodeSize(baseR, kind, zoom, bounded = true) — when bounded, return {r, line, drop, hit} per the formula.
   labelSize(kind, zoom, bounded) — when bounded, return {font, line: labelLine, gap}.
   When bounded === false keep the current code path byte-for-byte.
   Add a local `const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));` if none exists.
   Keep `kind` handling for anything else the current code does with it (read it first; keep it).
2) B: replace bounded-mode expectations with a table test, base = 6, zoom in [0.25, 0.5, 1, 2, 4, 8], computing
   expected values from the formula above inside the test (written out, not by calling the module), with
   assert within 1e-9. Add: R never below 5 (base 1, z 0.1 → r*z === 5); at z = 100 s caps at 3.2.
   Keep all unbounded-mode tests unchanged. Run B before step 1 to see it fail.
3) C, graph-canvas.tsx ~line 651: label y offset. It is currently
     y - r - (stamp ? gap + font * .4 : gap)
   change to
     y - r - gap - font * 0.4
   (mock: label always sits gap + 0.4em above the node). Nothing else in C.
Test: cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/features/relations/test/graph-sizing.test.ts src/features/relations/test/local-graph.test.ts ; npm run typecheck --workspace @weaveforge/web
Report: diff + outputs.

CDP proof: on the Graph page, set zoom to 0.3, 1, 3 and 8 through the canvas's zoom API (the fiber's zoom()). Screenshot each. Read one node's radius in screen pixels at each zoom, and check it matches R from the formula within 1px.



### WP4 — Page transitions: on by default, three tiers

Today transitions are gated on data-motion="reactive", which is off by default, so nobody sees them. New rule: they always run where the API exists, unless reduced motion is on. The look depends on the tier:


 | Tier | When | Forward / Back | Tab switch | Title morph

 | Calm | default (Reactive motion off) | 180ms cubic-bezier(.2,.7,.2,1). New page in from ±12px with a fade, old page out ∓6px with a fade. | 120ms cross-fade | no

 | Reactive | Reactive motion on | 260ms. New page in from ±48px, old page out ∓24px and shrinks to 0.985. | 160ms, new page rises 6px | yes, 300ms on --rm-spring

 | CRT | CRT theme (either motion setting) | Scanline wipe: new page uncovered top→bottom (Back: bottom→top) in 8 hard steps over 200ms. Old page flickers out in 2 steps over 120ms. | 3-step flicker, 120ms, brightness 1.6→1 | no

 | CRT + Reactive | both | Old page does a "power-off": it collapses to a bright line, then to a dot (220ms). The wipe starts 100ms in, with 12 steps over 280ms. | as CRT | no

 | Off | reduced motion, or no API | instant navigation (unchanged)




Task: Touch ONLY:
  A. apps/web/src/lib/view-transition.ts
  B. apps/web/src/lib/test/view-transition.test.ts
  C. apps/web/src/app/styles/motion.css

1) B FIRST. Replace the first test ("transitions run only with motion on...") with these two tests, and add
   motionTier to the import from "../view-transition":

test("tiers: calm by default, reactive with the setting, CRT by theme, off when reduced or unsupported", () => {
  const base = { motion: undefined, theme: undefined, reducedMotion: false, supported: true };
  assert.equal(motionTier(base), "calm");
  assert.equal(motionTier({ ...base, motion: "reactive" }), "reactive");
  assert.equal(motionTier({ ...base, theme: "crt" }), "crt");
  assert.equal(motionTier({ ...base, theme: "crt", motion: "reactive" }), "crt");
  assert.equal(motionTier({ ...base, theme: "brutal" }), "calm");
  assert.equal(motionTier({ ...base, reducedMotion: true }), "off");
  assert.equal(motionTier({ ...base, motion: "reactive", theme: "crt", reducedMotion: true }), "off");
  assert.equal(motionTier({ ...base, supported: false }), "off");
});

test("transitions run without the motion setting, never when reduced", () => {
  const base = { motion: undefined, theme: undefined, reducedMotion: false, supported: true };
  assert.equal(transitionsOn(base), true);
  assert.equal(transitionsOn({ ...base, reducedMotion: true }), false);
  assert.equal(transitionsOn({ ...base, supported: false }), false);
});

   Run: cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/lib/test/view-transition.test.ts
   It MUST fail now (motionTier missing). Paste that failure.

2) A, lib/view-transition.ts:
   - Header comment: replace its body with one line:
     "Page transitions through the View Transitions API, in three tiers (calm, reactive, CRT); the look is in motion.css under :root[data-nav]."
   - Replace transitionsOn and its doc comment with:

export type MotionTier = "off" | "calm" | "reactive" | "crt";
type TierInput = { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean };

/** Calm by default, bigger with Reactive motion, stepped on CRT; off when reduced or unsupported. */
export function motionTier(input: TierInput): MotionTier {
  if (!input.supported || input.reducedMotion) return "off";
  if (input.theme === "crt") return "crt";
  return input.motion === "reactive" ? "reactive" : "calm";
}

export function transitionsOn(input: TierInput): boolean {
  return motionTier(input) !== "off";
}

   - Replace canTransition() with currentTier() + canTransition():

function currentTier(): MotionTier {
  if (typeof document === "undefined") return "off";
  const root = document.documentElement;
  return motionTier({
    motion: root.dataset.motion,
    theme: root.dataset.theme,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    supported: startFn() !== null,
  });
}

export function canTransition(): boolean {
  return currentTier() !== "off";
}

   - In navTransition: replace `if (!start || !canTransition()) {` with
       const tier = currentTier();
       if (!start || tier === "off") {
     and replace the `const title = ...` line with
       // Only the reactive tier morphs the card title into the page title.
       const title = kind === "forward" && tier === "reactive" && lastPressTitle?.isConnected ? lastPressTitle : null;
   - Change nothing else in the file.

3) C, motion.css. Find the block that starts at the comment
   "/* ---- Page transitions (lib/view-transition.ts sets data-nav for one navigation) ----"
   and ends at the closing brace of the @media (prefers-reduced-motion: reduce) block that holds
   "::view-transition-group(*)". Replace that WHOLE block with exactly:

/* ---- Page transitions (lib/view-transition.ts sets data-nav for one navigation) ----
   Calm by default, bigger under Reactive motion, stepped scanlines on CRT. */
:root[data-nav] .page-transition {
  view-transition-name: vt-page;
  animation: none;
}
:root[data-nav="forward"][data-motion="reactive"]:not([data-theme="crt"]) :is(.record-title, .paper-article-title) { view-transition-name: vt-title; }

/* Calm (default) */
::view-transition-old(vt-page),
::view-transition-new(vt-page) { animation-duration: 180ms; animation-timing-function: cubic-bezier(.2, .7, .2, 1); }
:root[data-nav="forward"]::view-transition-old(vt-page) { animation-name: vt-out-left; }
:root[data-nav="forward"]::view-transition-new(vt-page) { animation-name: vt-in-right; }
:root[data-nav="back"]::view-transition-old(vt-page) { animation-name: vt-out-right; }
:root[data-nav="back"]::view-transition-new(vt-page) { animation-name: vt-in-left; }
:root[data-nav="tab"]::view-transition-old(vt-page),
:root[data-nav="tab"]::view-transition-new(vt-page) { animation-duration: 120ms; }

/* Reactive */
:root[data-motion="reactive"]::view-transition-old(vt-page),
:root[data-motion="reactive"]::view-transition-new(vt-page) { animation-duration: 260ms; --vt-in: 48px; --vt-out: 24px; --vt-shrink: 0.985; }
:root[data-motion="reactive"][data-nav="tab"]::view-transition-old(vt-page),
:root[data-motion="reactive"][data-nav="tab"]::view-transition-new(vt-page) { animation-duration: 160ms; }
:root[data-motion="reactive"][data-nav="tab"]::view-transition-new(vt-page) { animation-name: vt-rise; }
::view-transition-group(vt-title) { animation-duration: 300ms; animation-timing-function: var(--rm-spring); }

/* CRT: hard steps, no slide. Listed last so it wins over Reactive at equal specificity. */
:root[data-theme="crt"][data-nav]::view-transition-old(vt-page) { animation: vt-fade-out 120ms steps(2, end) both; }
:root[data-theme="crt"][data-nav="forward"]::view-transition-new(vt-page) { animation: vt-wipe-down 200ms steps(8, end) both; }
:root[data-theme="crt"][data-nav="back"]::view-transition-new(vt-page) { animation: vt-wipe-up 200ms steps(8, end) both; }
:root[data-theme="crt"][data-nav="tab"]::view-transition-new(vt-page) { animation: vt-flicker-in 120ms steps(3, end) both; }
:root[data-theme="crt"][data-nav="tab"]::view-transition-old(vt-page) { animation: vt-fade-out 120ms steps(3, end) both; }
/* CRT + Reactive: the old page powers off, then the wipe. */
:root[data-theme="crt"][data-motion="reactive"]:is([data-nav="forward"], [data-nav="back"])::view-transition-old(vt-page) { animation: vt-power-off 220ms ease-in both; }
:root[data-theme="crt"][data-motion="reactive"][data-nav="forward"]::view-transition-new(vt-page) { animation: vt-wipe-down 280ms steps(12, end) 100ms both; }
:root[data-theme="crt"][data-motion="reactive"][data-nav="back"]::view-transition-new(vt-page) { animation: vt-wipe-up 280ms steps(12, end) 100ms both; }

/* The shell stays put; only the page moves. */
::view-transition-old(root),
::view-transition-new(root) { animation: none; }

@keyframes vt-in-right { from { translate: var(--vt-in, 12px) 0; opacity: 0; } }
@keyframes vt-in-left { from { translate: calc(-1 * var(--vt-in, 12px)) 0; opacity: 0; } }
@keyframes vt-out-left { to { translate: calc(-1 * var(--vt-out, 6px)) 0; scale: var(--vt-shrink, 1); opacity: 0; } }
@keyframes vt-out-right { to { translate: var(--vt-out, 6px) 0; scale: var(--vt-shrink, 1); opacity: 0; } }
@keyframes vt-rise { from { translate: 0 6px; opacity: 0; } }
@keyframes vt-fade-out { to { opacity: 0; } }
@keyframes vt-wipe-down { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0); } }
@keyframes vt-wipe-up { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0); } }
@keyframes vt-flicker-in { from { opacity: 0; filter: brightness(1.6); } to { opacity: 1; filter: brightness(1); } }
@keyframes vt-power-off {
  60% { scale: 1 0.02; filter: brightness(2.2); opacity: 1; }
  to { scale: 0 0.02; filter: brightness(2.2); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) { animation: none !important; }
}

   Do not edit any other rule in motion.css.

4) Run:
   cd apps/web && TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx --test src/lib/test/view-transition.test.ts
   npm run typecheck --workspace @weaveforge/web
   grep -rn "transitionsOn\|canTransition" apps/web/src --include=*.ts --include=*.tsx
   (every caller must still compile; transitionsOn now also needs `theme`; fix only callers in files A/B,
   and if another file calls transitionsOn, STOP and report it instead of editing it.)
Report: the failing run from step 1, the diff, and the outputs from step 4.

CDP proof, run once for each tier: calm (default), reactive (localStorage thesis.reactiveMotion=1), CRT, CRT plus reactive. Each time:


- Hook document.startViewTransition to count calls.

- Click Papers → a paper, then Back, then switch tab.

- During each transition, read the animationName, duration and easing of every entry in document.getAnimations().


Expect:


- Calm: 180ms, vt-in-right / vt-in-left, no vt-title group.

- Reactive: 260ms, plus a vt-title group on forward.

- CRT: vt-wipe-down / vt-wipe-up with steps(8, end).

- CRT + reactive: vt-power-off, and the wipe has a 100ms delay.

- Reduced motion emulated: 0 calls in every tier.


Also capture one mid-transition screenshot per tier, using Animation.setPlaybackRate 0.1.





### WP3 — States and motion for every control (replaces the old "Unified buttons" WP)

Source of truth: the design system bundle (`bundle.css`, attached and in Appendix D). `states.css` (Appendix A) is that bundle with the app's class names aliased onto the `.wf-*` classes and `:root:root` added so it beats older theme rules. **Do not hand-edit values.** If a value must change, change the DS `bundle.css` and regenerate with Appendix B.

Steps, exactly:

**A.** Create `apps/web/src/app/styles/states.css` with the content of Appendix A, byte for byte (or copy the attached `states.css`). Check: the file has 425 lines and starts with `/* States and motion for every control`.

**B.** In `apps/web/src/app/styles/index.css`, line 43 is `@import "./brutal.css";` and line 44 is `@import "./card-tint.css"; /* Status tint for every theme. Last: wins ties. */`. Insert one new line between them:

```css
@import "./states.css"; /* Control states and motion from the design system. */
```

Nothing else changes in index.css. `card-tint.css` must stay last.

**C.** In `apps/web/src/app/styles/editor-workspace.css` near line 1989, the rule `.ink-swatch:hover` has `transform: scale(1.18);`. Delete that one declaration (it stacks with the states.css `scale`). If the rule is then empty, delete the empty rule. Touch nothing else in that file.

Do **not** edit `reader.css` `.pdf-reader-pop-swatch:hover { scale: 1.08 }` (states.css already wins). Do not map or restyle cards.

**Before/after:** before step A, take the screenshots listed below (same pages, window 1280×800) so the person can compare.

**Acceptance (Chromium, over CDP on the Dev build, port 9223).** For each class below, read `getComputedStyle` at rest, while hovered (`Input.dispatchMouseEvent` `mouseMoved` onto its centre, wait 400ms), and while pressed (`mousePressed`, wait 200ms, read, then `mouseReleased`). Paste a table of the numbers.

| Check | Calm, Paper | Calm, Poster (`brutal`) | Calm, CRT | Reactive, Paper |
|---|---|---|---|---|
| `.btn-primary` hover `translate` | `0px -1px` | `0px -1px` | `0px -1px` | `0px -2px` |
| `.btn-primary` press `translate` | `1px 1px` | `3px 3px` | `4px 4px` | `1px 1px` |
| `.btn-primary` press `box-shadow` | `none` | `none` | `none` | `none` |
| `.btn-primary` `transition-timing-function` (first) | `cubic-bezier(0.2, 0.7, 0.2, 1)` | same | starts with `steps(` | contains `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `.btn-primary` `border-top-width` | `1px` | `2px` | `3px` | `1px` |
| `.btn-primary` focused with Tab: `outline` | `3px solid …`, offset `2px` | same | same | same |
| `.back-btn` hover: `.back-btn-box` translate / arrow x | `0px -1px` / `-2px` | same | same | `0px -2px` / `-4px` |
| `.ink-swatch` hover `scale` | `1.08` | `1.08` | `1.08` | `1.15` |
| `.custom-select-menu` opened, final `opacity` | `1` | `1` | `1` (clip-path wipe) | `1` |
| `.sub-tab` selected underline `::after` `scale` | `1 1` | same | same | same |

Reduced motion (`Emulation.setEmulatedMedia` with `features: [{ name: "prefers-reduced-motion", value: "reduce" }]`): `.btn-primary` `transition-duration` is all `0s`.

Also: Tab through Settings and confirm every focused control shows the 3px ring (screenshot). Disabled `.btn-primary`: opacity `0.5`, hover translate unchanged from rest.

**Screenshots** (1280×800): Dashboard, a paper in the reader with a popover open, Settings, a Notes page with the ink toolbar, and an open `.custom-select-menu`, in each of: Paper (no theme), `dark` (Slate), `brutal`, `brutal-dark`, `crt`. Set the theme with `document.documentElement.dataset.theme = "<name>"` (Paper: `delete document.documentElement.dataset.theme`).

**Report, do not fix:** any control that looks broken (clipped, wrong size, overflowing text) after the change: class, page, theme, screenshot. Expected and accepted: icon buttons become 34×34 (28×28 small); button padding and font follow the DS.

### WP5 — Back button

No code. Covered by WP3 (`.back-btn` → `wf-back`, `.back-btn-box` → `wf-back-box`; structure is `<Link|button class="back-btn"><span class="back-btn-box">…</span><span class="back-btn-label">…</span>`). Proof: the `.back-btn` row of the WP3 acceptance table, plus `transition-timing-function` of `.back-btn-box` = `cubic-bezier(0.2, 0.7, 0.2, 1)` in Calm.

## 6. Tests and typecheck

From the repo root:

| Area | Test | Typecheck |
|---|---|---|
| `apps/web` | `npm run test:web` | `npm run typecheck --workspace @weaveforge/web` |
| `packages/core` | `npm run test:core` | `npm run typecheck --workspace @weaveforge/core` |
| `apps/desktop` | `npm run test:desktop` | `npm run typecheck --workspace @weaveforge/desktop` |

One file: `cd apps/web && node --import tsx --test <path-to-test>`. One test: `npm run test:web -- --test-name-pattern "<name>"`. Tests sit in a `test/` folder beside the feature. Fail-first: run the new test against the old code and paste the failure.

## 7. WeaveForge Dev build, CDP, final gate

**Build** (~5 min), from `apps/desktop`:

```bash
node scripts/build.mjs && node scripts/build-web.mjs && ls dist/web && npx electron-builder --win --arm64 --dir --publish never -c.appId=dev.weaveforge.desktop.dev -c.productName="WeaveForge Dev" -c.extraMetadata.name=weaveforge-dev -c.extraMetadata.productName="WeaveForge Dev"
```

Bundle proof: `grep -rl "markPopoverShown" dist/web/_next/static/chunks`, and the same for `cleared` and `wf-press`; each must print at least one file. Then `git status`: no route files deleted.

**Install and launch** (PowerShell). Stop Dev **only by path**; never stop `WeaveForge.exe`:

```powershell
Get-Process | ? { $_.Path -like "$env:LOCALAPPDATA\Programs\WeaveForge Dev\*" } | Stop-Process -Force
Copy-Item -Recurse -Force "apps\desktop\release\win-arm64-unpacked\*" "$env:LOCALAPPDATA\Programs\WeaveForge Dev"
& "$env:LOCALAPPDATA\Programs\WeaveForge Dev\WeaveForge Dev.exe" --remote-debugging-port=9223
```

Dev has its own data (`%APPDATA%\WeaveForge Dev\`, `~/.weaveforge/desktop-dev.json`). Open a new or demo project, never the person's workspace. `EADDRINUSE` on port 53682 is harmless.

**CDP helper** (keep it in a scratch folder, not the repo). `http://127.0.0.1:9223/json` lists targets; use the one with `type === "page"`:

```js
// cdp.mjs
import { writeFileSync } from "node:fs";
const list = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (ev) => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
export const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
export const run = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed"); return r.result.result.value; };
export const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.result.data, "base64")); };
export const close = () => ws.close();
```

Conventions:
- Navigate with `location.href = "app://weaveforge/<route>/?..."`; routes end in `/`.
- Wrap `run()` bodies in `String.raw`.
- Set widths with `Emulation.setDeviceMetricsOverride` (`deviceScaleFactor: 1`, `mobile: false`), then `clearDeviceMetricsOverride`.
- Clicks and drags: `Input.dispatchMouseEvent` in CSS pixels. Keys: `Input.dispatchKeyEvent` (`modifiers: 2` = Ctrl).
- Local DB: `window.weaveforge.queryLocalDb(sql, params)`.
- Offline, the reader shows "Load PDF…": click it, then wait for `.pdf-reader-page`.
- Ignore two `Uncaught (in promise)` errors from the collab provider when leaving Edit mode offline.

**Final gate (all must pass):**
- `npm run test:web` and the web typecheck pass. Paste the summary lines.
- Every WP's own tests pass, with the fail-first output shown.
- Dev build, bundle greps and `git status` as above.
- Every CDP proof in every WP, with numbers and screenshots.
- Then stop. Do not release, commit or push.

## 8. Report format

For each WP: files changed (diff), commands run with output, CDP numbers, screenshot file names, and a "Deviations" list (anything that did not match this document, and what you did, which should be "stopped and reported").

## Appendix A — states.css (copy byte for byte to apps/web/src/app/styles/states.css)

```css
/* States and motion for every control, from the design system bundle; generated, edit the DS then regenerate. */

/* ---------- Tiers ---------- */
:root {
  --wf-bw: 1px; --wf-press: 1px; --wf-lift: -1px;
  --wf-rc: 8px; --wf-rp: 10px; --wf-rm: 6px; --wf-rcard: 14px;
  --wf-t: 120ms; --wf-t-press: 60ms; --wf-t-pop: 120ms; --wf-t-exit: 80ms; --wf-t-modal: 180ms;
  --wf-ease: cubic-bezier(.2, .7, .2, 1); --wf-ease-hover: var(--wf-ease); --wf-ease-pop: var(--wf-ease);
  --wf-pop-y: 6px; --wf-pop-s: 1; --wf-tip-y: 4px; --wf-toast-y: 12px; --wf-modal-y: 8px; --wf-modal-s: .98;
  --wf-stagger: 0ms; --wf-item-anim: none; --wf-sw-hover: 1.08; --wf-back-x: -2px;
  --wf-line: var(--border-strong);
  --wf-hover-pct: 6%;
  --wf-hover: color-mix(in srgb, var(--text) var(--wf-hover-pct), transparent);
  --wf-press-bg: color-mix(in srgb, var(--text) calc(var(--wf-hover-pct) + 8%), transparent);
  --wf-focus: var(--type-line, var(--accent));
  --wf-accent-ink: var(--accent-ink, var(--accent));
  --wf-surface2: var(--surface2, var(--surface-2));
  --wf-danger: var(--danger-text, var(--s-danger));
  --wf-danger-soft: var(--danger-soft, var(--s-danger-bg));
  --wf-danger-fill: var(--danger-fill, var(--s-danger));
  --wf-toast-bg: var(--toast-bg, var(--text));
  --wf-toast-fg: var(--toast-fg, var(--bg));
  --wf-field-bg: var(--type-bg, var(--bg));
  --wf-field-sh: var(--type-sh, 0 0 0 2px var(--accent));
  --wf-field-t: none;
  --wf-sh-rest: var(--sh-sm, 0 1px 2px rgba(30, 30, 40, .08));
  --wf-sh-up: var(--sh-btn, 0 2px 4px rgba(30, 30, 40, .07), 0 10px 24px rgba(30, 30, 40, .07));
  --wf-sh-card: var(--sh-card, var(--wf-sh-rest));
  --wf-tip-sh: none;
  --wf-font: var(--btn-font, var(--font-face-sans, var(--font-sans, system-ui)));
  --wf-fs: 14px; --wf-fs-sm: 13px; --wf-fs-ghost: var(--wf-fs); --wf-fw: 600;
}
/* Slate: dark soft themes */
:root:is([data-theme="dark"], [data-theme="mocha"], [data-theme="dracula"], [data-theme="amoled"], [data-theme="contrast"], [data-theme="vivid-dark"], [data-theme="pastel-dark"], [data-theme="confetti-dark"]) {
  --wf-hover-pct: 7%;
  --wf-sh-rest: var(--sh-sm, 0 1px 2px rgba(0, 0, 0, .4));
  --wf-sh-up: var(--sh-btn, 0 2px 4px rgba(0, 0, 0, .42), 0 10px 24px rgba(0, 0, 0, .38));
}
/* Poster */
:root:is([data-theme="brutal"], [data-theme="brutal-dark"]) {
  --wf-bw: 2px; --wf-press: 3px; --wf-rc: 6px; --wf-rm: 4px; --wf-rcard: 6px; --wf-hover-pct: 8%;
  --wf-sh-rest: 3px 3px 0 var(--wf-line);
  --wf-sh-up: 4px 4px 0 var(--wf-line);
  --wf-tip-sh: var(--wf-sh-rest);
  --wf-field-t: translate(-2px, -2px);
}
:root[data-theme="brutal-dark"] { --wf-hover-pct: 10%; }
/* CRT: thicker ink, hard steps, pixel face on controls */
:root[data-theme="crt"] {
  --wf-bw: 3px; --wf-press: 4px; --wf-rc: 8px; --wf-rm: 6px; --wf-rcard: 12px; --wf-hover-pct: 8%;
  --wf-ease: steps(3, end); --wf-ease-hover: steps(2, end); --wf-ease-pop: steps(4, end);
  --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px;
  --wf-sh-rest: var(--sh-sm, 3px 3px 0 #2b222b);
  --wf-sh-up: var(--sh-btn, 5px 5px 0 #12466e);
  --wf-tip-sh: var(--wf-sh-rest);
  --wf-field-t: translateY(-2px);
  --wf-font: var(--btn-font, var(--font-pixel)); --wf-fs: 1.25rem; --wf-fs-sm: 1.1rem; --wf-fs-ghost: 1.15rem; --wf-fw: 400;
}
/* Reactive motion: longer, springier, further */
:root[data-motion="reactive"] {
  --wf-t: 200ms; --wf-t-pop: 200ms; --wf-t-modal: 260ms; --wf-lift: -2px;
  --wf-ease-hover: cubic-bezier(.34, 1.56, .64, 1); --wf-ease-pop: cubic-bezier(.34, 1.56, .64, 1);
  --wf-pop-y: 10px; --wf-pop-s: .97; --wf-tip-y: 6px; --wf-toast-y: 16px; --wf-modal-y: 16px; --wf-modal-s: .94;
  --wf-stagger: 18ms; --wf-item-anim: wf-item-in; --wf-sw-hover: 1.15; --wf-back-x: -4px;
}
/* CRT + Reactive: more steps, still no slide */
:root[data-theme="crt"][data-motion="reactive"] {
  --wf-t: 160ms; --wf-t-pop: 160ms; --wf-t-modal: 220ms;
  --wf-ease: steps(4, end); --wf-ease-hover: steps(4, end); --wf-ease-pop: steps(6, end);
  --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px;
}
@media (prefers-reduced-motion: reduce) {
  :root:root:root:root {
    --wf-t: 0ms; --wf-t-press: 0ms; --wf-t-pop: 0ms; --wf-t-exit: 0ms; --wf-t-modal: 0ms;
    --wf-lift: 0px; --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px; --wf-toast-y: 0px; --wf-modal-y: 0px; --wf-modal-s: 1;
    --wf-stagger: 0ms; --wf-item-anim: none; --wf-sw-hover: 1; --wf-back-x: 0px;
  }
}

/* ---------- Shared ---------- */
:root:root :is(:is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-back, .back-btn), :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn), :is(.wf-seg, .seg) > button, :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab), :is(.wf-nav, .nav-link, .header-link), :is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip), :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick), :is(.wf-toggle, .appearance-switch), :is(.wf-check, .themed-check, .milestone-check), .wf-radio, :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item), :is(.wf-select, .custom-select-button), .wf-card) {
  -webkit-tap-highlight-color: transparent;
}
:root:root :is(:is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-back, .back-btn), :is(.wf-link, .link-btn, .link, .auth-link, .auth-link-sm), :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn), :is(.wf-seg, .seg) > button, :is(.wf-nav, .nav-link, .header-link), a:is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip), button:is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip), :is(.wf-chip-x, .filter-chip-x, .jump-to-chip-remove, .tag-del), :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick), :is(.wf-toggle, .appearance-switch), :is(.wf-check, .themed-check, .milestone-check), .wf-radio, .wf-card):is(:focus-visible, [data-force~="focus"]) {
  outline: 3px solid var(--wf-focus); outline-offset: 2px;
}
:root:root :is(:is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-back, .back-btn), :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn), :is(.wf-seg, .seg) > button, :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab), :is(.wf-nav, .nav-link, .header-link), :is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip), :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick), :is(.wf-toggle, .appearance-switch), :is(.wf-check, .themed-check, .milestone-check), .wf-radio, :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item), :is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input), :is(.wf-select, .custom-select-button)):is(:disabled, [aria-disabled="true"]) {
  opacity: .5; cursor: not-allowed;
}

/* ---------- Button ---------- */
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle) {
  --wf-bg: var(--surface); --wf-fg: var(--text); --wf-bd: var(--wf-line);
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: var(--wf-font); font-size: var(--wf-fs); font-weight: var(--wf-fw); line-height: 1.15;
  padding: 7px 13px; border: var(--wf-bw) solid var(--wf-bd); border-radius: var(--wf-rc);
  background: var(--wf-bg); color: var(--wf-fg); box-shadow: var(--wf-sh-rest);
  cursor: pointer; user-select: none; translate: 0 0; white-space: nowrap;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease),
    background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  translate: var(--wf-press) var(--wf-press); box-shadow: none; transition-duration: var(--wf-t-press);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-primary, .btn-primary) { --wf-bg: var(--accent); --wf-fg: var(--accent-fg); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle).wf-soft { --wf-bg: var(--accent-soft); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-danger, .btn-danger) { --wf-bg: var(--wf-danger-fill); --wf-fg: var(--accent-fg); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:is(.wf-ghost, .btn-ghost, .btn-cancel, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn), .wf-danger-ghost) {
  --wf-bg: transparent; --wf-bd: transparent; box-shadow: none; font-size: var(--wf-fs-ghost);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle).wf-danger-ghost { --wf-fg: var(--wf-danger); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:is(.wf-ghost, .btn-ghost, .btn-cancel, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn)):is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bd: var(--wf-line); --wf-bg: var(--wf-hover); box-shadow: var(--wf-sh-rest);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle).wf-danger-ghost:is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bd: var(--wf-danger); --wf-bg: var(--wf-danger-soft); box-shadow: var(--wf-sh-rest);
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:is(.wf-ghost, .btn-ghost, .btn-cancel, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn), .wf-danger-ghost):is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bg: var(--wf-press-bg); translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); box-shadow: none;
}
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle).wf-danger-ghost:is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { --wf-bg: var(--wf-danger-soft); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn) { width: 34px; height: 34px; padding: 5px; }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn) svg { width: 18px; height: 18px; flex: none; }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-sm, .btn-sm) { padding: 5px 10px; font-size: var(--wf-fs-sm); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn):is(.wf-sm, .btn-sm) { width: 28px; height: 28px; padding: 4px; }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:disabled, [aria-disabled="true"]) { box-shadow: var(--wf-sh-rest); }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle):is(:is(.wf-ghost, .btn-ghost, .btn-cancel, .card-menu-trigger, .header-overflow-btn, .list-toggle), :is(.wf-icon, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn), .wf-danger-ghost):is(:disabled, [aria-disabled="true"]) { box-shadow: none; }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle)[aria-busy="true"] { cursor: progress; color: transparent; }
:root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle)[aria-busy="true"]::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 14px; height: 14px; box-sizing: border-box;
  border: 2px solid var(--wf-fg); border-right-color: transparent; border-radius: 50%;
  animation: wf-spin .7s linear infinite;
}
:root:root:root[data-theme="crt"] :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle)[aria-busy="true"]::after { border-radius: 2px; animation-timing-function: steps(8, end); }

/* ---------- Back button ---------- */
:root:root :is(.wf-back, .back-btn) {
  display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none;
  color: var(--text); font-family: var(--wf-font); font-size: var(--wf-fs); font-weight: var(--wf-fw); cursor: pointer;
  border-radius: var(--wf-rc);
}
:root:root :is(.wf-back-box, .back-btn-box) {
  display: grid; place-items: center; width: 34px; height: 34px; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc); background: var(--surface);
  box-shadow: var(--wf-sh-rest); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-back-box, .back-btn-box) svg { width: 18px; height: 18px; translate: 0 0; transition: translate var(--wf-t) var(--wf-ease-hover); }
:root:root :is(.wf-back, .back-btn):is(:hover, [data-force~="hover"]):not(:disabled) :is(.wf-back-box, .back-btn-box) { translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up); background: var(--accent-soft); }
:root:root :is(.wf-back, .back-btn):is(:hover, [data-force~="hover"]):not(:disabled) :is(.wf-back-box, .back-btn-box) svg { translate: var(--wf-back-x) 0; }
:root:root :is(.wf-back, .back-btn):is(:active, [data-force~="press"]):not(:disabled) :is(.wf-back-box, .back-btn-box) { translate: var(--wf-press) var(--wf-press); box-shadow: none; transition-duration: var(--wf-t-press); }

/* ---------- Link ---------- */
:root:root :is(.wf-link, .link-btn, .link, .auth-link, .auth-link-sm) {
  color: var(--wf-accent-ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); cursor: pointer; border-radius: 2px;
  transition: text-decoration-color var(--wf-t) var(--wf-ease), text-decoration-thickness var(--wf-t) var(--wf-ease), opacity var(--wf-t-press) linear;
}
:root:root :is(.wf-link, .link-btn, .link, .auth-link, .auth-link-sm):is(:hover, [data-force~="hover"]) { text-decoration-color: currentColor; text-decoration-thickness: 2px; }
:root:root :is(.wf-link, .link-btn, .link, .auth-link, .auth-link-sm):is(:active, [data-force~="press"]) { opacity: .7; }

/* ---------- Tool toggle ---------- */
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn) {
  display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; box-sizing: border-box;
  border: var(--wf-bw) solid transparent; border-radius: var(--wf-rc); background: transparent; color: var(--text); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease), filter var(--wf-t-press) linear;
}
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn) svg { width: 18px; height: 18px; }
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn):is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { border-color: var(--wf-line); background-color: var(--wf-hover); }
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn):is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn):is([aria-pressed="true"], .seg-on, .is-active, .is-selected, .sel, .on, .active, [aria-checked="true"]) { background-color: var(--accent); color: var(--accent-fg); border-color: var(--wf-line); }
:root:root :is(.wf-tool, .ink-tool, .pdf-reader-create-icon, .pdf-reader-pop-btn):is([aria-pressed="true"], .seg-on, .is-active, .is-selected, .sel, .on, .active, [aria-checked="true"]):is(:active, [data-force~="press"]) { filter: brightness(.94); }

/* ---------- Segmented ---------- */
:root:root :is(.wf-seg, .seg) { display: inline-flex; gap: 4px; }
:root:root :is(.wf-seg, .seg) > button {
  font-family: var(--wf-font); font-size: var(--wf-fs-sm); font-weight: var(--wf-fw); line-height: 1.2;
  padding: 4px 10px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc);
  background: var(--surface); color: var(--text); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease), filter var(--wf-t-press) linear;
}
:root:root :is(.wf-seg, .seg) > button:is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--surface)); }
:root:root :is(.wf-seg, .seg) > button:is(:active, [data-force~="press"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) calc(var(--wf-hover-pct) + 8%), var(--surface)); transition-duration: var(--wf-t-press); }
:root:root :is(.wf-seg, .seg) > button:is([aria-pressed="true"], .seg-on, .is-active, .is-selected, .sel, .on, .active, [aria-checked="true"], [aria-selected="true"]) { background-color: var(--accent); color: var(--accent-fg); }
:root:root :is(.wf-seg, .seg) > button:is([aria-pressed="true"], .seg-on, .is-active, .is-selected, .sel, .on, .active, [aria-checked="true"], [aria-selected="true"]):is(:active, [data-force~="press"]) { filter: brightness(.94); }

/* ---------- Tabs ---------- */
:root:root .wf-tabs { display: flex; gap: 2px; border-bottom: var(--wf-bw) solid var(--wf-line); }
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab) {
  position: relative; padding: 8px 12px; border: 0; border-radius: var(--wf-rc) var(--wf-rc) 0 0; background: transparent;
  color: var(--muted); font: inherit; font-size: var(--wf-fs-sm); font-weight: 600; cursor: pointer;
  transition: color var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab)::after {
  content: ""; position: absolute; left: 8px; right: 8px; bottom: calc(-1 * var(--wf-bw)); height: 3px;
  background: var(--wf-accent-ink); scale: 0 1; transition: scale var(--wf-t) var(--wf-ease-hover);
}
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab):is(:hover, [data-force~="hover"]):not(:disabled) { color: var(--text); background-color: var(--wf-hover); }
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab):is(:active, [data-force~="press"]):not(:disabled) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab):is([aria-selected="true"], [aria-current="page"], .active, .is-active) { color: var(--text); }
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab):is([aria-selected="true"], [aria-current="page"], .active, .is-active)::after { scale: 1 1; }
:root:root :is(.wf-tab, .sub-tab, .pane-tab, .graph-drawer-tab, .mcp-tab):is(:focus-visible, [data-force~="focus"]) { outline: 3px solid var(--wf-focus); outline-offset: -3px; }

/* ---------- Nav item ---------- */
:root:root :is(.wf-nav, .nav-link, .header-link) {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--wf-rc);
  color: var(--text); text-decoration: none; font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-nav, .nav-link, .header-link):is(:hover, [data-force~="hover"]) { background-color: var(--wf-hover); }
:root:root :is(.wf-nav, .nav-link, .header-link):is(:active, [data-force~="press"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
:root:root :is(.wf-nav, .nav-link, .header-link):is([aria-current="page"], .active) { background-color: var(--accent-soft); color: var(--wf-accent-ink); font-weight: 600; }

/* ---------- Chip ---------- */
:root:root :is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip) {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: var(--wf-bw) solid var(--wf-line);
  border-radius: 999px; background: var(--surface); color: var(--text); text-decoration: none;
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; font-weight: 600; line-height: 1.3;
}
:root:root :is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip).wf-ext { border-style: dashed; }
:root:root :is(a, button):is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip) {
  cursor: pointer; box-shadow: var(--wf-sh-rest); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
:root:root a:is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip)[href]::after { content: "\2197"; }
:root:root :is(a, button):is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip):is(:hover, [data-force~="hover"]):not(:disabled) { translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up); }
:root:root :is(a, button):is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip):is(:active, [data-force~="press"]):not(:disabled) { translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); box-shadow: none; transition-duration: var(--wf-t-press); }
:root:root button:is(.wf-chip, .tag-chip, .git-chip, .jump-to-chip, .graph-chip)[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
:root:root :is(.wf-chip-x, .filter-chip-x, .jump-to-chip-remove, .tag-del) {
  display: inline-grid; place-items: center; width: 16px; height: 16px; margin-right: -4px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-chip-x, .filter-chip-x, .jump-to-chip-remove, .tag-del):is(:hover, [data-force~="hover"]) { background: var(--wf-danger-soft); color: var(--wf-danger); }
:root:root :is(.wf-chip-x, .filter-chip-x, .jump-to-chip-remove, .tag-del):is(:active, [data-force~="press"]) { scale: .9; }

/* ---------- Swatch ---------- */
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick) {
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--sw, var(--accent)); cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent); scale: 1;
  transition: scale var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick):is(:hover, [data-force~="hover"]) { scale: var(--wf-sw-hover); }
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick):is(:active, [data-force~="press"]) { scale: .94; transition-duration: var(--wf-t-press); }
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick):is([aria-pressed="true"], .seg-on, .is-active, .is-selected, .sel, .on, .active, [aria-checked="true"]) { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick):is(:focus-visible, [data-force~="focus"]) { outline-offset: 5px; }
:root:root :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop) :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick) { width: 22px; height: 22px; }
:root:root :is(.wf-swatch, .ink-swatch, .pdf-reader-pop-swatch, .pdf-reader-create-swatch, .pdf-reader-pill-swatch, .list-color-pick).wf-current { width: 30px; height: 30px; }

/* ---------- Toggle (input type=checkbox role=switch) ---------- */
:root:root :is(.wf-toggle, .appearance-switch) {
  appearance: none; position: relative; flex: none; width: 36px; height: 20px; margin: 0; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: 999px; background: var(--wf-surface2); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-toggle, .appearance-switch)::before {
  content: ""; position: absolute; top: 2px; left: 2px; width: calc(20px - 2 * var(--wf-bw) - 4px); height: calc(20px - 2 * var(--wf-bw) - 4px);
  border-radius: 999px; background: var(--muted); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), width var(--wf-t-press) linear, background-color var(--wf-t) var(--wf-ease);
}
:root:root :is(.wf-toggle, .appearance-switch):is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--wf-surface2)); }
:root:root :is(.wf-toggle, .appearance-switch):is(:active, [data-force~="press"]):not(:disabled)::before { width: calc(24px - 2 * var(--wf-bw) - 4px); }
:root:root :is(.wf-toggle, .appearance-switch):checked { background-color: var(--accent); }
:root:root :is(.wf-toggle, .appearance-switch):checked::before { background: var(--accent-fg); translate: 16px 0; }
:root:root :is(.wf-toggle, .appearance-switch):checked:is(:active, [data-force~="press"]):not(:disabled)::before { translate: 12px 0; }
:root:root :is(.wf-toggle, .appearance-switch):checked:is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--accent)); }

/* ---------- Checkbox and radio (native inputs) ---------- */
:root:root :is(.wf-check, .themed-check, .milestone-check), :root:root .wf-radio {
  appearance: none; position: relative; flex: none; width: 18px; height: 18px; margin: 0; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); background: var(--surface); cursor: pointer; scale: 1;
  transition: background-color var(--wf-t) var(--wf-ease), scale var(--wf-t) var(--wf-ease-hover);
}
:root:root :is(.wf-check, .themed-check, .milestone-check) { border-radius: max(2px, calc(var(--wf-rm) - 2px)); }
:root:root .wf-radio { border-radius: 50%; }
:root:root :is(:is(.wf-check, .themed-check, .milestone-check), .wf-radio):is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--surface)); }
:root:root :is(:is(.wf-check, .themed-check, .milestone-check), .wf-radio):is(:active, [data-force~="press"]):not(:disabled) { scale: .92; transition-duration: var(--wf-t-press); }
:root:root :is(.wf-check, .themed-check, .milestone-check)::after {
  content: ""; position: absolute; left: 50%; top: 45%; width: 4px; height: 8px; border: solid var(--accent-fg);
  border-width: 0 2px 2px 0; translate: -50% -50%; rotate: 45deg; scale: 0; transition: scale var(--wf-t) var(--wf-ease-hover);
}
:root:root :is(.wf-check, .themed-check, .milestone-check):is(:checked, :indeterminate) { background-color: var(--accent); }
:root:root :is(.wf-check, .themed-check, .milestone-check):checked::after { scale: 1; }
:root:root :is(.wf-check, .themed-check, .milestone-check):indeterminate::after { top: 50%; width: 8px; height: 0; border-width: 0 0 2px 0; rotate: 0deg; scale: 1; }
:root:root .wf-radio::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 8px; height: 8px; border-radius: 50%;
  background: var(--wf-accent-ink); scale: 0; transition: scale var(--wf-t) var(--wf-ease-hover);
}
:root:root .wf-radio:checked::after { scale: 1; }

/* ---------- Input and select ---------- */
:root:root :is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input), :root:root :is(.wf-select, .custom-select-button) {
  font: inherit; font-size: 14px; line-height: 1.3; padding: 7px 10px; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc); background: var(--bg); color: var(--text);
  transition: background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease),
    box-shadow var(--wf-t) var(--wf-ease), transform var(--wf-t) var(--wf-ease-hover);
}
:root:root :is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input)::placeholder { color: var(--muted); opacity: 1; }
:root:root :is(:is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input), :is(.wf-select, .custom-select-button)):is(:hover, [data-force~="hover"]):not(:disabled, :focus, [aria-expanded="true"]) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--bg)); }
:root:root :is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input):is(:focus, [data-force~="focus"]), :root:root :is(.wf-select, .custom-select-button):is(:focus-visible, [data-force~="focus"], [aria-expanded="true"]) {
  outline: none; background-color: var(--wf-field-bg); border-color: var(--wf-focus); box-shadow: var(--wf-field-sh);
  transform: var(--type-t, var(--wf-field-t));
}
:root:root :is(:is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input), :is(.wf-select, .custom-select-button))[aria-invalid="true"] { border-color: var(--wf-danger); }
:root:root :is(.wf-input, .themed-input, .paper-field-input, .search-input, .input, .explorer-filter, .graph-search-input, .settings-find, .quick-open-input, .pdf-reader-pop-input):read-only:not(:disabled) { background-color: var(--wf-surface2); }
:root:root :is(.wf-select, .custom-select-button) { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 160px; text-align: left; cursor: pointer; }
:root:root :is(.wf-select, .custom-select-button)::after {
  content: ""; width: 6px; height: 6px; margin-top: -3px; border: solid currentColor; border-width: 0 2px 2px 0;
  rotate: 45deg; transition: rotate var(--wf-t) var(--wf-ease-hover), margin var(--wf-t) var(--wf-ease-hover);
}
:root:root :is(.wf-select, .custom-select-button)[aria-expanded="true"]::after { rotate: 225deg; margin-top: 3px; }

/* ---------- Popover (dropdowns, pickers, menus) ---------- */
:root:root :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop) {
  box-sizing: border-box; padding: 8px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rp);
  background: var(--elev, var(--surface)); color: var(--text); box-shadow: var(--wf-sh-up);
  opacity: 1; translate: 0 0; scale: 1; transform-origin: top center;
  transition: opacity var(--wf-t-pop) var(--wf-ease), translate var(--wf-t-pop) var(--wf-ease-pop), scale var(--wf-t-pop) var(--wf-ease-pop),
    display var(--wf-t-pop) allow-discrete, overlay var(--wf-t-pop) allow-discrete;
}
@starting-style { :root:root :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop) { opacity: 0; translate: 0 var(--wf-pop-y); scale: var(--wf-pop-s); } }
:root:root :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop):is(.wf-closing, [data-state="closed"]) {
  opacity: 0; translate: 0 calc(var(--wf-pop-y) / 2); scale: var(--wf-pop-s); pointer-events: none;
  transition-duration: calc(var(--wf-t-pop) * .67); transition-timing-function: ease;
}
:root:root:root[data-theme="crt"] :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop) {
  clip-path: inset(0 -12px -12px -12px);
  transition: clip-path var(--wf-t-pop) var(--wf-ease-pop), display var(--wf-t-pop) allow-discrete, overlay var(--wf-t-pop) allow-discrete;
}
@starting-style { :root:root:root[data-theme="crt"] :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop) { clip-path: inset(0 -12px 100% -12px); } }
:root:root:root[data-theme="crt"] :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop):is(.wf-closing, [data-state="closed"]) { opacity: 1; clip-path: inset(0 -12px 100% -12px); transition-timing-function: steps(2, end); }

/* ---------- Menu (inside :is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop)) ---------- */
:root:root :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) { display: flex; flex-direction: column; gap: 2px; min-width: 180px; padding: 6px; }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item) {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; box-sizing: border-box;
  border: 0; border-radius: max(2px, calc(var(--wf-rc) - 2px)); background: transparent; color: var(--text);
  font: inherit; font-size: 14px; font-weight: 500; text-align: left; text-decoration: none; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
  animation: var(--wf-item-anim) var(--wf-t-pop) var(--wf-ease) backwards; animation-delay: calc(var(--wf-i, 0) * var(--wf-stagger));
}
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is(:hover, [data-highlighted], [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-hover); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is(:focus-visible, [data-force~="focus"]) { outline: none; background-color: var(--wf-hover); box-shadow: inset 0 0 0 2px var(--wf-focus); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is([aria-checked="true"], [aria-selected="true"]) { font-weight: 600; color: var(--wf-accent-ink); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is([aria-checked="true"], [aria-selected="true"])::after { content: "\2713"; margin-left: auto; }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is(.wf-danger, .btn-danger) { color: var(--wf-danger); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item):is(.wf-danger, .btn-danger):is(:hover, [data-highlighted], [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-danger-soft); }
:root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item) svg { width: 16px; height: 16px; flex: none; }
:root:root .wf-kbd { margin-left: auto; padding-left: 12px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; color: var(--muted); }
:root:root .wf-sep { height: 0; margin: 4px 2px; border: 0; border-top: var(--wf-bw) solid var(--wf-line); opacity: .35; }
:root:root .wf-menu-label { padding: 6px 10px 2px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
:root:root :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(2) { --wf-i: 1; } :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(3) { --wf-i: 2; } :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(4) { --wf-i: 3; }
:root:root :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(5) { --wf-i: 4; } :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(6) { --wf-i: 5; } :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(7) { --wf-i: 6; }
:root:root :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(8) { --wf-i: 7; } :is(.wf-menu, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu) > :nth-child(n+9) { --wf-i: 8; }

/* ---------- Tooltip ---------- */
:root:root .wf-has-tip { position: relative; display: inline-flex; }
:root:root .wf-tip {
  position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 20; white-space: nowrap; pointer-events: none;
  padding: 4px 8px; border-radius: var(--wf-rm); background: var(--wf-toast-bg); color: var(--wf-toast-fg);
  font-size: 12px; font-weight: 600; line-height: 1.3; box-shadow: var(--wf-tip-sh);
  opacity: 0; translate: -50% var(--wf-tip-y); transition: opacity var(--wf-t-exit) ease, translate var(--wf-t-exit) ease;
}
:root:root .wf-has-tip:hover > .wf-tip, :root:root .wf-tip:is([data-open], [data-force~="open"]) {
  opacity: 1; translate: -50% 0; transition: opacity var(--wf-t-pop) var(--wf-ease) 500ms, translate var(--wf-t-pop) var(--wf-ease-pop) 500ms;
}
:root:root .wf-has-tip:has(> :focus-visible) > .wf-tip { opacity: 1; translate: -50% 0; transition-delay: 0ms; }
:root:root:root[data-theme="crt"] .wf-tip { transition-timing-function: steps(2, end); }

/* ---------- Toast ---------- */
:root:root :is(.wf-toast, [data-sonner-toast]) {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--wf-rp);
  background: var(--wf-toast-bg); color: var(--wf-toast-fg); box-shadow: var(--wf-sh-up); font-size: 14px; font-weight: 500;
  opacity: 1; translate: 0 0;
  transition: opacity calc(var(--wf-t-pop) * 1.5) var(--wf-ease), translate calc(var(--wf-t-pop) * 1.5) var(--wf-ease-pop), display 120ms allow-discrete;
}
@starting-style { :root:root :is(.wf-toast, [data-sonner-toast]) { opacity: 0; translate: 0 var(--wf-toast-y); } }
:root:root :is(.wf-toast, [data-sonner-toast]):is(.wf-closing, [data-state="closed"]) { opacity: 0; translate: 0 calc(var(--wf-toast-y) / 2); transition: opacity 120ms ease, translate 120ms ease; }
:root:root:root[data-theme="crt"] :is(.wf-toast, [data-sonner-toast]) { clip-path: inset(-12px -12px -12px -12px); transition: clip-path calc(var(--wf-t-pop) * 1.5) var(--wf-ease-pop); }
@starting-style { :root:root:root[data-theme="crt"] :is(.wf-toast, [data-sonner-toast]) { opacity: 1; translate: 0 0; clip-path: inset(100% -12px -12px -12px); } }

/* ---------- Modal, scrim and sheet ---------- */
:root:root :is(.wf-scrim, .modal-backdrop) { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); opacity: 1; transition: opacity var(--wf-t-modal) ease; }
@starting-style { :root:root :is(.wf-scrim, .modal-backdrop) { opacity: 0; } }
:root:root :is(.wf-modal, .modal) {
  box-sizing: border-box; padding: 20px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rcard);
  background: var(--surface); color: var(--text); box-shadow: var(--wf-sh-card);
  opacity: 1; translate: 0 0; scale: 1;
  transition: opacity var(--wf-t-modal) var(--wf-ease), translate var(--wf-t-modal) var(--wf-ease-pop), scale var(--wf-t-modal) var(--wf-ease-pop);
}
@starting-style { :root:root :is(.wf-modal, .modal) { opacity: 0; translate: 0 var(--wf-modal-y); scale: var(--wf-modal-s); } }
:root:root :is(:is(.wf-modal, .modal), :is(.wf-scrim, .modal-backdrop), :is(.wf-sheet, .comments-sheet)):is(.wf-closing, [data-state="closed"]) { opacity: 0; transition-duration: 120ms; transition-timing-function: ease; }
:root:root:root[data-theme="crt"] :is(.wf-modal, .modal) { clip-path: inset(-12px); transition: clip-path var(--wf-t-modal) steps(4, end); }
@starting-style { :root:root:root[data-theme="crt"] :is(.wf-modal, .modal) { opacity: 1; translate: 0 0; scale: 1; clip-path: inset(50% 0 50% 0); } }
:root:root :is(.wf-sheet, .comments-sheet) {
  box-sizing: border-box; border-left: var(--wf-bw) solid var(--wf-line); background: var(--surface); color: var(--text);
  box-shadow: var(--wf-sh-card); translate: 0 0; transition: translate var(--wf-t-modal) var(--wf-ease), opacity 120ms ease;
}
@starting-style { :root:root :is(.wf-sheet, .comments-sheet) { translate: 100% 0; } }
:root:root:root[data-theme="crt"] :is(.wf-sheet, .comments-sheet) { transition-timing-function: steps(4, end); }

/* ---------- Card ---------- */
:root:root .wf-card {
  display: block; box-sizing: border-box; padding: 14px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rcard);
  background: var(--surface); color: var(--text); box-shadow: var(--wf-sh-card); text-decoration: none;
}
:root:root :is(a, button).wf-card, :root:root .wf-card[tabindex] {
  cursor: pointer; translate: 0 0; text-align: left; font: inherit;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease);
}
:root:root :is(a, button, [tabindex]).wf-card:is(:hover, [data-force~="hover"]) { translate: 0 var(--wf-lift); }
:root:root :is(a, button, [tabindex]).wf-card:is(:active, [data-force~="press"]) { translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); transition-duration: var(--wf-t-press); }

/* ---------- Keyframes ---------- */
@keyframes wf-spin { to { rotate: 1turn; } }
@keyframes wf-item-in { from { opacity: 0; translate: 0 4px; } }
@media (prefers-reduced-motion: reduce) {
  :root:root :is(.wf-item, .custom-select-item, .card-menu-item, .menu-item, .proj-menu-item, .ink-menu-item, .ms-item, .title-bar-item) { animation: none; }
  :root:root :is(.wf-btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-cancel, .btn-danger, .auth-wide, .btn-google, .dashboard-customize-btn, .proj-chip, .entity-icon-btn, .entity-open-icon, .paper-open-icon, .pdf-reader-icon-btn, .card-menu-trigger, .header-overflow-btn, .list-toggle)[aria-busy="true"]::after { animation-duration: 1.6s; }
  :root:root:root[data-theme="crt"] :is(:is(.wf-pop, .popover-panel, .custom-select-menu, .card-menu-flyout, .menu-flyout, .header-menu, .proj-menu, .ink-menu-list, .member-tree-menu, .title-bar-menu, .graph-edge-popover, .pdf-reader-ref-popover, .ink-figure-popover, .note-comment-pop), :is(.wf-toast, [data-sonner-toast]), :is(.wf-modal, .modal)) { transition-duration: 0ms; }
}
```

## Appendix B — gen-states.mjs (regenerate states.css after changing the DS: node gen-states.mjs bundle.css states.css)

```js
// Turns the DS bundle.css into the app's states.css: aliases app classes onto .wf-* and lifts specificity over old theme rules.
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);

const MAP = {
  "wf-btn": [".btn-primary", ".btn-secondary", ".btn-ghost", ".btn-cancel", ".btn-danger", ".auth-wide", ".btn-google",
    ".dashboard-customize-btn", ".proj-chip", ".entity-icon-btn", ".entity-open-icon", ".paper-open-icon",
    ".pdf-reader-icon-btn", ".card-menu-trigger", ".header-overflow-btn", ".list-toggle"],
  "wf-primary": [".btn-primary"],
  "wf-danger": [".btn-danger"],
  "wf-ghost": [".btn-ghost", ".btn-cancel", ".card-menu-trigger", ".header-overflow-btn", ".list-toggle"],
  "wf-icon": [".entity-icon-btn", ".entity-open-icon", ".paper-open-icon", ".pdf-reader-icon-btn"],
  "wf-sm": [".btn-sm"],
  "wf-back": [".back-btn"],
  "wf-back-box": [".back-btn-box"],
  "wf-link": [".link-btn", ".link", ".auth-link", ".auth-link-sm"],
  "wf-tool": [".ink-tool", ".pdf-reader-create-icon", ".pdf-reader-pop-btn"],
  "wf-seg": [".seg"],
  "wf-tab": [".sub-tab", ".pane-tab", ".graph-drawer-tab", ".mcp-tab"],
  "wf-nav": [".nav-link", ".header-link"],
  "wf-chip": [".tag-chip", ".git-chip", ".jump-to-chip", ".graph-chip"],
  "wf-chip-x": [".filter-chip-x", ".jump-to-chip-remove", ".tag-del"],
  "wf-swatch": [".ink-swatch", ".pdf-reader-pop-swatch", ".pdf-reader-create-swatch", ".pdf-reader-pill-swatch", ".list-color-pick"],
  "wf-toggle": [".appearance-switch"],
  "wf-check": [".themed-check", ".milestone-check"],
  "wf-input": [".themed-input", ".paper-field-input", ".search-input", ".input", ".explorer-filter", ".graph-search-input",
    ".settings-find", ".quick-open-input", ".pdf-reader-pop-input"],
  "wf-select": [".custom-select-button"],
  "wf-pop": [".popover-panel", ".custom-select-menu", ".card-menu-flyout", ".menu-flyout", ".header-menu", ".proj-menu",
    ".ink-menu-list", ".member-tree-menu", ".title-bar-menu", ".graph-edge-popover", ".pdf-reader-ref-popover",
    ".ink-figure-popover", ".note-comment-pop"],
  "wf-menu": [".custom-select-menu", ".card-menu-flyout", ".menu-flyout", ".header-menu", ".proj-menu", ".ink-menu-list",
    ".member-tree-menu", ".title-bar-menu"],
  "wf-item": [".custom-select-item", ".card-menu-item", ".menu-item", ".proj-menu-item", ".ink-menu-item", ".ms-item", ".title-bar-item"],
  "wf-toast": ["[data-sonner-toast]"],
  "wf-scrim": [".modal-backdrop"],
  "wf-modal": [".modal"],
  "wf-sheet": [".comments-sheet"],
};
const SELECTED = ".seg-on, .is-active, .is-selected, .sel, .on, .active";

// Split a selector list on commas outside brackets.
const splitTop = (s) => {
  const parts = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
};
const boost = (sel) => (sel.startsWith(":root") ? ":root:root" + sel : ":root:root " + sel);
const boostList = (list) => splitTop(list).map(boost).join(", ");

const lines = readFileSync(src, "utf8").split("\n");
const start = lines.findIndex((l) => /^(:is\(\.wf-|\.wf-)/.test(l));
for (let i = start; i < lines.length; i++) {
  const l = lines[i];
  const indent = l.match(/^\s*/)[0];
  const t = l.trimStart();
  if (t.startsWith("@keyframes")) continue;
  const ss = t.match(/^@starting-style \{ (.+?) \{(.*)$/);
  if (ss) { lines[i] = `${indent}@starting-style { ${boostList(ss[1])} {${ss[2]}`; continue; }
  if (!/^[.:\[a-z]/.test(t) || !t.includes("{") || /^[a-z-]+\s*:/.test(t)) continue;
  const at = t.indexOf(" {");
  lines[i] = indent + boostList(t.slice(0, at)) + t.slice(at);
}
let css = lines.join("\n");

css = css.replaceAll(':is([aria-pressed="true"]', `:is([aria-pressed="true"], ${SELECTED}`);
css = css.replaceAll(':is([aria-selected="true"], [aria-current="page"])', ':is([aria-selected="true"], [aria-current="page"], .active, .is-active)');
css = css.replaceAll('.wf-nav[aria-current="page"]', '.wf-nav:is([aria-current="page"], .active)');
for (const [wf, app] of Object.entries(MAP)) {
  css = css.replace(new RegExp(`\\.${wf}(?![\\w-])`, "g"), `:is(.${wf}, ${app.join(", ")})`);
}
css = css.replace(/^\/\* WeaveForge states and motion[^]*?\*\//, "/* States and motion for every control, from the design system bundle; generated, edit the DS then regenerate. */");
writeFileSync(out, css);
```

## Appendix C — design system tokens (tokens.json)

```json
{
 "color": {
  "themes": [
   {
    "id": "crt",
    "name": "CRT"
   },
   {
    "id": "brutal",
    "name": "Poster light"
   },
   {
    "id": "brutal-dark",
    "name": "Poster dark"
   },
   {
    "id": "mocha",
    "name": "Mocha"
   },
   {
    "id": "light",
    "name": "Paper"
   },
   {
    "id": "amoled",
    "name": "Amoled"
   },
   {
    "id": "honey",
    "name": "Honey"
   }
  ],
  "tokens": [
   {
    "name": "bg",
    "usage": "Page ground",
    "value": {
     "crt": "#e7cfa6",
     "brutal": "#f2e1c4",
     "brutal-dark": "#131210",
     "mocha": "#1e1e2e",
     "light": "#f4f1ea",
     "amoled": "#000000",
     "honey": "#faf4eb"
    }
   },
   {
    "name": "surface",
    "usage": "Cards, panels, sheets",
    "value": {
     "crt": "#ffe7c1",
     "brutal": "#fff0d9",
     "brutal-dark": "#1d1b18",
     "mocha": "#181825",
     "light": "#fbfaf6",
     "amoled": "#0a0a0a",
     "honey": "#fffdfa"
    }
   },
   {
    "name": "surface-2",
    "usage": "Secondary fills, hover rows, neutral chip",
    "value": {
     "crt": "#f1d5a7",
     "brutal": "#e8d5b5",
     "brutal-dark": "#2a2721",
     "mocha": "#313244",
     "light": "#efece3",
     "amoled": "#141414",
     "honey": "#f5ebe0"
    }
   },
   {
    "name": "elev",
    "usage": "Menus, popovers, modals",
    "value": {
     "crt": "#ffe7c1",
     "brutal": "#fff0d9",
     "brutal-dark": "#1d1b18",
     "mocha": "#252537",
     "light": "#fdfcf9",
     "amoled": "#101010",
     "honey": "#fffdf9"
    }
   },
   {
    "name": "well",
    "usage": "Inset wells: search, code, empty states",
    "value": {
     "crt": "#d9c095",
     "brutal": "#e3d1b1",
     "brutal-dark": "#0c0b0a",
     "mocha": "#11111b",
     "light": "#e9e5da",
     "amoled": "#050505",
     "honey": "#efe2d2"
    }
   },
   {
    "name": "border",
    "usage": "Default outline. Ink on Poster and CRT",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#f2e1c4",
     "mocha": "#313244",
     "light": "#e4dfd2",
     "amoled": "#1f1f1f",
     "honey": "#e8d9c8"
    }
   },
   {
    "name": "border-strong",
    "usage": "Focused or emphasised outline",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#f2e1c4",
     "mocha": "#45475a",
     "light": "#d3ccb9",
     "amoled": "#2e2e2e",
     "honey": "#d4c0a8"
    }
   },
   {
    "name": "text",
    "usage": "Body and headings",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#f2e1c4",
     "mocha": "#cdd6f4",
     "light": "#2b2924",
     "amoled": "#eaeaea",
     "honey": "#2c2318"
    }
   },
   {
    "name": "muted",
    "usage": "Secondary text, labels",
    "value": {
     "crt": "#5c4b51",
     "brutal": "#574e3f",
     "brutal-dark": "#ab9c81",
     "mocha": "#a6adc8",
     "light": "#6b6659",
     "amoled": "#8a8a8a",
     "honey": "#756556"
    }
   },
   {
    "name": "faint",
    "usage": "Placeholders, disabled, meta",
    "value": {
     "crt": "#7d696c",
     "brutal": "#7a6f5c",
     "brutal-dark": "#857862",
     "mocha": "#7f849c",
     "light": "#918a79",
     "amoled": "#5a5a5a",
     "honey": "#9e8974"
    }
   },
   {
    "name": "accent",
    "usage": "Primary action, links, selection",
    "value": {
     "crt": "#1f6dab",
     "brutal": "#ffc536",
     "brutal-dark": "#ffc536",
     "mocha": "#89b4fa",
     "light": "#3b5b8c",
     "amoled": "#4c8dff",
     "honey": "#b45309"
    }
   },
   {
    "name": "accent-fg",
    "usage": "Text on accent",
    "value": {
     "crt": "#ffe7c1",
     "brutal": "#12110f",
     "brutal-dark": "#12110f",
     "mocha": "#1e1e2e",
     "light": "#ffffff",
     "amoled": "#000000",
     "honey": "#fffdfa"
    }
   },
   {
    "name": "accent-soft",
    "usage": "Accent wash: selected rows, secondary button",
    "value": {
     "crt": "#fbd59c",
     "brutal": "#ffe5a9",
     "brutal-dark": "#2b2413",
     "mocha": "#2a2b40",
     "light": "#e7edf5",
     "amoled": "#10161f",
     "honey": "#fde8d0"
    }
   },
   {
    "name": "danger-text",
    "usage": "Destructive text and icons",
    "value": {
     "crt": "#b3241a",
     "brutal": "#c62c1a",
     "brutal-dark": "#ff826a",
     "mocha": "#f38ba8",
     "light": "#a4443a",
     "amoled": "#d86a62",
     "honey": "#b33b31"
    }
   },
   {
    "name": "danger-soft",
    "usage": "Destructive wash",
    "value": {
     "crt": "#f7c5ab",
     "brutal": "#ffd4bb",
     "brutal-dark": "#3a1c17",
     "mocha": "#33212a",
     "light": "#f3e2df",
     "amoled": "#20100e",
     "honey": "#f5ddd9"
    }
   },
   {
    "name": "danger-fill",
    "usage": "Destructive button fill",
    "value": {
     "crt": "#c73729",
     "brutal": "#ff654d",
     "brutal-dark": "#ff654d",
     "mocha": "#f38ba8",
     "light": "#a4443a",
     "amoled": "#d86a62",
     "honey": "#b33b31"
    }
   },
   {
    "name": "nav-on-bg",
    "usage": "Active nav item fill",
    "value": {
     "crt": "#c73729",
     "brutal": "#12110f",
     "brutal-dark": "#ffc536",
     "mocha": "#89b4fa",
     "light": "#3b5b8c",
     "amoled": "#4c8dff",
     "honey": "#b45309"
    }
   },
   {
    "name": "nav-on-fg",
    "usage": "Active nav item text",
    "value": {
     "crt": "#ffe7c1",
     "brutal": "#f2e1c4",
     "brutal-dark": "#12110f",
     "mocha": "#1e1e2e",
     "light": "#ffffff",
     "amoled": "#000000",
     "honey": "#fffdfa"
    }
   },
   {
    "name": "type-bg",
    "usage": "Field fill while typing (the lift)",
    "value": {
     "crt": "#ffeecf",
     "brutal": "#ffe9ba",
     "brutal-dark": "#262218",
     "mocha": "#252537",
     "light": "#fdfcf9",
     "amoled": "#101010",
     "honey": "#fffdf9"
    }
   },
   {
    "name": "type-line",
    "usage": "Field outline while typing",
    "value": {
     "crt": "#1f6dab",
     "brutal": "#12110f",
     "brutal-dark": "#ffc536",
     "mocha": "#89b4fa",
     "light": "#3b5b8c",
     "amoled": "#4c8dff",
     "honey": "#b45309"
    }
   },
   {
    "name": "toast-bg",
    "usage": "Toast fill",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#f2e1c4",
     "mocha": "#cdd6f4",
     "light": "#2b2924",
     "amoled": "#eaeaea",
     "honey": "#2c2318"
    }
   },
   {
    "name": "toast-fg",
    "usage": "Toast text",
    "value": {
     "crt": "#ffe7c1",
     "brutal": "#f2e1c4",
     "brutal-dark": "#12110f",
     "mocha": "#1e1e2e",
     "light": "#f4f1ea",
     "amoled": "#000000",
     "honey": "#faf4eb"
    }
   },
   {
    "name": "status-neutral-fg",
    "usage": "Neutral chip text",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#f2e1c4",
     "mocha": "#cdd6f4",
     "light": "#2b2924",
     "amoled": "#eaeaea",
     "honey": "#2c2318"
    }
   },
   {
    "name": "status-neutral-bg",
    "usage": "Neutral chip fill",
    "value": {
     "crt": "#f1d5a7",
     "brutal": "#e8d5b5",
     "brutal-dark": "#2a2721",
     "mocha": "#313244",
     "light": "#efece3",
     "amoled": "#141414",
     "honey": "#f5ebe0"
    }
   },
   {
    "name": "status-info-fg",
    "usage": "Info chip text",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#8dadd9",
     "mocha": "#89dceb",
     "light": "#2f6f8f",
     "amoled": "#5ab0d0",
     "honey": "#0d6e82"
    }
   },
   {
    "name": "status-info-bg",
    "usage": "Info chip fill",
    "value": {
     "crt": "#8db7d0",
     "brutal": "#8dadd9",
     "brutal-dark": "#1c2530",
     "mocha": "#1f2c33",
     "light": "#e2eef2",
     "amoled": "#0d1c22",
     "honey": "#dceef2"
    }
   },
   {
    "name": "status-good-fg",
    "usage": "Success chip text",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#86d08f",
     "mocha": "#a6e3a1",
     "light": "#3d7650",
     "amoled": "#5cc98a",
     "honey": "#3a7444"
    }
   },
   {
    "name": "status-good-bg",
    "usage": "Success chip fill",
    "value": {
     "crt": "#6cbf81",
     "brutal": "#86d08f",
     "brutal-dark": "#1a2b1d",
     "mocha": "#1f2b1e",
     "light": "#e4efe6",
     "amoled": "#0c1f14",
     "honey": "#dcebe0"
    }
   },
   {
    "name": "status-warn-fg",
    "usage": "Warning chip text",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#ffc536",
     "mocha": "#f9e2af",
     "light": "#8d6224",
     "amoled": "#c99a4a",
     "honey": "#ae5009"
    }
   },
   {
    "name": "status-warn-bg",
    "usage": "Warning chip fill",
    "value": {
     "crt": "#f29731",
     "brutal": "#ffc536",
     "brutal-dark": "#2b2413",
     "mocha": "#31301f",
     "light": "#f3ebdc",
     "amoled": "#1f1808",
     "honey": "#faebd0"
    }
   },
   {
    "name": "status-danger-fg",
    "usage": "Error chip text",
    "value": {
     "crt": "#8f1f14",
     "brutal": "#12110f",
     "brutal-dark": "#ff826a",
     "mocha": "#f38ba8",
     "light": "#a4443a",
     "amoled": "#d86a62",
     "honey": "#b33b31"
    }
   },
   {
    "name": "status-danger-bg",
    "usage": "Error chip fill",
    "value": {
     "crt": "#f1c2a8",
     "brutal": "#ff654d",
     "brutal-dark": "#2e1612",
     "mocha": "#33212a",
     "light": "#f3e2df",
     "amoled": "#20100e",
     "honey": "#f5ddd9"
    }
   },
   {
    "name": "status-mute-fg",
    "usage": "Muted chip text",
    "value": {
     "crt": "#54444a",
     "brutal": "#574e3f",
     "brutal-dark": "#ab9c81",
     "mocha": "#a6adc8",
     "light": "#6b6659",
     "amoled": "#8a8a8a",
     "honey": "#756556"
    }
   },
   {
    "name": "status-mute-bg",
    "usage": "Muted chip fill",
    "value": {
     "crt": "#ddc69e",
     "brutal": "#e3d1b1",
     "brutal-dark": "#0c0b0a",
     "mocha": "#181825",
     "light": "#efece3",
     "amoled": "#0a0a0a",
     "honey": "#f5ebe0"
    }
   },
   {
    "name": "tint-to-read",
    "usage": "Card tint: to read",
    "value": {
     "crt": "#fbd59c",
     "brutal": "#ffe39c",
     "brutal-dark": "#3a3011",
     "mocha": "#31301f",
     "light": "#f3ebdc",
     "amoled": "#1f1808",
     "honey": "#faebd0"
    }
   },
   {
    "name": "tint-reading",
    "usage": "Card tint: reading",
    "value": {
     "crt": "#d5e3ec",
     "brutal": "#d9e4f4",
     "brutal-dark": "#1c2738",
     "mocha": "#1f2c33",
     "light": "#e2eef2",
     "amoled": "#0d1c22",
     "honey": "#dceef2"
    }
   },
   {
    "name": "tint-read",
    "usage": "Card tint: read",
    "value": {
     "crt": "#d3e2be",
     "brutal": "#d6e4bf",
     "brutal-dark": "#1b3220",
     "mocha": "#1f2b1e",
     "light": "#e4efe6",
     "amoled": "#0c1f14",
     "honey": "#dcebe0"
    }
   },
   {
    "name": "tint-skimmed",
    "usage": "Card tint: skimmed",
    "value": {
     "crt": "#f5c9c4",
     "brutal": "#fbd9df",
     "brutal-dark": "#3a1f25",
     "mocha": "#33212a",
     "light": "#f3e2df",
     "amoled": "#20100e",
     "honey": "#f5ddd9"
    }
   },
   {
    "name": "chip-to-read",
    "usage": "Reading-state chip: to read",
    "value": {
     "crt": "#f29731",
     "brutal": "#ffc536",
     "brutal-dark": "#ffc536",
     "mocha": "#f9e2af",
     "light": "#8d6224",
     "amoled": "#c99a4a",
     "honey": "#ae5009"
    }
   },
   {
    "name": "chip-reading",
    "usage": "Reading-state chip: reading",
    "value": {
     "crt": "#8db7d0",
     "brutal": "#8dadd9",
     "brutal-dark": "#8dadd9",
     "mocha": "#89dceb",
     "light": "#2f6f8f",
     "amoled": "#5ab0d0",
     "honey": "#0d6e82"
    }
   },
   {
    "name": "chip-read",
    "usage": "Reading-state chip: read",
    "value": {
     "crt": "#6cbf81",
     "brutal": "#86d08f",
     "brutal-dark": "#86d08f",
     "mocha": "#a6e3a1",
     "light": "#3d7650",
     "amoled": "#5cc98a",
     "honey": "#3a7444"
    }
   },
   {
    "name": "chip-danger",
    "usage": "Reading-state chip: dropped",
    "value": {
     "crt": "#e5735a",
     "brutal": "#ff7a5c",
     "brutal-dark": "#ff7a5c",
     "mocha": "#f38ba8",
     "light": "#a4443a",
     "amoled": "#d86a62",
     "honey": "#b33b31"
    }
   },
   {
    "name": "chip-skimmed",
    "usage": "Reading-state chip: skimmed",
    "value": {
     "crt": "#f2929c",
     "brutal": "#ff95a9",
     "brutal-dark": "#ff95a9",
     "mocha": "#f5c2e7",
     "light": "#9a4a6a",
     "amoled": "#c870a0",
     "honey": "#a8486a"
    }
   },
   {
    "name": "shadow-ink",
    "usage": "Colour of hard offset shadows",
    "value": {
     "crt": "#2b222b",
     "brutal": "#12110f",
     "brutal-dark": "#4d4639",
     "mocha": "#11111b",
     "light": "#d3ccb9",
     "amoled": "#000000",
     "honey": "#d4c0a8"
    }
   },
   {
    "name": "shadow-btn",
    "usage": "Primary button shadow ink",
    "value": {
     "crt": "#12466e",
     "brutal": "#12110f",
     "brutal-dark": "#4d4639",
     "mocha": "#11111b",
     "light": "#26406a",
     "amoled": "#000000",
     "honey": "#7c3a06"
    }
   },
   {
    "name": "tag-teal",
    "usage": "Tag chip colour (teal); same in every theme",
    "value": "#5cc0ae"
   },
   {
    "name": "tag-teal-tint",
    "usage": "Tag card tint (teal), light themes",
    "value": "#cdebe3"
   },
   {
    "name": "tag-violet",
    "usage": "Tag chip colour (violet); same in every theme",
    "value": "#a98be6"
   },
   {
    "name": "tag-violet-tint",
    "usage": "Tag card tint (violet), light themes",
    "value": "#e3d8f6"
   },
   {
    "name": "tag-pink",
    "usage": "Tag chip colour (pink); same in every theme",
    "value": "#d98ad0"
   },
   {
    "name": "tag-pink-tint",
    "usage": "Tag card tint (pink), light themes",
    "value": "#f3d6ee"
   },
   {
    "name": "tag-lime",
    "usage": "Tag chip colour (lime); same in every theme",
    "value": "#b6cf4f"
   },
   {
    "name": "tag-lime-tint",
    "usage": "Tag card tint (lime), light themes",
    "value": "#e6eec3"
   },
   {
    "name": "tag-tan",
    "usage": "Tag chip colour (tan); same in every theme",
    "value": "#c9a27a"
   },
   {
    "name": "tag-tan-tint",
    "usage": "Tag card tint (tan), light themes",
    "value": "#ecdcc8"
   },
   {
    "name": "tag-indigo",
    "usage": "Tag chip colour (indigo); same in every theme",
    "value": "#8a93e0"
   },
   {
    "name": "tag-indigo-tint",
    "usage": "Tag card tint (indigo), light themes",
    "value": "#d9dcf5"
   }
  ]
 },
 "type": {
  "families": {
   "sans": "'Rubik', system-ui, -apple-system, 'Segoe UI', sans-serif",
   "mono": "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace",
   "pixel": "'Jersey 10', 'Rubik', system-ui, sans-serif"
  },
  "groups": [
   {
    "name": "CRT display",
    "family": "pixel",
    "styles": [
     {
      "name": "crt-screen-title",
      "fontSize": "2.75rem",
      "fontWeight": 400,
      "lineHeight": 1,
      "sample": "Your notes",
      "usage": "Screen titles under CRT"
     },
     {
      "name": "crt-card-title",
      "fontSize": "1.6rem",
      "fontWeight": 400,
      "lineHeight": 1.05,
      "sample": "Attention is all you need",
      "usage": "Modal and card titles under CRT"
     },
     {
      "name": "crt-button",
      "fontSize": "1.25rem",
      "fontWeight": 400,
      "lineHeight": 1,
      "sample": "Add paper",
      "usage": "Primary and secondary buttons under CRT"
     },
     {
      "name": "crt-button-ghost",
      "fontSize": "1.15rem",
      "fontWeight": 400,
      "lineHeight": 1,
      "sample": "Cancel",
      "usage": "Ghost and cancel buttons under CRT"
     }
    ]
   },
   {
    "name": "Poster display",
    "family": "sans",
    "styles": [
     {
      "name": "display",
      "fontSize": "2.25rem",
      "fontWeight": 800,
      "lineHeight": 1.05,
      "letterSpacing": "-0.02em",
      "sample": "Your notes",
      "usage": "Screen titles, Poster themes"
     },
     {
      "name": "title",
      "fontSize": "1.25rem",
      "fontWeight": 800,
      "lineHeight": 1.2,
      "sample": "Attention is all you need",
      "usage": "Card and modal titles"
     }
    ]
   },
   {
    "name": "Text",
    "family": "sans",
    "styles": [
     {
      "name": "body",
      "fontSize": "0.9375rem",
      "fontWeight": 400,
      "lineHeight": 1.55,
      "sample": "Weave papers, notes and highlights into one graph.",
      "usage": "Reading and UI text"
     },
     {
      "name": "label",
      "fontSize": "0.8125rem",
      "fontWeight": 600,
      "lineHeight": 1.3,
      "sample": "Reading status",
      "usage": "Field labels, chips, buttons outside CRT"
     },
     {
      "name": "meta",
      "fontSize": "0.75rem",
      "fontWeight": 500,
      "lineHeight": 1.4,
      "sample": "Added 3 days ago",
      "usage": "Timestamps, counts"
     }
    ]
   },
   {
    "name": "Code",
    "family": "mono",
    "styles": [
     {
      "name": "code",
      "fontSize": "0.8125rem",
      "fontWeight": 400,
      "lineHeight": 1.5,
      "sample": "doi:10.48550/arXiv.1706.03762",
      "usage": "Code, DOIs, identifiers"
     }
    ]
   }
  ]
 },
 "spacing": {
  "tokens": [
   {
    "name": "space-1",
    "value": "4px"
   },
   {
    "name": "space-2",
    "value": "8px"
   },
   {
    "name": "space-3",
    "value": "12px"
   },
   {
    "name": "space-4",
    "value": "16px"
   },
   {
    "name": "space-5",
    "value": "20px"
   },
   {
    "name": "space-6",
    "value": "24px"
   },
   {
    "name": "space-8",
    "value": "32px"
   },
   {
    "name": "space-10",
    "value": "40px"
   },
   {
    "name": "space-12",
    "value": "48px"
   },
   {
    "name": "space-16",
    "value": "64px"
   }
  ]
 },
 "radius": {
  "tokens": [
   {
    "name": "radius-sm",
    "value": "4px",
    "usage": "Poster small (CRT 8px)"
   },
   {
    "name": "radius-control",
    "value": "4px",
    "usage": "Poster buttons and fields (CRT 8px; soft themes 10px)"
   },
   {
    "name": "radius",
    "value": "6px",
    "usage": "Poster cards (CRT 12px; soft themes 14px)"
   },
   {
    "name": "radius-crt-sm",
    "value": "8px",
    "usage": "CRT small and controls"
   },
   {
    "name": "radius-crt",
    "value": "12px",
    "usage": "CRT cards"
   },
   {
    "name": "radius-soft-control",
    "value": "10px",
    "usage": "Mocha, Paper, Amoled, Honey controls"
   },
   {
    "name": "radius-soft",
    "value": "14px",
    "usage": "Mocha, Paper, Amoled, Honey cards"
   },
   {
    "name": "radius-pill",
    "value": "999px",
    "usage": "Chips and toggles"
   }
  ]
 },
 "borderWidth": {
  "tokens": [
   {
    "name": "border-crt",
    "value": "3px",
    "usage": "Every outline under CRT"
   },
   {
    "name": "border-poster",
    "value": "2px",
    "usage": "Every outline under Poster light and dark"
   },
   {
    "name": "border-soft",
    "value": "1px",
    "usage": "Hairlines in soft themes"
   }
  ]
 },
 "shadow": {
  "tokens": [
   {
    "name": "sh-card",
    "usage": "Card offset shadow; never blurs",
    "value": {
     "crt": "6px 6px 0 #2b222b",
     "brutal": "5px 5px 0 #12110f",
     "brutal-dark": "5px 5px 0 #4d4639",
     "mocha": "0 1px 2px #00000040",
     "light": "0 1px 2px #2b29241a",
     "amoled": "none",
     "honey": "0 1px 2px #2c23181a"
    }
   },
   {
    "name": "sh-sm",
    "usage": "Chips and small controls",
    "value": {
     "crt": "3px 3px 0 #2b222b",
     "brutal": "2px 2px 0 #12110f",
     "brutal-dark": "2px 2px 0 #4d4639",
     "mocha": "none",
     "light": "none",
     "amoled": "none",
     "honey": "none"
    }
   },
   {
    "name": "sh-btn",
    "usage": "Primary button; press drops it into this",
    "value": {
     "crt": "5px 5px 0 #12466e",
     "brutal": "4px 4px 0 #12110f",
     "brutal-dark": "4px 4px 0 #4d4639",
     "mocha": "none",
     "light": "none",
     "amoled": "none",
     "honey": "none"
    }
   },
   {
    "name": "sh-btn-2",
    "usage": "Secondary button",
    "value": {
     "crt": "5px 5px 0 #a85f0f",
     "brutal": "4px 4px 0 #12110f",
     "brutal-dark": "4px 4px 0 #4d4639",
     "mocha": "none",
     "light": "none",
     "amoled": "none",
     "honey": "none"
    }
   },
   {
    "name": "type-sh",
    "usage": "Focused field lift",
    "value": {
     "crt": "4px 4px 0 #12466e",
     "brutal": "3px 3px 0 #12110f",
     "brutal-dark": "3px 3px 0 #ffc536",
     "mocha": "0 0 0 2px #89b4fa",
     "light": "0 0 0 2px #3b5b8c",
     "amoled": "0 0 0 2px #4c8dff",
     "honey": "0 0 0 2px #b45309"
    }
   }
  ]
 }
}```

## Appendix D — design system component CSS (bundle.css, source of states.css)

```css
/* WeaveForge states and motion (0.8.10 mock). Copied verbatim into the app as app/styles/states.css.
   Private --wf-* vars read theme tokens through fallbacks, so one file serves every app theme and the DS.
   State hooks: :hover/:active/:focus-visible, plus [data-force~="hover|press|focus"] for previews. */

/* ---------- Tiers ---------- */
:root {
  --wf-bw: 1px; --wf-press: 1px; --wf-lift: -1px;
  --wf-rc: 8px; --wf-rp: 10px; --wf-rm: 6px; --wf-rcard: 14px;
  --wf-t: 120ms; --wf-t-press: 60ms; --wf-t-pop: 120ms; --wf-t-exit: 80ms; --wf-t-modal: 180ms;
  --wf-ease: cubic-bezier(.2, .7, .2, 1); --wf-ease-hover: var(--wf-ease); --wf-ease-pop: var(--wf-ease);
  --wf-pop-y: 6px; --wf-pop-s: 1; --wf-tip-y: 4px; --wf-toast-y: 12px; --wf-modal-y: 8px; --wf-modal-s: .98;
  --wf-stagger: 0ms; --wf-item-anim: none; --wf-sw-hover: 1.08; --wf-back-x: -2px;
  --wf-line: var(--border-strong);
  --wf-hover-pct: 6%;
  --wf-hover: color-mix(in srgb, var(--text) var(--wf-hover-pct), transparent);
  --wf-press-bg: color-mix(in srgb, var(--text) calc(var(--wf-hover-pct) + 8%), transparent);
  --wf-focus: var(--type-line, var(--accent));
  --wf-accent-ink: var(--accent-ink, var(--accent));
  --wf-surface2: var(--surface2, var(--surface-2));
  --wf-danger: var(--danger-text, var(--s-danger));
  --wf-danger-soft: var(--danger-soft, var(--s-danger-bg));
  --wf-danger-fill: var(--danger-fill, var(--s-danger));
  --wf-toast-bg: var(--toast-bg, var(--text));
  --wf-toast-fg: var(--toast-fg, var(--bg));
  --wf-field-bg: var(--type-bg, var(--bg));
  --wf-field-sh: var(--type-sh, 0 0 0 2px var(--accent));
  --wf-field-t: none;
  --wf-sh-rest: var(--sh-sm, 0 1px 2px rgba(30, 30, 40, .08));
  --wf-sh-up: var(--sh-btn, 0 2px 4px rgba(30, 30, 40, .07), 0 10px 24px rgba(30, 30, 40, .07));
  --wf-sh-card: var(--sh-card, var(--wf-sh-rest));
  --wf-tip-sh: none;
  --wf-font: var(--btn-font, var(--font-face-sans, var(--font-sans, system-ui)));
  --wf-fs: 14px; --wf-fs-sm: 13px; --wf-fs-ghost: var(--wf-fs); --wf-fw: 600;
}
/* Slate: dark soft themes */
:root:is([data-theme="dark"], [data-theme="mocha"], [data-theme="dracula"], [data-theme="amoled"], [data-theme="contrast"], [data-theme="vivid-dark"], [data-theme="pastel-dark"], [data-theme="confetti-dark"]) {
  --wf-hover-pct: 7%;
  --wf-sh-rest: var(--sh-sm, 0 1px 2px rgba(0, 0, 0, .4));
  --wf-sh-up: var(--sh-btn, 0 2px 4px rgba(0, 0, 0, .42), 0 10px 24px rgba(0, 0, 0, .38));
}
/* Poster */
:root:is([data-theme="brutal"], [data-theme="brutal-dark"]) {
  --wf-bw: 2px; --wf-press: 3px; --wf-rc: 6px; --wf-rm: 4px; --wf-rcard: 6px; --wf-hover-pct: 8%;
  --wf-sh-rest: 3px 3px 0 var(--wf-line);
  --wf-sh-up: 4px 4px 0 var(--wf-line);
  --wf-tip-sh: var(--wf-sh-rest);
  --wf-field-t: translate(-2px, -2px);
}
:root[data-theme="brutal-dark"] { --wf-hover-pct: 10%; }
/* CRT: thicker ink, hard steps, pixel face on controls */
:root[data-theme="crt"] {
  --wf-bw: 3px; --wf-press: 4px; --wf-rc: 8px; --wf-rm: 6px; --wf-rcard: 12px; --wf-hover-pct: 8%;
  --wf-ease: steps(3, end); --wf-ease-hover: steps(2, end); --wf-ease-pop: steps(4, end);
  --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px;
  --wf-sh-rest: var(--sh-sm, 3px 3px 0 #2b222b);
  --wf-sh-up: var(--sh-btn, 5px 5px 0 #12466e);
  --wf-tip-sh: var(--wf-sh-rest);
  --wf-field-t: translateY(-2px);
  --wf-font: var(--btn-font, var(--font-pixel)); --wf-fs: 1.25rem; --wf-fs-sm: 1.1rem; --wf-fs-ghost: 1.15rem; --wf-fw: 400;
}
/* Reactive motion: longer, springier, further */
:root[data-motion="reactive"] {
  --wf-t: 200ms; --wf-t-pop: 200ms; --wf-t-modal: 260ms; --wf-lift: -2px;
  --wf-ease-hover: cubic-bezier(.34, 1.56, .64, 1); --wf-ease-pop: cubic-bezier(.34, 1.56, .64, 1);
  --wf-pop-y: 10px; --wf-pop-s: .97; --wf-tip-y: 6px; --wf-toast-y: 16px; --wf-modal-y: 16px; --wf-modal-s: .94;
  --wf-stagger: 18ms; --wf-item-anim: wf-item-in; --wf-sw-hover: 1.15; --wf-back-x: -4px;
}
/* CRT + Reactive: more steps, still no slide */
:root[data-theme="crt"][data-motion="reactive"] {
  --wf-t: 160ms; --wf-t-pop: 160ms; --wf-t-modal: 220ms;
  --wf-ease: steps(4, end); --wf-ease-hover: steps(4, end); --wf-ease-pop: steps(6, end);
  --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px;
}
@media (prefers-reduced-motion: reduce) {
  :root:root:root:root {
    --wf-t: 0ms; --wf-t-press: 0ms; --wf-t-pop: 0ms; --wf-t-exit: 0ms; --wf-t-modal: 0ms;
    --wf-lift: 0px; --wf-pop-y: 0px; --wf-pop-s: 1; --wf-tip-y: 0px; --wf-toast-y: 0px; --wf-modal-y: 0px; --wf-modal-s: 1;
    --wf-stagger: 0ms; --wf-item-anim: none; --wf-sw-hover: 1; --wf-back-x: 0px;
  }
}

/* ---------- Shared ---------- */
:is(.wf-btn, .wf-back, .wf-tool, .wf-seg > button, .wf-tab, .wf-nav, .wf-chip, .wf-swatch, .wf-toggle, .wf-check, .wf-radio, .wf-item, .wf-select, .wf-card) {
  -webkit-tap-highlight-color: transparent;
}
:is(.wf-btn, .wf-back, .wf-link, .wf-tool, .wf-seg > button, .wf-nav, a.wf-chip, button.wf-chip, .wf-chip-x, .wf-swatch, .wf-toggle, .wf-check, .wf-radio, .wf-card):is(:focus-visible, [data-force~="focus"]) {
  outline: 3px solid var(--wf-focus); outline-offset: 2px;
}
:is(.wf-btn, .wf-back, .wf-tool, .wf-seg > button, .wf-tab, .wf-nav, .wf-chip, .wf-swatch, .wf-toggle, .wf-check, .wf-radio, .wf-item, .wf-input, .wf-select):is(:disabled, [aria-disabled="true"]) {
  opacity: .5; cursor: not-allowed;
}

/* ---------- Button ---------- */
.wf-btn {
  --wf-bg: var(--surface); --wf-fg: var(--text); --wf-bd: var(--wf-line);
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-family: var(--wf-font); font-size: var(--wf-fs); font-weight: var(--wf-fw); line-height: 1.15;
  padding: 7px 13px; border: var(--wf-bw) solid var(--wf-bd); border-radius: var(--wf-rc);
  background: var(--wf-bg); color: var(--wf-fg); box-shadow: var(--wf-sh-rest);
  cursor: pointer; user-select: none; translate: 0 0; white-space: nowrap;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease),
    background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
.wf-btn:is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up);
}
.wf-btn:is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  translate: var(--wf-press) var(--wf-press); box-shadow: none; transition-duration: var(--wf-t-press);
}
.wf-btn.wf-primary { --wf-bg: var(--accent); --wf-fg: var(--accent-fg); }
.wf-btn.wf-soft { --wf-bg: var(--accent-soft); }
.wf-btn.wf-danger { --wf-bg: var(--wf-danger-fill); --wf-fg: var(--accent-fg); }
.wf-btn:is(.wf-ghost, .wf-icon, .wf-danger-ghost) {
  --wf-bg: transparent; --wf-bd: transparent; box-shadow: none; font-size: var(--wf-fs-ghost);
}
.wf-btn.wf-danger-ghost { --wf-fg: var(--wf-danger); }
.wf-btn:is(.wf-ghost, .wf-icon):is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bd: var(--wf-line); --wf-bg: var(--wf-hover); box-shadow: var(--wf-sh-rest);
}
.wf-btn.wf-danger-ghost:is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bd: var(--wf-danger); --wf-bg: var(--wf-danger-soft); box-shadow: var(--wf-sh-rest);
}
.wf-btn:is(.wf-ghost, .wf-icon, .wf-danger-ghost):is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"], [aria-busy="true"]) {
  --wf-bg: var(--wf-press-bg); translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); box-shadow: none;
}
.wf-btn.wf-danger-ghost:is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { --wf-bg: var(--wf-danger-soft); }
.wf-btn.wf-icon { width: 34px; height: 34px; padding: 5px; }
.wf-btn.wf-icon svg { width: 18px; height: 18px; flex: none; }
.wf-btn.wf-sm { padding: 5px 10px; font-size: var(--wf-fs-sm); }
.wf-btn.wf-icon.wf-sm { width: 28px; height: 28px; padding: 4px; }
.wf-btn:is(:disabled, [aria-disabled="true"]) { box-shadow: var(--wf-sh-rest); }
.wf-btn:is(.wf-ghost, .wf-icon, .wf-danger-ghost):is(:disabled, [aria-disabled="true"]) { box-shadow: none; }
.wf-btn[aria-busy="true"] { cursor: progress; color: transparent; }
.wf-btn[aria-busy="true"]::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 14px; height: 14px; box-sizing: border-box;
  border: 2px solid var(--wf-fg); border-right-color: transparent; border-radius: 50%;
  animation: wf-spin .7s linear infinite;
}
:root[data-theme="crt"] .wf-btn[aria-busy="true"]::after { border-radius: 2px; animation-timing-function: steps(8, end); }

/* ---------- Back button ---------- */
.wf-back {
  display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none;
  color: var(--text); font-family: var(--wf-font); font-size: var(--wf-fs); font-weight: var(--wf-fw); cursor: pointer;
  border-radius: var(--wf-rc);
}
.wf-back-box {
  display: grid; place-items: center; width: 34px; height: 34px; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc); background: var(--surface);
  box-shadow: var(--wf-sh-rest); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease);
}
.wf-back-box svg { width: 18px; height: 18px; translate: 0 0; transition: translate var(--wf-t) var(--wf-ease-hover); }
.wf-back:is(:hover, [data-force~="hover"]):not(:disabled) .wf-back-box { translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up); background: var(--accent-soft); }
.wf-back:is(:hover, [data-force~="hover"]):not(:disabled) .wf-back-box svg { translate: var(--wf-back-x) 0; }
.wf-back:is(:active, [data-force~="press"]):not(:disabled) .wf-back-box { translate: var(--wf-press) var(--wf-press); box-shadow: none; transition-duration: var(--wf-t-press); }

/* ---------- Link ---------- */
.wf-link {
  color: var(--wf-accent-ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); cursor: pointer; border-radius: 2px;
  transition: text-decoration-color var(--wf-t) var(--wf-ease), text-decoration-thickness var(--wf-t) var(--wf-ease), opacity var(--wf-t-press) linear;
}
.wf-link:is(:hover, [data-force~="hover"]) { text-decoration-color: currentColor; text-decoration-thickness: 2px; }
.wf-link:is(:active, [data-force~="press"]) { opacity: .7; }

/* ---------- Tool toggle ---------- */
.wf-tool {
  display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; box-sizing: border-box;
  border: var(--wf-bw) solid transparent; border-radius: var(--wf-rc); background: transparent; color: var(--text); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease), filter var(--wf-t-press) linear;
}
.wf-tool svg { width: 18px; height: 18px; }
.wf-tool:is(:hover, [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { border-color: var(--wf-line); background-color: var(--wf-hover); }
.wf-tool:is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
.wf-tool:is([aria-pressed="true"], [aria-checked="true"]) { background-color: var(--accent); color: var(--accent-fg); border-color: var(--wf-line); }
.wf-tool:is([aria-pressed="true"], [aria-checked="true"]):is(:active, [data-force~="press"]) { filter: brightness(.94); }

/* ---------- Segmented ---------- */
.wf-seg { display: inline-flex; gap: 4px; }
.wf-seg > button {
  font-family: var(--wf-font); font-size: var(--wf-fs-sm); font-weight: var(--wf-fw); line-height: 1.2;
  padding: 4px 10px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc);
  background: var(--surface); color: var(--text); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease), filter var(--wf-t-press) linear;
}
.wf-seg > button:is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--surface)); }
.wf-seg > button:is(:active, [data-force~="press"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) calc(var(--wf-hover-pct) + 8%), var(--surface)); transition-duration: var(--wf-t-press); }
.wf-seg > button:is([aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]) { background-color: var(--accent); color: var(--accent-fg); }
.wf-seg > button:is([aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]):is(:active, [data-force~="press"]) { filter: brightness(.94); }

/* ---------- Tabs ---------- */
.wf-tabs { display: flex; gap: 2px; border-bottom: var(--wf-bw) solid var(--wf-line); }
.wf-tab {
  position: relative; padding: 8px 12px; border: 0; border-radius: var(--wf-rc) var(--wf-rc) 0 0; background: transparent;
  color: var(--muted); font: inherit; font-size: var(--wf-fs-sm); font-weight: 600; cursor: pointer;
  transition: color var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease);
}
.wf-tab::after {
  content: ""; position: absolute; left: 8px; right: 8px; bottom: calc(-1 * var(--wf-bw)); height: 3px;
  background: var(--wf-accent-ink); scale: 0 1; transition: scale var(--wf-t) var(--wf-ease-hover);
}
.wf-tab:is(:hover, [data-force~="hover"]):not(:disabled) { color: var(--text); background-color: var(--wf-hover); }
.wf-tab:is(:active, [data-force~="press"]):not(:disabled) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
.wf-tab:is([aria-selected="true"], [aria-current="page"]) { color: var(--text); }
.wf-tab:is([aria-selected="true"], [aria-current="page"])::after { scale: 1 1; }
.wf-tab:is(:focus-visible, [data-force~="focus"]) { outline: 3px solid var(--wf-focus); outline-offset: -3px; }

/* ---------- Nav item ---------- */
.wf-nav {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--wf-rc);
  color: var(--text); text-decoration: none; font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
.wf-nav:is(:hover, [data-force~="hover"]) { background-color: var(--wf-hover); }
.wf-nav:is(:active, [data-force~="press"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
.wf-nav[aria-current="page"] { background-color: var(--accent-soft); color: var(--wf-accent-ink); font-weight: 600; }

/* ---------- Chip ---------- */
.wf-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border: var(--wf-bw) solid var(--wf-line);
  border-radius: 999px; background: var(--surface); color: var(--text); text-decoration: none;
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; font-weight: 600; line-height: 1.3;
}
.wf-chip.wf-ext { border-style: dashed; }
:is(a, button).wf-chip {
  cursor: pointer; box-shadow: var(--wf-sh-rest); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
a.wf-chip[href]::after { content: "\2197"; }
:is(a, button).wf-chip:is(:hover, [data-force~="hover"]):not(:disabled) { translate: 0 var(--wf-lift); box-shadow: var(--wf-sh-up); }
:is(a, button).wf-chip:is(:active, [data-force~="press"]):not(:disabled) { translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); box-shadow: none; transition-duration: var(--wf-t-press); }
button.wf-chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
.wf-chip-x {
  display: inline-grid; place-items: center; width: 16px; height: 16px; margin-right: -4px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
}
.wf-chip-x:is(:hover, [data-force~="hover"]) { background: var(--wf-danger-soft); color: var(--wf-danger); }
.wf-chip-x:is(:active, [data-force~="press"]) { scale: .9; }

/* ---------- Swatch ---------- */
.wf-swatch {
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--sw, var(--accent)); cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent); scale: 1;
  transition: scale var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease);
}
.wf-swatch:is(:hover, [data-force~="hover"]) { scale: var(--wf-sw-hover); }
.wf-swatch:is(:active, [data-force~="press"]) { scale: .94; transition-duration: var(--wf-t-press); }
.wf-swatch:is([aria-pressed="true"], [aria-checked="true"]) { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
.wf-swatch:is(:focus-visible, [data-force~="focus"]) { outline-offset: 5px; }
.wf-pop .wf-swatch { width: 22px; height: 22px; }
.wf-swatch.wf-current { width: 30px; height: 30px; }

/* ---------- Toggle (input type=checkbox role=switch) ---------- */
.wf-toggle {
  appearance: none; position: relative; flex: none; width: 36px; height: 20px; margin: 0; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: 999px; background: var(--wf-surface2); cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease);
}
.wf-toggle::before {
  content: ""; position: absolute; top: 2px; left: 2px; width: calc(20px - 2 * var(--wf-bw) - 4px); height: calc(20px - 2 * var(--wf-bw) - 4px);
  border-radius: 999px; background: var(--muted); translate: 0 0;
  transition: translate var(--wf-t) var(--wf-ease-hover), width var(--wf-t-press) linear, background-color var(--wf-t) var(--wf-ease);
}
.wf-toggle:is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--wf-surface2)); }
.wf-toggle:is(:active, [data-force~="press"]):not(:disabled)::before { width: calc(24px - 2 * var(--wf-bw) - 4px); }
.wf-toggle:checked { background-color: var(--accent); }
.wf-toggle:checked::before { background: var(--accent-fg); translate: 16px 0; }
.wf-toggle:checked:is(:active, [data-force~="press"]):not(:disabled)::before { translate: 12px 0; }
.wf-toggle:checked:is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--accent)); }

/* ---------- Checkbox and radio (native inputs) ---------- */
.wf-check, .wf-radio {
  appearance: none; position: relative; flex: none; width: 18px; height: 18px; margin: 0; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); background: var(--surface); cursor: pointer; scale: 1;
  transition: background-color var(--wf-t) var(--wf-ease), scale var(--wf-t) var(--wf-ease-hover);
}
.wf-check { border-radius: max(2px, calc(var(--wf-rm) - 2px)); }
.wf-radio { border-radius: 50%; }
:is(.wf-check, .wf-radio):is(:hover, [data-force~="hover"]):not(:disabled) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--surface)); }
:is(.wf-check, .wf-radio):is(:active, [data-force~="press"]):not(:disabled) { scale: .92; transition-duration: var(--wf-t-press); }
.wf-check::after {
  content: ""; position: absolute; left: 50%; top: 45%; width: 4px; height: 8px; border: solid var(--accent-fg);
  border-width: 0 2px 2px 0; translate: -50% -50%; rotate: 45deg; scale: 0; transition: scale var(--wf-t) var(--wf-ease-hover);
}
.wf-check:is(:checked, :indeterminate) { background-color: var(--accent); }
.wf-check:checked::after { scale: 1; }
.wf-check:indeterminate::after { top: 50%; width: 8px; height: 0; border-width: 0 0 2px 0; rotate: 0deg; scale: 1; }
.wf-radio::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 8px; height: 8px; border-radius: 50%;
  background: var(--wf-accent-ink); scale: 0; transition: scale var(--wf-t) var(--wf-ease-hover);
}
.wf-radio:checked::after { scale: 1; }

/* ---------- Input and select ---------- */
.wf-input, .wf-select {
  font: inherit; font-size: 14px; line-height: 1.3; padding: 7px 10px; box-sizing: border-box;
  border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rc); background: var(--bg); color: var(--text);
  transition: background-color var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease),
    box-shadow var(--wf-t) var(--wf-ease), transform var(--wf-t) var(--wf-ease-hover);
}
.wf-input::placeholder { color: var(--muted); opacity: 1; }
:is(.wf-input, .wf-select):is(:hover, [data-force~="hover"]):not(:disabled, :focus, [aria-expanded="true"]) { background-color: color-mix(in srgb, var(--text) var(--wf-hover-pct), var(--bg)); }
.wf-input:is(:focus, [data-force~="focus"]), .wf-select:is(:focus-visible, [data-force~="focus"], [aria-expanded="true"]) {
  outline: none; background-color: var(--wf-field-bg); border-color: var(--wf-focus); box-shadow: var(--wf-field-sh);
  transform: var(--type-t, var(--wf-field-t));
}
:is(.wf-input, .wf-select)[aria-invalid="true"] { border-color: var(--wf-danger); }
.wf-input:read-only:not(:disabled) { background-color: var(--wf-surface2); }
.wf-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 160px; text-align: left; cursor: pointer; }
.wf-select::after {
  content: ""; width: 6px; height: 6px; margin-top: -3px; border: solid currentColor; border-width: 0 2px 2px 0;
  rotate: 45deg; transition: rotate var(--wf-t) var(--wf-ease-hover), margin var(--wf-t) var(--wf-ease-hover);
}
.wf-select[aria-expanded="true"]::after { rotate: 225deg; margin-top: 3px; }

/* ---------- Popover (dropdowns, pickers, menus) ---------- */
.wf-pop {
  box-sizing: border-box; padding: 8px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rp);
  background: var(--elev, var(--surface)); color: var(--text); box-shadow: var(--wf-sh-up);
  opacity: 1; translate: 0 0; scale: 1; transform-origin: top center;
  transition: opacity var(--wf-t-pop) var(--wf-ease), translate var(--wf-t-pop) var(--wf-ease-pop), scale var(--wf-t-pop) var(--wf-ease-pop),
    display var(--wf-t-pop) allow-discrete, overlay var(--wf-t-pop) allow-discrete;
}
@starting-style { .wf-pop { opacity: 0; translate: 0 var(--wf-pop-y); scale: var(--wf-pop-s); } }
.wf-pop:is(.wf-closing, [data-state="closed"]) {
  opacity: 0; translate: 0 calc(var(--wf-pop-y) / 2); scale: var(--wf-pop-s); pointer-events: none;
  transition-duration: calc(var(--wf-t-pop) * .67); transition-timing-function: ease;
}
:root[data-theme="crt"] .wf-pop {
  clip-path: inset(0 -12px -12px -12px);
  transition: clip-path var(--wf-t-pop) var(--wf-ease-pop), display var(--wf-t-pop) allow-discrete, overlay var(--wf-t-pop) allow-discrete;
}
@starting-style { :root[data-theme="crt"] .wf-pop { clip-path: inset(0 -12px 100% -12px); } }
:root[data-theme="crt"] .wf-pop:is(.wf-closing, [data-state="closed"]) { opacity: 1; clip-path: inset(0 -12px 100% -12px); transition-timing-function: steps(2, end); }

/* ---------- Menu (inside .wf-pop) ---------- */
.wf-menu { display: flex; flex-direction: column; gap: 2px; min-width: 180px; padding: 6px; }
.wf-item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; box-sizing: border-box;
  border: 0; border-radius: max(2px, calc(var(--wf-rc) - 2px)); background: transparent; color: var(--text);
  font: inherit; font-size: 14px; font-weight: 500; text-align: left; text-decoration: none; cursor: pointer;
  transition: background-color var(--wf-t) var(--wf-ease), color var(--wf-t) var(--wf-ease);
  animation: var(--wf-item-anim) var(--wf-t-pop) var(--wf-ease) backwards; animation-delay: calc(var(--wf-i, 0) * var(--wf-stagger));
}
.wf-item:is(:hover, [data-highlighted], [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-hover); }
.wf-item:is(:focus-visible, [data-force~="focus"]) { outline: none; background-color: var(--wf-hover); box-shadow: inset 0 0 0 2px var(--wf-focus); }
.wf-item:is(:active, [data-force~="press"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-press-bg); transition-duration: var(--wf-t-press); }
.wf-item:is([aria-checked="true"], [aria-selected="true"]) { font-weight: 600; color: var(--wf-accent-ink); }
.wf-item:is([aria-checked="true"], [aria-selected="true"])::after { content: "\2713"; margin-left: auto; }
.wf-item.wf-danger { color: var(--wf-danger); }
.wf-item.wf-danger:is(:hover, [data-highlighted], [data-force~="hover"]):not(:disabled, [aria-disabled="true"]) { background-color: var(--wf-danger-soft); }
.wf-item svg { width: 16px; height: 16px; flex: none; }
.wf-kbd { margin-left: auto; padding-left: 12px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; color: var(--muted); }
.wf-sep { height: 0; margin: 4px 2px; border: 0; border-top: var(--wf-bw) solid var(--wf-line); opacity: .35; }
.wf-menu-label { padding: 6px 10px 2px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.wf-menu > :nth-child(2) { --wf-i: 1; } .wf-menu > :nth-child(3) { --wf-i: 2; } .wf-menu > :nth-child(4) { --wf-i: 3; }
.wf-menu > :nth-child(5) { --wf-i: 4; } .wf-menu > :nth-child(6) { --wf-i: 5; } .wf-menu > :nth-child(7) { --wf-i: 6; }
.wf-menu > :nth-child(8) { --wf-i: 7; } .wf-menu > :nth-child(n+9) { --wf-i: 8; }

/* ---------- Tooltip ---------- */
.wf-has-tip { position: relative; display: inline-flex; }
.wf-tip {
  position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 20; white-space: nowrap; pointer-events: none;
  padding: 4px 8px; border-radius: var(--wf-rm); background: var(--wf-toast-bg); color: var(--wf-toast-fg);
  font-size: 12px; font-weight: 600; line-height: 1.3; box-shadow: var(--wf-tip-sh);
  opacity: 0; translate: -50% var(--wf-tip-y); transition: opacity var(--wf-t-exit) ease, translate var(--wf-t-exit) ease;
}
.wf-has-tip:hover > .wf-tip, .wf-tip:is([data-open], [data-force~="open"]) {
  opacity: 1; translate: -50% 0; transition: opacity var(--wf-t-pop) var(--wf-ease) 500ms, translate var(--wf-t-pop) var(--wf-ease-pop) 500ms;
}
.wf-has-tip:has(> :focus-visible) > .wf-tip { opacity: 1; translate: -50% 0; transition-delay: 0ms; }
:root[data-theme="crt"] .wf-tip { transition-timing-function: steps(2, end); }

/* ---------- Toast ---------- */
.wf-toast {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--wf-rp);
  background: var(--wf-toast-bg); color: var(--wf-toast-fg); box-shadow: var(--wf-sh-up); font-size: 14px; font-weight: 500;
  opacity: 1; translate: 0 0;
  transition: opacity calc(var(--wf-t-pop) * 1.5) var(--wf-ease), translate calc(var(--wf-t-pop) * 1.5) var(--wf-ease-pop), display 120ms allow-discrete;
}
@starting-style { .wf-toast { opacity: 0; translate: 0 var(--wf-toast-y); } }
.wf-toast:is(.wf-closing, [data-state="closed"]) { opacity: 0; translate: 0 calc(var(--wf-toast-y) / 2); transition: opacity 120ms ease, translate 120ms ease; }
:root[data-theme="crt"] .wf-toast { clip-path: inset(-12px -12px -12px -12px); transition: clip-path calc(var(--wf-t-pop) * 1.5) var(--wf-ease-pop); }
@starting-style { :root[data-theme="crt"] .wf-toast { opacity: 1; translate: 0 0; clip-path: inset(100% -12px -12px -12px); } }

/* ---------- Modal, scrim and sheet ---------- */
.wf-scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); opacity: 1; transition: opacity var(--wf-t-modal) ease; }
@starting-style { .wf-scrim { opacity: 0; } }
.wf-modal {
  box-sizing: border-box; padding: 20px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rcard);
  background: var(--surface); color: var(--text); box-shadow: var(--wf-sh-card);
  opacity: 1; translate: 0 0; scale: 1;
  transition: opacity var(--wf-t-modal) var(--wf-ease), translate var(--wf-t-modal) var(--wf-ease-pop), scale var(--wf-t-modal) var(--wf-ease-pop);
}
@starting-style { .wf-modal { opacity: 0; translate: 0 var(--wf-modal-y); scale: var(--wf-modal-s); } }
:is(.wf-modal, .wf-scrim, .wf-sheet):is(.wf-closing, [data-state="closed"]) { opacity: 0; transition-duration: 120ms; transition-timing-function: ease; }
:root[data-theme="crt"] .wf-modal { clip-path: inset(-12px); transition: clip-path var(--wf-t-modal) steps(4, end); }
@starting-style { :root[data-theme="crt"] .wf-modal { opacity: 1; translate: 0 0; scale: 1; clip-path: inset(50% 0 50% 0); } }
.wf-sheet {
  box-sizing: border-box; border-left: var(--wf-bw) solid var(--wf-line); background: var(--surface); color: var(--text);
  box-shadow: var(--wf-sh-card); translate: 0 0; transition: translate var(--wf-t-modal) var(--wf-ease), opacity 120ms ease;
}
@starting-style { .wf-sheet { translate: 100% 0; } }
:root[data-theme="crt"] .wf-sheet { transition-timing-function: steps(4, end); }

/* ---------- Card ---------- */
.wf-card {
  display: block; box-sizing: border-box; padding: 14px; border: var(--wf-bw) solid var(--wf-line); border-radius: var(--wf-rcard);
  background: var(--surface); color: var(--text); box-shadow: var(--wf-sh-card); text-decoration: none;
}
:is(a, button).wf-card, .wf-card[tabindex] {
  cursor: pointer; translate: 0 0; text-align: left; font: inherit;
  transition: translate var(--wf-t) var(--wf-ease-hover), box-shadow var(--wf-t) var(--wf-ease), border-color var(--wf-t) var(--wf-ease);
}
:is(a, button, [tabindex]).wf-card:is(:hover, [data-force~="hover"]) { translate: 0 var(--wf-lift); }
:is(a, button, [tabindex]).wf-card:is(:active, [data-force~="press"]) { translate: calc(var(--wf-press) * .67) calc(var(--wf-press) * .67); transition-duration: var(--wf-t-press); }

/* ---------- Keyframes ---------- */
@keyframes wf-spin { to { rotate: 1turn; } }
@keyframes wf-item-in { from { opacity: 0; translate: 0 4px; } }
@media (prefers-reduced-motion: reduce) {
  .wf-item { animation: none; }
  .wf-btn[aria-busy="true"]::after { animation-duration: 1.6s; }
  :root[data-theme="crt"] :is(.wf-pop, .wf-toast, .wf-modal) { transition-duration: 0ms; }
}
```

## Appendix E — design system README

### WeaveForge

Read, note and weave research into one graph. Loud where it helps, quiet where you read.

#### Themes

**CRT is the primary theme.** It is a warm phosphor screen with ink outlines, pixel display type, scanlines and cards that lean. The other themes are secondary:

| Theme | id | Character |
|---|---|---|
| CRT | `crt` | Primary. Cream ground, 3px ink, Jersey 10 titles, blue accent, red active nav |
| Poster light | `brutal` | Neo-brutalist paper with 2px ink, diagonal offset shadows and a yellow accent |
| Poster dark | `brutal-dark` | Poster on near-black with cream ink |
| Mocha | `mocha` | Soft dark (Catppuccin), hairlines, no hard shadows |
| Paper | `light` | Soft warm light, blue accent |
| Amoled | `amoled` | True black for OLED |
| Honey | `honey` | Soft warm light, amber accent |

Tokens that only exist in the Poster and CRT stylesheets (nav fill, tints, chips, toast, well, danger fill) are mapped onto each soft theme's own palette: the accent for nav, the status washes for tints.

#### Principles

- **Hard edges.** Outlines are ink: 3px on CRT, 2px on Poster. Shadows are offset and never blur.
- **Hover changes brightness only.** Nothing moves on hover.
- **Icon buttons sit flush.** At rest an icon button (the card ⋮ menu, share, open) has a transparent border and no fill. On hover it pops: ink border, a light fill and `sh-sm`. While its menu is open it becomes the accent tile. On paper cards it rests at 35% opacity until the card is hovered.
- **Press drops into the shadow.** On press, a button translates by its shadow (CRT `translate(5px,5px)`, Poster `translate(4px,4px)`) and the shadow goes to none.
- **The focused field lifts.** While you type, the field fills with `type-bg`, outlines in `type-line` and gains `type-sh`.
- **Focus rings are ink, never browser blue.**
- **Sentence case everywhere.** Write "Add paper", not "Add Paper".
- Say **Notes**, never "vault".

#### Type

- **Rubik** for all UI and reading text. Poster display uses weight 800.
- **Jersey 10** is the CRT pixel face. Use it only for titles and buttons: 2.75rem for screen titles, 1.6rem for card and modal titles, 1.25rem for buttons and 1.15rem for ghost buttons, all at weight 400.
- **JetBrains Mono** for code, DOIs and identifiers.

All three load from Google Fonts.

#### Shape

| | CRT | Poster | Soft themes |
|---|---|---|---|
| Card radius | 12px | 6px | 14px |
| Control radius | 8px | 4px | 10px |
| Border | 3px ink | 2px ink | 1px hairline |
| Card shadow | `6px 6px 0` ink | `5px 5px 0` ink | faint or none |

#### CRT extras

- Scanlines over the page: a fixed, pointer-transparent overlay of 1px ink lines (`rgba(43,34,43,.06)`) every 3px, plus a soft vignette darkening the edges to 18%. It never moves, hides in print, and a "Scanlines" setting turns it off (`data-scanlines="off"`).
- Leaning cards that sit at a slight tilt.
- Card tint modes: full, bar, border and none. A card's tint comes from its reading state (`tint-*`) or its tag (`tag-*-tint`).

#### Reading states

| State | Chip | Tint |
|---|---|---|
| To read | `chip-to-read` | `tint-to-read` |
| Reading | `chip-reading` | `tint-reading` |
| Read | `chip-read` | `tint-read` |
| Skimmed | `chip-skimmed` | `tint-skimmed` |
| Dropped | `chip-danger` | — |

#### Logo

The weave mark is `apps/web/public/icons/weave_forge.svg` in the repo.
