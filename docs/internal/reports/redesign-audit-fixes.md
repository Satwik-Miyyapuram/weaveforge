# Redesign audit — verification and remediation log

What was checked in [redesign-suggestions.md](redesign-suggestions.md) against
the code as it stands, what was still broken and is now fixed, and what was
re-read and found **not** to be a defect.

This file is the record of work, not a second copy of the audit. The audit
states what looked wrong; this states what was true when each finding was
re-read, and why.

## Method

The audit was anchored at `d2dcc35` (2026-09-11). This pass is at `071490b`
(2026-09-19) — four merged pulls and a good deal of reader, ink and citation
work later. Every one of R1–R14 was re-read in the current tree before anything
was changed, the way [`review-2-fixes.md`](review-2-fixes.md) records doing for
the pass-2 review.

Most of the audit had already been actioned, by four commits:

| Commit | Closed |
| --- | --- |
| `0ed508b` *fix: close the redesign audit's app-side findings* | R2, R5, R6, R7, R8, R10, R11, R12, R13, R14 |
| `b00cb93` *fix(pitch): give the page navigation below 1180px* | R1 |
| `f3fd3fd` *feat(pitch): a link preview card, and a 404 for each host* | R3 (exported site), R4 |
| `9ba9f72` *feat: compose the empty states, and gate the bare one* | R9 |

So the useful question was not "is this finding right" but "is it *still* fixed"
— and, for the parts the audit itself said it had not measured (§5), "what does
measuring them turn up". Both questions found things.

## Status

Legend: **Already fixed** (verified, not assumed) · **Fixed** (was broken on
this pass) · **Refuted** (re-read; not a defect) · **New** (found while
verifying) · **Open** (a decision, with the reason it is one).

| # | Finding | State on this pass |
| --- | --- | --- |
| R1 | No pitch navigation below 1180px | Already fixed — **New: the disclosure's `aria-controls` pointed at nothing while closed. Fixed** |
| R2 | `.btn-primary` motion inert on anchors | Already fixed. One line of its *Do* **Refuted** — and the code is better than what the audit asked for |
| R3 | No link preview on the public site | Already fixed for the exported site — **the app is a second public host for the same page and had none. Fixed** |
| R4 | No custom 404 | Already fixed, both hosts |
| R5 | `height: 100vh` on the pinned rail | Already fixed |
| R6 | No skip-to-content link | Already fixed |
| R7 | Project picker is a clickable `<li>` | Already fixed |
| R8 | Four OS dialogs remain | Already fixed — **New: one had come back in the reader, and the gate written to stop it could not see the file it was in. Both fixed** |
| R9 | Empty states are one grey sentence | Already fixed |
| R10 | `z-index` has no scale | Already fixed. Its *Done when* grep **Refuted** |
| R11 | Anchor jumps are instant | Already fixed — verified past the audit's ask: all nine targets, not one |
| R12 | `text-wrap` is pitch-only | Already fixed. The `reader.css` half of its *Do* **Refuted** — it would be inert at best |
| R13 | Transition durations disagree | **Fixed.** The tokens existed but did not control the durations — nor the reactive ramp's, which the finding's second sentence also asked for |
| R14 | Static inline styles in JSX | Already fixed |
| §5 | "Colour contrast was not computed" | **Fixed, measured and gated.** See §2 — this is where the real work was |
| — | CI lint had drifted off its own recorded baseline | **New, fixed.** Five warnings, all false positives, now documented as such |

Four findings were still open on this pass (R3's second host, R8's returned
dialog, R13's inert tokens, and the contrast gap the audit named but could not
close). Two defects the audit never saw were found while verifying its fixes
(R1's dangling IDREF, and the `.tsx`-only gate that let R8 come back). Three of
its instructions were re-read and are wrong as written.

---

## 1. What was still broken

### R8 — an OS dialog had come back, and the gate that existed for it was blind · Fixed

`0ed508b` migrated the three call sites the audit named and added
`components/confirm-dialog.tsx` for them, plus a rule in
`scripts/check-ui-consistency.mjs` banning `window.confirm|prompt` outside the
two error boundaries. All of that held.

Then the reader work added a fourth:

```ts
if (options?.confirm !== false && !window.confirm("Delete this local annotation?")) return;
```

`apps/web/src/features/reader/ui/pdf-reader/use-annotation-actions.ts`, deleting
a local annotation from the sidebar's Delete button and from the Delete key.

**Why the gate did not catch it.** The rule was right and its allow-list was
right, but `collect()` gathered `entry.endsWith(".tsx")` — and the violating
call site was a hook in a `.ts` file. An OS dialog lives wherever the code that
asks the question lives, which in this codebase is often not the component. The
one gate written for the one rule was scoped to the half of the tree the
violation was least likely to be in.

**Fixed, both halves.**

- The hook no longer asks anything. `removeLocal(id)` deletes; a new
  `askRemove(id)` / `pendingRemove` / `clearPendingRemove` trio names the
  annotation a question is open for, and `pdf-reader.tsx` draws `ConfirmDialog`
  over it — the hook cannot render, so the question moved to the caller that
  can. The two paths a person chooses (the sidebar's Delete, the Delete key on a
  selected mark) go through `askRemove`. The eraser and ink undo call
  `removeLocal` directly, which is what they asked for before by passing
  `{ confirm: false }`; a dialog per stroke would make rubbing out a word
  unusable, and both are already deliberate gestures with an undo behind them.
  `AnnotationSidebar`'s `onRemoveLocal` prop became `(id: string) => void`,
  since asking is not async.
- `collect()` now takes `.ts` as well as `.tsx`, and the rule covers `alert`
  too. Verified by putting the violation back and watching the gate name
  `use-annotation-actions.ts:184`, then removing it and watching the gate pass.

The audit's *Done when* — `grep -rn "window\.prompt\|window\.confirm"
apps/web/src` lists only the two error-boundary files — now holds, and holds
against a gate rather than a grep.

### R3 — the app is a second public host for the pitch, and it had no card · Fixed

`f3fd3fd` gave the exported site a complete `openGraph` / `twitter` /
`metadataBase` block and an `og.png`. That half is sound and was left alone.

The half the audit only mentioned in passing is the one that was still open. It
noted that `apps/web/src/app/layout.tsx` "is the same shape", and its *Do* did
not ask for it — but the app does not merely contain a copy of the pitch, it
**serves it publicly**:

```tsx
// The product pitch is public and renders its own chrome: no auth gate, no
// project gate, no nav.
if (pathname === "/pitch") return <>{children}</>;
```

`apps/web/src/app/app-shell.tsx:41-44`. So `https://app.weaveforge.org/pitch`
answers with the same page and no card behind it — no title, no description, no
image — for anyone who shares that URL rather than the site's.

**Fixed**, with the drift the audit's own §2 warns about as the design
constraint:

- New `apps/web/src/app/pitch/share-card.ts` holds the title, the description
  and the whole `openGraph`/`twitter` block as one `pitchShareMetadata({ origin,
  basePath, path })`. `apps/pitch/app/layout.tsx` now builds its card from it
  too, so the two hosts cannot disagree — the same rule as
  `apps/pitch/app/page.tsx` re-exporting the page rather than copying it.
- New `apps/web/src/app/pitch/layout.tsx` applies it to that one segment. Not to
  `app/layout.tsx`: every other route in the app is behind a login, so a
  marketing card on the root layout would promise a workspace and render a
  sign-in form.
- The origin is resolved by `appOriginFrom()`, which falls back to the shipped
  deployment when `NEXT_PUBLIC_APP_URL` is unset — that variable is already the
  project's name for "where the app lives", so a self-hosted copy gets a card
  naming its own host. It ignores a value that is not an absolute http(s) URL
  rather than honouring it, because `metadataBase` is constructed at build time
  and the shape a mis-set variable takes is the bare path the pitch's own
  `links.ts` falls back to; failing a build over a link preview is the wrong
  trade.
- `apps/web/src/app/pitch/test/share-card.test.ts` — 9 tests pinning that both
  hosts carry one title and one description, that `metadataBase` is absolute,
  that a `basePath` prefixes the asset and the page but not the base, and that
  the origin guard rejects `/`, `not a url`, `ftp://` and a bare host.

The exported site's card is byte-for-byte what it was; this pass moved where it
is written, not what it says.

**Not verified by build.** `npm run build --workspace @weaveforge/pitch` cannot
run in this environment: `next/font` fetches IBM Plex Sans/Serif/Mono from
Google Fonts at build time and this sandbox has no route to it, so both Next
apps fail to compile before emitting. The card is therefore verified by
typecheck (Next's own `Metadata` type) and by the nine tests above, not by a
rendered `og:image` tag. That is the audit's own *Done when* left unmet, and it
is recorded rather than claimed.

### R13 — the duration tokens did not control the durations · Fixed

`0ed508b` added `--dur-fast` / `--dur-base` to `styles/base.css` and used them
on `.btn-primary`, `.btn-secondary`, `.btn-ghost` and `.card`, and corrected the
audit's `60ms` to `150ms` with the reason recorded — 60 ms was below the
threshold at which a press reads as a press.

What it left is that the tokens were decorative. Fifty literal `0.15s` values
sat in thirteen stylesheets beside a token whose value is `150ms`, agreeing with
it by coincidence; `forms.css` carried both in one file. Retuning
`--dur-base` would have moved four controls and left the rest of the app behind,
which is the exact failure the audit's *Suggestion* was written to prevent.

**Fixed.** Every `0.15s` under `apps/web/src/app/styles/` is now
`var(--dur-base)`. Checked before converting: all fifty were inside `transition`
declarations (none in a comment, none a `transition-delay`), so the change is
value-identical and nothing looks different. Durations that are *not* 150 ms
were left alone — `0.12s`, `0.18s`, `0.2s`, `0.25s`, `0.3s`, `120ms` are hover
fades, a layout ease and a citation-underline flash, each a deliberate exception
rather than the token, and inventing a third token to absorb them would be a
scale with nothing on it. `base.css` now says which durations are the token's
and which are not, so the next reader does not have to reconstruct this.

The audit's *Done when* grep — `0\.06s|0\.15s|150ms|60ms` over `app/styles` —
returns four lines, all inside the token block in `base.css`: the two
definitions and the comment explaining them. No declaration in `app/styles`
carries a literal press duration. The exceptions above are not in that grep's
pattern, and are not claimed to be.

`--dur-fast` remains distinct in name and equal in value; that is `0ed508b`'s
decision, not this pass's, and it is a coherent one — the pair is a seam to
retune through if a press ever wants to be quicker than a fade.

**A second half of the finding was open, and this pass missed it on the first
read.** R13's *Do* has two sentences. Only the first — replace `0.06s` and
`0.15s` with the tokens — had been acted on. The second, "derive the `--rm-*`
values in `styles/motion.css` from them", had not:

    --rm-fast: calc(0.14s * var(--motion-scale));
    --rm-base: calc(0.26s * var(--motion-scale));
    --rm-slow: calc(0.52s * var(--motion-scale));

They now read the token, with base and slow as multiples of fast so the layer
keeps one literal and its progression:

    --rm-fast: calc(var(--dur-fast) * var(--motion-scale));
    --rm-base: calc(var(--rm-fast) * 1.75);
    --rm-slow: calc(var(--rm-fast) * 3.5);

This is not cosmetic, because the clause's stated purpose is a property that can
be tested: "so `--motion-scale` still scales everything at once." `--motion-scale`
is a user setting (`lib/theme/theme.ts:177`, clamped 0.5–2 from `config.json`)
and it previously reached only this layer. Resolving the declarations through
postcss rather than reading them, the ramp is 150 / 262.5 / 525 ms against the
140 / 260 / 520 it replaces — two of three unchanged to within a percent, the
third moved by ten milliseconds — and at `--motion-scale: 2` all three scale
(300 / 525 / 1050). Both stylesheets still parse. Nesting `calc()` inside
`calc()` through a custom property is valid, but it is the kind of thing worth
checking rather than assuming, which is why the numbers above are computed and
not quoted from the diff.

### R1 — the disclosure's `aria-controls` pointed at nothing · New, Fixed

Found while verifying `b00cb93`, which is otherwise correct and complete: one
`SECTIONS` list renders both navs, the sheet carries the scrollspy's
`aria-current`, the button has `aria-expanded`, and `test/pitch-sections.test.ts`
pins the list against the nine ids the scrollspy observes.

The sheet was mounted only while open:

```tsx
<button … aria-controls="pitch-sections" …>
{sectionsOpen ? <nav id="pitch-sections" …> : null}
```

`aria-controls` is an IDREF. While the disclosure was closed — that is, on every
load, at every width below 1180px — it named an element that was not in the
document, which is an authoring error, and the button announced itself as
controlling nothing.

**Fixed.** The `<nav>` is always in the document and carries
`hidden={!sectionsOpen}`, so the reference resolves at all times and the nine
links stay out of the accessibility tree until the disclosure opens. Because
`.sectionsSheet` declares `display: grid` — an author declaration, which beats
the UA's `[hidden] { display: none }` — the stylesheet gains
`.sectionsSheet[hidden] { display: none; }` with the reason beside it. Without
that rule the closed sheet would have been an open one.

### CI lint had drifted off the baseline its own review recorded · New, Fixed

Not in either audit. The pass-2 review's §1 records `npm run lint` as "Pass — no
ESLint warnings or errors". On this pass it printed five
`@next/next/no-img-element` warnings, all in the ink features added since.

Checked before silencing, because a warning that is correct should be fixed
rather than hidden. All five `<img>` elements take a `src` that is a `blob:` URL
the app creates itself and revokes itself — `use-ghost-images.ts:54`,
`use-ink-figure-urls.ts:50`, `use-ink-sheet-images.ts:187`, all
`URL.createObjectURL(blob)`. The `next/image` optimiser has no route for a URL
that exists only in one tab's memory, and each element is positioned and scaled
in ink space by the style beside it, which the wrapper `next/image` adds would
sit between it and the sheet. `<img>` is the correct element; the warnings were
false positives.

**Fixed** with scoped `eslint-disable-next-line` comments carrying that reason,
following the idiom `components/card-thumbs.tsx:23` and
`features/experiments/ui/experiment-panels.tsx:172` already use. Lint reads
`✔ No ESLint warnings or errors` again, so the next real warning is visible.

---

## 2. What measuring §5's open gap found

The audit's §5 lists five things it did not measure. Four needed a browser, a
device or a profiler and are still open. One named its own instrument:

> **Colour contrast was not computed.** … the project ships a `contrast.css`
> theme plus a `apps/web/scripts/contrast-audit.mjs` script, which is the right
> instrument — running it across all fourteen themes would be the way to close
> this gap properly.

It was run. Two things came out, and the second is the larger.

**The script was not run by anything.** No npm script referenced it, no CI step
ran it, and no doc outside the audit mentioned it. A gate that states a bar and
never runs is a comment.

**What it reported.** Zero failures on the six pairs it checked — but three
themes below the 3:1 bar it applies to `--faint`:

| Theme | `--faint` on `--bg` |
| --- | --- |
| honey | 2.64 |
| light (Paper, the default) | 2.71 |
| latte | 2.83 |

**What it did not check.** Its `PAIRS` list stopped at body, muted, faint,
accent and accent-as-text. It never looked at the semantic status ramp — which
is text, at the smallest size in the app:

```css
.status { flex: none; font-size: 0.72rem; … background: var(--st-neutral-bg); color: var(--st-neutral-fg); }
```

`apps/web/src/app/styles/entity-detail.css:196-201`, with `--st-*-fg` aliasing
`--s-*` in `themes/common.css:70-75`. The same ramp is the text colour of the
git chip (`styles/git.css:21,25`), the explorer's modified/untracked marks and
the status bar's save state (`styles/editor-workspace.css:176-177,1526-1527`),
and the tint of four pane-tab icons.

Measured across all fourteen themes: **28 status pairs below 4.5:1, in eleven
themes.** `pastel-light` ran 1.50–2.29 and `confetti-light` 1.94–2.95 — those
two render a status pill at roughly the contrast of their own background. The
default theme had three: `good` 4.32, `warn` 3.44, `mute` 3.11.

**Fixed.** Each failing foreground was moved the minimum distance in lightness
that clears the bar, holding its hue and saturation — computed, not eyeballed,
so the correction is the smallest one that works and stays inside the palette
family the theme was built from. `--faint` in honey/latte/light, and the ramp in
eleven themes. `pastel-light` and `confetti-light` needed the largest move
(14–28 points of lightness) and took it: a status colour you cannot read is not
a decoration, and both themes keep their character in the parts that carry it —
the pink base, the candy borders and, for confetti, the `--confetti-*` card
rotation, whose own comment says those tints are "a tint on a surface, not a
fill" and which are untouched.

One change closed two pair sets. After the ramp was fixed, every `--s-*` also
clears 4.5:1 straight on `--bg` (worst case 4.53), which is where the git chip,
the explorer marks and the status bar read it — so the pill and the page are both
covered by the same edit.

**Gated.** The script now checks 18 pairs × 14 themes: the six it had, the six
ramp colours on their own tint, and the six on `--bg`. It is
`npm run check:contrast` in `apps/web`, the fifth of the eight boundary gates in
`check:boundaries`, and its own step in `ci.yml` under the aggregate that fails
the job. Every theme passes; the run prints the ratios, so the next failure
arrives with its number attached.

### Open, and why it is a decision rather than a fix

`--faint` is checked at 3:1 — the large-text bar, which is what the script has
always applied and which every theme now clears. But `--faint` is not only
decorative. It paints `.rowNote` at 0.78rem in the pitch's compare table, an
input placeholder in the workspace explorer, and small copy in a dozen places in
`editor-workspace.css`. That text wants 4.5:1, and at 4.5:1 eight of the
fourteen themes fail.

Raising the token that far is not a contrast fix, it is a redesign: it puts
`--faint` within a step of `--muted` in nine themes. In Paper it would become
`#746e60` against a `--muted` of `#6b6659` — two tokens, one visible step, and
the three-level text hierarchy the ramp exists to express collapses to two.

So it is left, and left loudly: the reasoning is in the script beside the pair
that encodes the 3:1 bar, so nobody reads a green run as a settled question. The
two honest ways forward are to split the token (a decorative `--faint` and a
small-text `--subtle` at 4.5:1) or to accept it as decorative and move the small
text off it onto `--muted`. Both change what screens look like and both are the
maintainer's call.

---

## 3. Re-read and found not to be defects

Recorded so the negative results are not re-litigated, in the same spirit as the
audit's own §4 and `review-2-fixes.md` §9.

### R12's `reader.css` half — `text-wrap: pretty` there would be inert at best

The *Do* asks for `pretty` on "the prose containers in `styles/markdown.css` and
`styles/reader.css`". `markdown.css:3` has it. `reader.css` should not.

The reader's long-form text is not reflowed prose — it is pdf.js's text layer.
Both of its containers lay every span out absolutely, from the PDF's own
coordinates:

```css
.pdf-reader-textlayer :is(span, br) { position: absolute; white-space: pre; … }
.pdf-measure-shell .pdf-text-content :is(span, br) { position: absolute; white-space: pre; … }
```

`styles/reader.css:205-212,250-252`. `text-wrap` governs how a box breaks lines,
and there is no line breaking here to govern: each span is one run of glyphs
placed at a measured rectangle. On `.pdf-measure-shell` it would be worse than
inert — that host exists only to be measured off-screen so a page's links can be
found, and its own comment says that without those layout rules "the spans flow
like a paragraph and every measured glyph rectangle is wrong". Inviting the
browser to re-wrap them is inviting exactly that.

The prose a reader actually reads in this app is the note body, which is
`.markdown`, which has `pretty`. Finding closed as written; instruction declined
with the reason.

### R10's *Done when* — the grep asks for the wrong thing

It asks that `grep -rn "z-index: [0-9]" apps/web/src/app/styles` return only the
token block. Forty-two literals remain, and they should.

`styles/base.css:39-52` records why, and the reasoning is correct: the ladder is
for layers that can actually meet — things portalled to `<body>`, and fixed
overlays that take over a screen. A `z-index` inside a positioned component is
*local* ordering: a tab indicator behind its own label, a PDF text layer under
the marks drawn over it, an annotation layer two above the page it belongs to.
Replacing one of those with `var(--z-modal)` does not tidy it, it lifts it out
of its component and stacks it against the whole document — which is how a
sticky element ends up above a modal, the failure the audit wanted to prevent.

The fifteen rungs that can meet are tokenised, each with a comment naming what
lives there. That is the finding's *Suggestion* honoured and its *Done when*
grep refuted.

### R2's *Do* — "add `--accent-hover` to every file in `themes/`"

The audit counted 18 raw tokens and proposed a nineteenth per theme, which is
fourteen values to keep in step by hand. `0ed508b` derived it once instead:

```css
--accent-hover: color-mix(in srgb, var(--accent) 92%, var(--ink));
```

`apps/web/src/app/themes/common.css:62`. One line, inherited by all fourteen
themes, and it cannot fall out of step with `--accent` because it is computed
from it. That is `common.css`'s stated contract — a new theme redefines its raw
tokens and inherits the aliases — and the audit's instruction would have broken
it. It also fixes the thing the audit actually objected to: `color-mix` against
`--ink` is near-black in every palette, so hover stays inside the theme, and
`background` costs no composite pass the way `filter` did.

Refuted as an instruction; the finding it served is fixed.

### The pass-2 review's five open items — still deliberate

`review-2-fixes.md` marks five items Partial or Deferred. All five were re-read,
because "deferred" is the easiest status to mistake for "forgotten". All five
are decisions with their reasons written down, and none is an oversight:

| Item | Why it stays |
| --- | --- |
| B3 · no rate limit on the arxiv relay | `app/api/arxiv/route.ts:20-37` records that the one rate limiter in the schema was considered for this route and deliberately not used; the route caps per-request cost and caches the answer instead |
| E7 · `checkReleaseBuilds false` | `apps/web/twa/app/build.gradle:171`. §2 of that log explains what turning it on would cost a Bubblewrap build |
| F4 · contract suites not run against real adapters | The core half is done; the rest needs app-side wiring that is a feature, not a fix |
| F11 | Deferred with its design written down |
| G2 · unpinned `actions/*` | Still open, and bigger than recorded: that log counted six, and there are now **thirty** major-tag refs across five workflows against **one** SHA-pinned (the PyPI publisher). PR #240 bumped them. Pinning first-party GitHub actions is a real supply-chain question and still the maintainer's call — but the number in that log is stale and should not be quoted |

Nothing here was changed. Two of them (B3, E7) would break working behaviour if
"fixed" on the strength of a status label alone, which is the argument for
re-reading rather than clearing a list.

---

## 4. Verification

Run on this checkout, at the end of the work.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Pass — all four workspaces |
| Lint | `npm run lint` | Pass — `✔ No ESLint warnings or errors` (was five warnings) |
| Architecture gates | `npm run check:boundaries` | Pass — all eight, including the new `check:contrast` |
| Contrast | `npm run check:contrast` | Pass — 18 pairs × 14 themes, `0 normal-text pair(s) below AA` |
| Web tests | `npm run test:web` | **1428 passed, 0 failed** (53 suites) — 1419 before, plus the 9 new `share-card` tests |
| Core tests | `npm run test:core` | **1214 passed, 0 failed** (7 suites) |
| Docs | `npm run docs:generate` | Regenerated — the boundary-gates table in `docs/building/dev.md` and the atlas both pick up the eighth gate |
| R8 grep | `grep -rn "window\.confirm\|window\.prompt\|window\.alert" apps/web/src` | Only the two error-boundary files, and the comments that explain them |
| Gate blindness | re-introduced the violation in a `.ts` file | `FAIL: OS confirmation dialog … use-annotation-actions.ts:184`; removed, gate passes |
| R13 grep | `grep -rn "0\.06s\|0\.15s\|150ms\|60ms" apps/web/src/app/styles` | Four lines, all in the `base.css` token block — no declaration carries a literal press duration |
| R13 ramp | resolved the `--rm-*` `calc()` chain through postcss | `150 / 262.5 / 525` ms at `--motion-scale: 1`; `300 / 525 / 1050` at `2` — one setting reaches all three |

Two things deliberately not claimed:

- **No rendered verification.** `next build` cannot run here (`next/font` has no
  route to Google Fonts in this sandbox), so R3's `og:image` tag, R1's sheet at
  1024px and 390px, and R13's "same feel" are all reasoned from source and
  pinned by tests rather than screenshotted. The audit's §5 called this out as
  its own limit; it is still one.
- **Desktop and integration suites not run.** Nothing in this pass touches
  `apps/desktop`, `packages/core` or the schema. `npm run check:all` was not run
  in full for that reason.

## 5. Files touched

| Area | Change |
| --- | --- |
| Reader | `use-annotation-actions.ts`, `pdf-reader.tsx`, `use-ink-undo.ts`, `use-page-pointer.ts`, `annotation-sidebar.tsx` — the delete confirmation the app draws |
| Pitch | `apps/web/src/app/pitch/share-card.ts` (new), `apps/web/src/app/pitch/layout.tsx` (new), `apps/pitch/app/layout.tsx`, `pitch/page.tsx`, `pitch-header.module.css` |
| Themes | `amoled`, `confetti-dark`, `confetti-light`, `dracula`, `honey`, `latte`, `light`, `mocha`, `pastel-light`, `vivid-dark`, `vivid-light` — the minimum lightness move that clears the bar |
| Styles | `base.css` plus thirteen stylesheets — `0.15s` → `var(--dur-base)`; `motion.css` — the reactive ramp derived from `--dur-fast` |
| Ink | `ink-figures.tsx`, `ink-ghost-page.tsx`, `ink-page-static.tsx` — five scoped disables with the reason |
| Gates | `scripts/check-ui-consistency.mjs` (scan `.ts`, cover `alert`), `apps/web/scripts/contrast-audit.mjs` (the ramp), `apps/web/package.json` + `package.json` + `.github/workflows/ci.yml` (`check:contrast`) |
| Tests | `apps/web/src/app/pitch/test/share-card.test.ts` (new, 9) |
| Docs | `docs/building/dev.md`, `docs/building/architecture-map.md`, `docs/atlas.html` (generated), this file, and the status banner on the audit itself |
