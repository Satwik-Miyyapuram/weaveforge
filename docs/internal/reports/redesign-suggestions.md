# Redesign audit — what could change

**Suggestions only. No application code was modified to produce this document.**

A design audit of the three front ends — the app (`apps/web`), the public pitch
site (`apps/pitch` plus its real body at `apps/web/src/app/pitch`) and the docs
site (`apps/pitch/app/docs`) — read against a standard redesign checklist:
typography, colour and surfaces, layout, interactivity and states, content,
component patterns, iconography, code quality, and the omissions design work
usually leaves behind.

Audited on `main` at `4767270`; every citation re-read and confirmed at
`d2dcc35` (2026-09-11). Line numbers below are as of `d2dcc35`.

## 0. Hand-off brief — read this first

This report is fourteen independent fixes, R1–R14. Each is small enough for
one PR. §1 orders them; §3 gives each one a **Do / Done when / Verify** block
that is meant to be followed literally. Nothing here depends on the editor
workspace redesign (`docs/internal/design/editor-workspace-redesign.md`) and
nothing there depends on this.

### Paths

Paths are relative to `apps/web/src/` unless they begin with `apps/`, `packages/`
or `docs/`:

| Written as | Means |
| --- | --- |
| `styles/…` | `apps/web/src/app/styles/…` |
| `app/…`, `app-shell.tsx`, `route-error.tsx` | `apps/web/src/app/…` |
| `pitch/…`, `pitch*.module.css` | `apps/web/src/app/pitch/…` |
| `components/…` | `apps/web/src/components/…` |
| `features/<name>/ui/…` | `apps/web/src/features/<name>/ui/…` |
| `projects-screen.tsx` | `apps/web/src/features/projects/ui/projects-screen.tsx` |
| `org-switcher.tsx` / `project-switcher.tsx` | `apps/web/src/features/org/ui/…` / `apps/web/src/features/projects/ui/…` |
| `apps/pitch/…` | the static pitch + docs site, which imports its body from `apps/web/src/app/pitch` |

### Rules of the repo (non-negotiable)

- One branch, one PR per finding (or one PR for a group of XS findings that
  touch the same file — R10 + R13, R11 + R12 are natural pairs).
- Stage by explicit path. Never `git add -A` or `git add <dir>/`.
- `git commit -s`, Conventional Commits (`fix(pitch): …`, `fix(a11y): …`,
  `style(css): …`).
- Do not touch the Windows registry.
- Do not add a dependency. Do not add a colour that is not a `--token`.
- Respect `prefers-reduced-motion` wherever motion is added — the codebase
  treats it as binding (`styles/motion.css`, `styles/base.css`).

### Commands

```bash
# what CI runs on every PR — all must pass before you push
npm run typecheck && npm run lint && npm run check:boundaries && npm run test:web
```

```bash
# check:boundaries includes check:docs; if it fails, regenerate and commit what it names
npm run docs:generate
```

```bash
# the pitch + docs site, to look at R1, R3, R4, R5, R11
npm run dev --workspace @weaveforge/pitch
```

```bash
# the app, to look at everything else
npm run dev --workspace @weaveforge/web
```

For the desktop-only screens use the desktop build (`apps/desktop`:
`npm run build && npm run build:web && npx electron-builder --dir`).

### Definition of done for the whole report

- R1–R9 closed (High and Medium). R10–R14 closed or explicitly declined by the
  owner in the PR that closes R9.
- Every "Verify" line in §3 done and its evidence (a screenshot, a grep result,
  a test) in the PR body.
- `npm run check:all` passes.

## How to read this

Everything below cites the file and line it was read from. Where a checklist item
turned out to **not** apply, or to already be handled, it is recorded under
[§4](#4-checked-and-refuted) rather than left out — the point of an audit is the
negative result as much as the positive one. This is a source read, not a
rendered one; §5 says exactly what that leaves unmeasured.

**The honest headline:** this is not a project that needs a redesign. The design
system is unusually complete and unusually well-reasoned — the checklist is
mostly answered *yes* already, and several answers are better than the checklist
asks for. What is left is a short list of real gaps, concentrated in two places:
the public pitch page's behaviour below 1180px, and a handful of controls that
were built for one element type and are used on another.

---

## 1. Priorities

| # | Sev | Suggestion | Where | Effort |
| --- | --- | --- | --- | --- |
| R1 | **High** | The pitch page has no navigation at all below 1180px | `pitch-header.module.css:59` | S |
| R2 | **High** | `.btn-primary` has no `display`, so its press/hover motion is inert on every `<a>` | `forms.css:272-280` | XS |
| R3 | **High** | Open Graph / Twitter metadata is absent from the public site | `apps/pitch/app/layout.tsx:17-22` | S |
| R4 | Medium | No custom 404 anywhere in the product or the site | *absent* | S |
| R5 | Medium | `height: 100vh` on the pinned paper rail (siblings use `dvh`) | `pitch-paper.module.css:210` | XS |
| R6 | Medium | No skip-to-content link; `<main>` has no `id` | `app-shell.tsx:141` | XS |
| R7 | Medium | The project picker is a clickable `<li>` with no keyboard path | `projects-screen.tsx:69-72` | S |
| R8 | Medium | `window.prompt` / `window.confirm` still used in four places | §3 R8 | S |
| R9 | Medium | Empty states are one grey sentence with no action | `entity-cards.css:1` + 15 call sites | M |
| R10 | Low | `z-index` has no scale — `10000`, `10050`, `30`, … | `git.css:82`, `forms.css:96` | XS |
| R11 | Low | Anchor jumps are instant — no `scroll-behavior: smooth` | *absent* | XS |
| R12 | Low | `text-wrap: balance/pretty` is pitch-only | `pitch*.module.css` only | XS |
| R13 | Low | Button transitions disagree (60 ms / 150 ms / 140–520 ms) | `forms.css:277` | XS |
| R14 | Low | Static inline styles in JSX where a stylesheet exists | `pitch/page.tsx:475` | XS |

Effort is XS (< 30 min), S (< 2 h), M (half a day) for one person familiar with
the file. Severity is about user-visible consequence, not code risk.

The order I would actually work in is R2 → R5 → R6 → R1 → R3 → R7 → R9 → R8 →
the rest. R2 and R5 are two-line fixes with real user-visible effect; R1 and R3
are the two that change how the product meets a stranger.

---

## 2. What is already right

Stated first, because the suggestions below only make sense against this
baseline. Each of these is a checklist item the project already answers, often
more thoroughly than the checklist asks.

**Typography.** Not Inter, not a browser default: IBM Plex Sans, Serif and Mono,
self-hosted through `next/font`, with Serif for headings and titles and Mono for
code, SHAs and metric chips — `apps/web/src/app/fonts.ts:11-30`,
`apps/web/src/app/styles/buttons.css:1-3`. Four sans weights (400/500/600/700)
and three serif (400/500/600), so the medium/semibold hierarchy the checklist
asks for is already in place. `--content-measure: 72ch`
(`styles/base.css:24`) caps long-form reading width, and a serif/sans pairing
gives the editorial projects the checklist recommends.

**Colour and surfaces.** No pure `#000000` surface: the default light theme is
`--bg: #f4f1ea` (`themes/light.css:8`); AMOLED's black is a named theme a user
opts into, not the default. One accent (`#3b5b8c`, `themes/light.css:17`),
desaturated, with a separate semantic status ramp (`--s-*`) rather than five
competing accents. Shadows are tinted to the palette, never black —
`rgba(30, 30, 40, …)` throughout `themes/common.css:72-105` — and there is a real
documented elevation ladder `--e0`–`--e4` with a rim highlight that carries the
edge once borders are removed. Fourteen themes are generated from raw tokens
plus one alias layer (`common.css:1-19`), so a new theme redefines eight values
and inherits the rest.

**Layout.** `--app-max: 1200px` (`styles/base.css:27`) caps the content column;
`100dvh` rather than `100vh` on `body` (`base.css:111-112`) with the mobile
address-bar reason written down; `scrollbar-gutter: stable` so tab switches
cannot shift the layout sideways (`base.css:99`); `overflow-x: clip` on the pitch
page *because* `hidden` would have silently broken every sticky scene
(`pitch.module.css:12-14`). CSS Grid is used for multi-column structure, and the
masonry is real flex columns with `content-visibility` rather than CSS
multi-column, with the measured reason (1500 cards, ~4.3 s blocked scroll)
recorded at `styles/entity-cards.css:5-11`.

**Motion.** Motion is opt-in behind `[data-motion="reactive"]`
(`styles/motion.css:1-18`), animates only `translate`/`rotate`/`scale`/`opacity`
and *registered* custom properties (`motion.css:39-56` — with a comment
explaining that unregistered properties cannot interpolate), upgrades to a real
`linear()` spring through `@supports` rather than a fallback that would silently
degrade (`motion.css:86-94`), and animates list entrance with a **view timeline**
(`motion.css:424-443`) so a 200-row list does not animate 190 invisible rows on
mount. `prefers-reduced-motion` is honoured three separate ways
(`base.css:187-200`, `base.css:252-257`, `motion.css:466-492`), and the OS
preference deliberately overrides the in-app toggle.

**States and accessibility.** Visible focus for every control
(`base.css:156`); `role="alert"` / `aria-live` on 23 error and status surfaces;
`aria-current` on the active nav entry; decorative art correctly `aria-hidden`
(`chrome.tsx:119,142,162`); the icon set renders `role="img"` with a `<title>`
only when it is given a label and `aria-hidden` otherwise
(`view-icons.tsx:30-33`); the compare table's `●◐○` glyphs carry screen-reader
text rather than relying on shape (`compare.tsx:69-70`); a route skeleton for
navigation (`app/route-skeleton.tsx`) and a branded loader announced with
`role="status"` (`components/weaveforge-loader.tsx:118-119`); per-segment error
boundaries for all twelve screens.

**Content.** No AI copy fingerprints: no "Elevate", "Seamless", "Unleash",
"Delve", "In the world of…". No three-equal-card feature row — the pitch uses an
alternating `Scene`/`Spread`/`Act` structure with a deliberate note on why seven
consecutive pinned scenes were cut back to five (`chrome.tsx:203-212`). Numbers
are organic and domain-true (`val_loss 0.1826`, `β=4 · lr=1e-3`, commit
`a1b2c3d4e5f6`), names are plausible and varied (`dr. m. haddad`,
`m. okonkwo`), and there is no lorem ipsum anywhere.

**Icons.** Not Lucide or Feather: a hand-rolled 218-line stroke set
(`components/view-icons.tsx`) at a consistent `strokeWidth="2"`, sized from a
single `--icon-size` token that moves with the density setting
(`base.css:19-22,38-64`), with the reason for that token written down.

**The strongest structural decision on the site.** The pitch page renders the
product's own components — `EntityCard`, `StatusPill`, `AnnotationSidebar`, the
real theme tokens, the real `applyTheme` — rather than screenshots or copies
(`pitch/page.tsx:21-32`). The marketing page therefore cannot drift from the
product, and a change to a card in the app changes it here. That is worth
protecting in any redesign: it is the reason this page will stay honest.

---

## 3. Findings

### R1 — The pitch page has no navigation below 1180px · High · S

```css
@media (max-width: 1359px) { .navLow { display: none; } }
@media (max-width: 1179px) { .nav    { display: none; } }
```

`apps/web/src/app/pitch/pitch-header.module.css:58-59`

The section nav is removed outright at 1179px with nothing put in its place — no
disclosure, no sheet, no jump control. The pitch is a long scrollytelling page:
`page.tsx:99` registers nine scrollspy sections (`overview`, `why`, `chain`,
`reading`, `experiments`, `writing`, `labs`, `selfhost`, `compare`) and the reader
scrolls past all of them. On a tablet or phone — where the two audience the page
opens with (`page.tsx:212-216`, "Labs & groups" and "Self-hosters") are most
likely to arrive from a shared link — there is no way to reach `#compare` or
`#selfhost` except by scrolling the entire page, and no indication of which
section you are in.

The section-awareness work is already done and thrown away at this breakpoint:
`navOn` is computed by `IntersectionObserver` at `page.tsx:98-115` and applied as
`aria-current` at `page.tsx:131`. A mobile control reusing `navLink()` would need
no new state.

**Suggestion.** Add one compact control in the header below 1180px — a labelled
disclosure ("Sections") opening the existing nine links as a sheet, or a
condensed sticky strip — driven by the `navOn` value that already exists, and
carrying `aria-current` the way the desktop bar does. Also consider surfacing the
scroll progress on mobile: `--pitch-progress` is already maintained
(`page.tsx:52-56`) and currently feeds only a decorative bar.

**Do.** In `pitch/page.tsx` (the header markup that renders `nav` / `navLow`,
near `navLink()` at `:131`) add a `<details class="sections">` rendered only under
the 1179px breakpoint, containing the same nine links produced by `navLink()`,
each with `aria-current` from `navOn`. Style it in `pitch-header.module.css`
as a full-width sheet under the header, closing on link click.
**Done when.** At 1024px and 390px wide the header shows a "Sections" control;
opening it lists nine links; the current section carries `aria-current="true"`;
at ≥1180px nothing has changed.
**Verify.** `npm run dev --workspace @weaveforge/pitch`, DevTools device toolbar at
1024 and 390; screenshot both open states into the PR.

### R2 — `.btn-primary` motion does not run on anchors · High · XS

```css
.btn-primary {
  justify-self: end; border: none; cursor: pointer;
  padding: 9px 16px; border-radius: 9px; font: inherit; font-weight: 600;
  color: var(--accent-fg); background: var(--accent);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: transform 0.06s ease, filter 0.15s, box-shadow 0.15s;
}
.btn-primary:hover  { filter: brightness(0.94); … }
.btn-primary:active { transform: translateY(1px); … }
```

`apps/web/src/app/styles/forms.css:272-281`

Three things are wrong here, and the first is a silent no-op.

1. **No `display` is declared.** `transform` does not apply to a non-replaced
   inline element, and `<a>` is inline by default. So
   `.btn-primary:active { transform: translateY(1px) }` — the press feedback —
   is inert on every anchor wearing this class. It is used as an anchor at
   `pitch/page.tsx:182`, `:209` and `:493` (and `:494` uses
   `.btn-secondary`, which works). `.btn-secondary` declares
   `display: inline-flex` at `buttons.css:12`, with a comment noting that links
   wear that class too; `.btn-primary` — the more prominent of the two — does
   not. The result is that the app's primary call to action is the one control
   that does not respond to a press.
2. **`justify-self: end` is a layout property baked into a component class.** It
   aligns the button inside a grid, which happens to be how the app forms use
   it — but it makes `.btn-primary` impossible to centre or place in a flex row
   without an override, and it is why the pitch header's copy at
   `pitch/page.tsx:182` needs the ancestor to be flex for the declaration to
   become inert rather than to fight it. Layout belongs at the call site.
3. **Hover darkens toward black via `filter`.** `brightness(0.94)` on
   `--accent` mixes toward black regardless of theme, and because `filter`
   applies to the element's whole rendering it also darkens `--accent-fg` text
   and the inset highlight. A `--accent-hover` token per theme would keep hover
   inside each palette, and `background` costs no extra composite pass.

**Suggestion.** Add `display: inline-flex; align-items: center; gap: 6px;` (or
lift the shared button base out of three files into one, since
`.btn-primary`, `.btn-secondary` and `.btn-ghost` currently live in two different
stylesheets with three different `display` behaviours). Move `justify-self` to
the handful of call sites that want it. Add `--accent-hover`, and let the
reactive motion layer handle lift and scale, which it already does once the
element is a flex box (`motion.css:214-253`).

**Do.** In `styles/forms.css:272` add `display: inline-flex; align-items:
center; justify-content: center; gap: 6px;` to `.btn-primary`; move
`justify-self: end` to the call sites that need it (grep `btn-primary` in
`features/**/*.tsx`, add a `.form-actions` wrapper rule or a modifier class).
Add `--accent-hover` to every file in `themes/` (18 tokens today, 19 after).
**Done when.** `<a class="btn-primary">` and `<button class="btn-primary">`
render identically and both lift on hover / press.
**Verify.** Open a screen with a primary-anchor button (Papers → Import) and a
primary-button button (any form); hover both; screenshot side by side.

### R3 — The public site has no link preview · High · S

```ts
export const metadata: Metadata = {
  title: "WeaveForge — one workspace for research",
  description:
    "Papers, notes, plan, experiments and writing in one project, so the reasoning behind your research survives the years it takes to do it.",
  icons: { icon: `${basePath}/icons/weave_forge.svg` },
};
```

`apps/pitch/app/layout.tsx:17-22`

There is no `openGraph`, no `twitter`, no `metadataBase` and no `og:image`
anywhere in either Next app (`apps/web/src/app/layout.tsx:12-18` is the same
shape). A link to the marketing site pasted into Slack, Discord, X, LinkedIn,
Mastodon or an email client renders as a bare URL with no title card, no
description and no image. For a page whose entire purpose is to be shared, that
is the largest single gap on this list — and the cheapest, because the
description, the brand mark and a themed palette already exist.

**Suggestion.** Add `metadataBase`, an `openGraph` block and a `twitter`
`summary_large_image` card to the pitch layout, and export a real 1200×630 image
(the repo already ships brand assets under `apps/web/public/icons/`, and the
pitch renders its own palette through `ThemePalette`). The docs and the app
layout can inherit or override as appropriate. Note that `metadataBase` is also
what stops Next from warning about relative OG URLs, so it is a prerequisite
rather than a nicety.

**Do.** In `apps/pitch/app/layout.tsx:17-22` set `metadataBase: new
URL("https://<site>")`, an `openGraph` block (`title`, `description`, `url`,
`siteName`, `images: [{ url: "/og.png", width: 1200, height: 630 }]`) and
`twitter: { card: "summary_large_image", … }`. Export `apps/pitch/public/og.png`
at 1200×630 from the brand mark and palette.
**Done when.** `curl -s https://<site> | grep 'og:image'` prints the tag; the
image file exists and is under 300KB.
**Verify.** Paste the URL into a Slack or iMessage draft; a card appears.
Attach the card screenshot to the PR.

### R4 — No custom 404 · Medium · S

There is no `not-found.tsx` anywhere in `apps/` (verified: a glob for
`**/not-found*` across the workspace returns nothing). A mistyped URL, an expired
share link, an old docs path or a stale bookmark therefore lands on Next's
default 404 — unstyled, off-brand, no navigation, and no way back to the app.
This is a product that ships per-segment error boundaries for every screen and a
`RouteError` component imported by twelve `error.tsx` files
(`apps/web/src/app/route-error.tsx` defines it; `app/error.tsx` and one
`error.tsx` per screen render it), so the missing piece is visibly an oversight
rather than a decision. `app/global-error.tsx` is the one boundary that renders
its own markup, since it has to survive the root layout failing.

**Suggestion.** One `app/not-found.tsx` reusing the existing `RouteError`
framing, plus a static `not-found` for the exported pitch/docs site. It should
carry the brand, a link to the app and a link to the docs — the same three
destinations the pitch footer already offers.

**Do.** Add `app/not-found.tsx` in `apps/web/src/app/` reusing the
`RouteError` layout (brand mark, one sentence, links to `/`, `/papers`, and
the docs). Add `apps/pitch/app/not-found.tsx` with the same three links for the
static site.
**Done when.** `/this-does-not-exist` in the app and on the site both render
the branded page with working links.
**Verify.** Load both URLs; screenshot each; `npm run build --workspace
@weaveforge/pitch` still exports.

### R5 — `height: 100vh` on the pinned paper rail · Medium · XS

```css
.railIn {
  position: sticky;
  top: 0;
  height: 100vh;
```

`apps/web/src/app/pitch/pitch-paper.module.css:207-210`

Its own sibling file documents exactly why this is wrong:

```
The narrative does not scroll with the document … So "the viewport" for every
pinned scene is the space *under* the header, not `100vh` — sizing anything here
in raw viewport units pushes exactly one header's worth of every scene below the
fold, which is what used to happen.
--pitch-view: calc(100dvh - var(--pitch-head));
```

`apps/web/src/app/pitch/pitch.module.css:20-32`

`pitch.module.css` derives everything from `100dvh`
(`pitch.module.css:29-32`), and `styles/base.css:111-112` sets both `100vh` and
`100dvh` on `body` for the mobile address-bar reason. This one panel was left on
the raw unit, so on iOS Safari and Android Chrome it is taller than the visible
viewport and its bottom rows (and the `padding: 12vh 0` at
`pitch-paper.module.css:218`) fall under the browser chrome.

The same class of unit appears in the reader as
`max-height: calc(100vh - 300px)` (`styles/reader.css:117,245`). Lower risk —
it is a cap inside a scroll container rather than a fixed panel — but the same
one-word fix applies.

**Suggestion.** `height: 100dvh;` with the `100vh` line retained above it as the
fallback, matching what `base.css` already does.

**Do.** `apps/web/src/app/pitch/pitch-paper.module.css:210` — keep
`height: 100vh;` and add `height: 100dvh;` on the next line.
**Done when.** The rail no longer overflows under a collapsing mobile address
bar.
**Verify.** Chrome device toolbar, iPhone preset, scroll the pitch; the rail
bottom stays on screen.

### R6 — No skip-to-content link · Medium · XS

`apps/web/src/app/app-shell.tsx:141` renders `<main className="app-shell">` with
no `id`, and the primary navigation renders *before* it — `<TabBar>` is mounted
at `app-shell.tsx:133-140`, above `<main>` at `:141`. The nav is a nine-item
sidebar on desktop (`styles/nav.css:21`, `≥900px` block) and a bottom bar on
mobile. A keyboard user therefore tabs the entire navigation on every route
before reaching content, on a product with a dozen top-level screens.

**Suggestion.** `<main id="main">` plus one skip link as the first focusable
element in the shell, hidden until focused. `base.css:156` already provides the
`:focus-visible` ring, so it will be visible the moment it is reached. This is a
strict improvement at nearly zero cost, and the shell already renders several
zero-cost gates (`ThemeColorMeta`, `ReactiveMotion`) where it would sit
naturally.

**Do.** `app-shell.tsx:141` → `<main id="main" className="app-shell">`.
Add `<a className="skip-link" href="#main">Skip to content</a>` as the first
child of the shell's root (before `<TabBar>` at `:133`). In `styles/base.css`
add `.skip-link { position: absolute; left: -999px; } .skip-link:focus {
left: 8px; top: 8px; z-index: var(--z-toast, 10100); }` — position it within
the existing token block.
**Done when.** Pressing Tab once on any app route reveals the link; Enter moves
focus into `<main>`.
**Verify.** Keyboard only, three routes; screenshot the visible link.

### R7 — The project picker is a clickable `<li>` with no keyboard path · Medium · S

```tsx
<li
  key={p.id}
  className="card project-card"
  onClick={() => setProject(p.id)}
>
```

`apps/web/src/features/projects/ui/projects-screen.tsx:68-72`

No `role`, no `tabIndex`, no `onKeyDown`. This is the first screen a signed-in
user sees when no project is selected, so it is the first thing a keyboard-only
user meets, and it cannot be operated. It is also a semantic mismatch: the
element announces itself as a list item, not as a control.

The correct pattern already exists in the same codebase and is used everywhere
else — `components/entity-card.tsx:70-87`:

```tsx
role={interactive ? "button" : undefined}
tabIndex={interactive ? 0 : undefined}
onClick={onActivate}
onKeyDown={interactive ? onKeyDown : undefined}
```

with `Enter`/`Space` handling and a `e.target !== e.currentTarget` guard so a
nested control does not trigger the parent.

**Suggestion.** Either make the row a real `<button class="card project-card">`
inside the `<li>` (the cleanest fix, and it gets `:focus-visible`, keyboard
activation and correct role for free), or adopt `EntityCard`'s
`role="button"`/`tabIndex`/`onKeyDown` trio.

**Do.** `features/projects/ui/projects-screen.tsx:69-72` — wrap the row
contents in `<button type="button" className="card project-card"
onClick={() => setProject(p.id)}>` inside the `<li>`; remove the `<li>`'s
`onClick`. Reset button chrome in `styles/entity-cards.css` if `.card` does
not already do so.
**Done when.** Tab reaches each project; Enter and Space select it; the
`:focus-visible` ring shows.
**Verify.** Keyboard walk of the projects screen; add a node test that renders
the screen and asserts one `button.project-card` per project.

### R8 — Four OS dialogs remain · Medium · S

The codebase has already made and documented the decision to stop using these —
`features/reader/ui/pdf-reader/overlays.tsx:91-96` says of its `TextBoxComposer`:

> Replaces `window.prompt`, which is an unstyled OS dialog that ignores the
> app's theme and, on a phone, covers the page being annotated.

Four call sites were not migrated:

| Call | Where |
| --- | --- |
| `window.prompt` for the note template APPEND/REPLACE choice | `features/papers/ui/paper-note.tsx:128-131` |
| `window.confirm` to revoke an API token | `features/settings/ui/api-tokens-panel.tsx:73` |
| `window.confirm` to revoke an MCP token | `features/settings/ui/ai-access-panel.tsx:256` |
| `window.confirm` to reset local app data | `app/route-error.tsx:112`, `app/global-error.tsx:73` |

In the Android TWA these render as system dialogs over the app, and the note
prompt asks the user to *type the word* `APPEND` or `REPLACE` into a single-line
OS text box — the least discoverable interaction in the product.

The last row is defensible: a confirm inside a crashed error boundary is the one
place a dependency-free OS dialog is the right tool, because the app's own
components may be exactly what failed. The first three are not.

**Suggestion.** Route the three through the existing `TextBoxComposer` pattern
(or the repo's `Modal`), and leave the error-boundary confirms alone with a
comment saying why.

**Do.** Replace `window.prompt` at `features/papers/ui/paper-note.tsx:128-131`
with a two-button `Modal` (Append / Replace). Replace `window.confirm` at
`features/settings/ui/api-tokens-panel.tsx:73` and
`features/settings/ui/ai-access-panel.tsx:256` with the same `Modal`, destructive
button coloured from `--danger` (as `styles/ai-review.css:51-52` does; there is
no `.btn-danger` class — add one in `styles/buttons.css` if a second site needs it). Leave `app/route-error.tsx:112` and
`app/global-error.tsx:73` as they are and add the one-line comment: the error
boundary cannot rely on the component tree that renders `Modal`.
**Done when.** `grep -rn "window\.prompt\|window\.confirm" apps/web/src` lists
only the two error-boundary files.
**Verify.** Run that grep; exercise all three replaced dialogs in the app.

### R9 — Empty states are one grey sentence · Medium · M

```css
.empty { text-align: center; color: var(--muted); padding: 32px; }
```

`apps/web/src/app/styles/entity-cards.css:1`

All fifteen `.empty` call sites are a single `<p>` of grey text:

- `features/papers/ui/papers-list.tsx:526-535` — "No papers yet. Use "+ Paper" to add your first one." / "No papers match the filter."
- `features/projects/ui/projects-screen.tsx:59-63`
- `features/sharing/ui/shared-with-me-screen.tsx:52`
- `features/vault/ui/vault-screen/vault-screen.tsx:473-475`
- and eleven more across logbook, experiments, report, plan, graph, sync and lists.

Two distinct states are being served by one style, and neither is composed. **A
first-run empty state is not the same screen as a filtered-to-nothing empty
state**, but papers is the only place that even distinguishes them, and it does
so with two nearly identical grey paragraphs. This is the moment a new user
decides whether the product is for them, and it currently reads as a table with
nothing in it.

**Suggestion.** Split the token into `.empty--first-run` (brand mark or a small
line illustration, a sentence about what this screen is *for*, and the primary
action repeated inline as a real button — `+ Paper`, `New project` — rather than
pointing at a toolbar control the user has to find) and `.empty--no-results` (a
short line plus a "Clear filters" action where a filter is active). The pitch
page's `PaperStack`/`Sheet` drawing (`pitch/chrome.tsx:77-125`) is already a
house illustration style that could be reused at small size.

**Do.** In `styles/entity-cards.css:1` keep `.empty` and add
`.empty--first-run` (mark, heading, one sentence, an inline primary button) and
`.empty--no-results` (one line + "Clear filters" button when a filter is set).
Then visit the 15 `className="empty"` sites (11 files — `grep -rn
'className="empty"' apps/web/src`) and pick the variant for each; the
primary action is the same action the screen's toolbar offers.
**Done when.** No screen shows a bare grey sentence with nothing to click.
**Verify.** New empty project walk-through (Papers, Notes, Lists, Plan,
Experiments, Logbook, Report) — screenshot each; grep shows zero bare
`className="empty"` without a modifier.

### R10 — `z-index` has no scale · Low · XS

`styles/git.css:82` sets `z-index: 10000` on `.modal-backdrop`;
`styles/forms.css:96` sets `10050`; `styles/nav.css:27` sets `30`;
`styles/base.css:214` sets `20` on `.sub-nav`; overlays and the reader add
others. The 10050-over-10000 pair is the only ordering decision recorded
anywhere, and it is recorded as a numeric coincidence rather than a documented
layer.

**Suggestion.** A `--z-*` ladder in `base.css` next to the existing token blocks
(`--z-sticky`, `--z-nav`, `--z-popover`, `--z-modal`, `--z-toast`) with each
level commented with what lives there. This is the cheapest possible change now
and the most expensive one to make after a sticky element has been layered above
a modal.

**Do.** In `styles/base.css`, next to the existing token blocks, add
`--z-sticky: 20; --z-nav: 30; --z-popover: 100; --z-modal: 10000;
--z-toast: 10100;` with a comment per line naming what lives there. Replace the
literals at `styles/git.css:82`, `styles/forms.css:96`, `styles/nav.css:27`,
`styles/base.css:214` and any other `z-index:` in `styles/` with the token.
**Done when.** `grep -rn "z-index: [0-9]" apps/web/src/app/styles` returns only
the token block.
**Verify.** That grep, plus open a modal over the git panel and the nav.

### R11 — Anchor jumps are instant · Low · XS

No `scroll-behavior` declaration exists anywhere under `apps/**/*.css`
(verified by grep). The pitch header is ten anchor links plus the hero's
three audience chips (`page.tsx:213-215`) and the "See how it connects" button
(`page.tsx:210`); every one is a hard cut across a page that is roughly ten
screens tall, immediately after the reader has been taught by the scrollytelling
that this page moves smoothly.

**Suggestion.** `scroll-behavior: smooth` on `html`, inside
`@media (prefers-reduced-motion: no-preference)`. Not unconditionally: this
codebase treats the motion preference as binding in three separate places, and
an unguarded smooth scroll would be the one rule that ignores it. Pair it with
`scroll-margin-top: var(--pitch-head)` on the section targets so a jump does not
land the heading under the sticky header — which is also the bug that makes this
worth doing properly rather than in one line.

**Do.** In `styles/base.css`: `@media (prefers-reduced-motion:
no-preference) { html { scroll-behavior: smooth; } }`. In
`pitch/pitch.module.css` add `scroll-margin-top: var(--pitch-head)` to the
section selector that `page.tsx:99` targets by id.
**Done when.** Clicking a header link scrolls; the heading lands below the
sticky header, not under it; with reduced motion on, jumps are instant.
**Verify.** Toggle reduced motion in DevTools Rendering panel; test both.

### R12 — `text-wrap` is pitch-only · Low · XS

`text-wrap: balance` appears at `pitch.module.css:239,411,523`,
`pitch-ground.module.css:21,48` and `pitch-acts.module.css:88` — and nowhere in
`app/styles/`. So the marketing headlines get even line breaks and the product's
do not.

**Suggestion.** Apply `text-wrap: balance` to `.screen-head h1`
(`styles/buttons.css:1`), `.entity-card-title` / `.paper-card-title` / `.card-title`
(`styles/entity-cards.css:86-96`), `.empty` copy and the loader headings; and
`text-wrap: pretty` to the long-form prose that reads against
`--content-measure: 72ch` (`styles/markdown.css`, `styles/reader.css`), which is
where orphaned last words actually show up.

**Do.** `text-wrap: balance` on `.screen-head h1` (`styles/buttons.css:1`),
`.entity-card-title`, `.paper-card-title`, `.card-title`
(`styles/entity-cards.css:86-96`), `.empty` copy and loader headings;
`text-wrap: pretty` on the prose containers in `styles/markdown.css` and
`styles/reader.css`.
**Done when.** A two-line card title has near-equal lines at 360px.
**Verify.** Papers screen at 360px, before/after screenshot of one long title.

### R13 — Transition durations disagree · Low · XS

| Control | Duration | Where |
| --- | --- | --- |
| `.btn-primary` press | `transform 0.06s` | `forms.css:277` |
| `.btn-secondary` | `0.15s` | `buttons.css:9` |
| `.btn-ghost` | `0.15s` | `buttons.css:24` |
| `.card` (entity) | `0.12s` | `entity-cards.css:64` |
| `.sub-tab` | `0.2s` | `base.css:240` |
| reactive layer | `0.14s` / `0.26s` / `0.52s` | `motion.css:59-61` |

60 ms is below the threshold at which a press reads as a press — it is a snap —
and it is half the value of the control that sits beside it in the same form.
Note that this only becomes *visible* once R2 is fixed, because today the
transform never runs on an anchor.

**Suggestion.** One `--dur-fast` / `--dur-base` pair in `base.css`, with the
reactive layer's `--rm-*` values derived from them so `--motion-scale` still
scales everything at once.

**Do.** In `styles/base.css` add `--dur-fast: 60ms; --dur-base: 150ms;`.
Replace `0.06s` at `styles/forms.css:277` and `0.15s` at `styles/buttons.css:9,24`
with the tokens; derive the `--rm-*` values in `styles/motion.css` from them.
**Done when.** `grep -rn "0\.06s\|0\.15s\|150ms\|60ms" apps/web/src/app/styles`
returns only the token lines.
**Verify.** That grep; press a primary and a secondary button — same feel.

### R14 — Static inline styles where a stylesheet exists · Low · XS

`apps/web/src/app/pitch/page.tsx:475` — `style={{ marginTop: 14 }}`. The pitch
already has eight CSS modules; a one-off margin is a class. Dynamic values are a
different matter and are correct where they appear: `Sheet`'s generated line
widths (`chrome.tsx:87,93-95`) and the project dot colour
(`projects-screen.tsx:73`) genuinely come from data.

Minor, listed only because the project's own convention (`styles/index.css:1-11`)
is explicit that styles live in the area's stylesheet.

---

**Do.** `pitch/page.tsx:475` — replace `style={{ marginTop: 14 }}` with a
class in the nearest pitch module (e.g. `.ctaGap { margin-top: 14px; }`).
**Done when.** `grep -n "style={{" apps/web/src/app/pitch/page.tsx` lists only
data-driven values.
**Verify.** That grep; the pitch page is pixel-identical at the changed spot.

## 4. Checked and refuted

Recorded so the negative results are not re-litigated.

| Checklist item | Verdict | Evidence |
| --- | --- | --- |
| "Lucide or Feather icons exclusively" | **Not applicable** — a hand-rolled 218-line stroke set, consistent `strokeWidth="2"`, one sizing token | `components/view-icons.tsx:12-37` |
| "Missing `alt` text" | **Not a defect** — the only `alt=""` is a decorative thumbnail whose wrapper is `aria-hidden`, which is the correct treatment | `components/card-thumbs.tsx:19,24` |
| "Dead links to `#`" | **None found** in any component; the pitch's `#` links all resolve to real section ids registered at `pitch/page.tsx:99` | grep across `apps/**/*.tsx` |
| "Pure `#000000` background" | **Deliberate** — AMOLED is one of fourteen named themes; the default is `#f4f1ea` | `themes/light.css:8` |
| "Mixing warm and cool greys" | **No** — one hue family per theme, shadows all `rgba(30,30,40,…)` | `themes/common.css:70-105` |
| "Perfectly even linear gradients / no texture" | **Handled** — grain layer, aurora ground, cursor glow, mask-composite paper field | `pitch/page.tsx:141-143`, `pitch-paper.module.css:223-227` |
| "`height: 100vh` for full-screen sections" | **Mostly handled** — `dvh` on `body` and derived for the whole pitch; R5 is the one outlier | `base.css:111-112`, `pitch.module.css:29` |
| "No max-width container" | **Handled** — `--app-max: 1200px` plus per-section measures | `base.css:27` |
| "No hover / active / focus states" | **Handled** — baseline hover on every interactive surface, press feedback, global `:focus-visible` | `entity-cards.css:66-72`, `base.css:84-96,156` |
| "No loading states / spinners instead of skeletons" | **Handled** — route skeleton plus a branded `role="status"` loader | `app/route-skeleton.tsx`, `components/weaveforge-loader.tsx:118` |
| "No error states / `window.alert`" | **No `window.alert` anywhere**; `role="alert"` on 23 surfaces plus per-segment error boundaries | `components/form-error.tsx:10` and 22 more |
| "No indication of current page in nav" | **Handled** — `aria-current` on the pitch nav and on the app's sub-nav tabs | `pitch/page.tsx:131`, `app/sub-nav.tsx:67` |
| "Commented-out dead code" | **None found** in the front-end sources reviewed | — |
| "Import hallucinations" | **None found**; `npm run lint` and `npm run typecheck` are clean | — |
| "Title Case On Every Header" | **No** — sentence case throughout ("Runs that know which paper they came from.") | `pitch/page.tsx:306` |
| "Fake round numbers / Lorem Ipsum" | **No** — domain-true values and real prose throughout | `pitch/story.tsx:59-63` |
| Windows `desktop.ini` files committed | **Refuted** — present on disk but untracked and ignored: `git ls-files` matches nothing and `git status --porcelain` is empty | `apps/web/public/desktop.ini`, `apps/web/src/app/pitch/desktop.ini` |
| "Modals for everything" | **Mostly no** — inline editing is the default (report section targets, note titles, list rows); `Modal` is used for create-project and share, which are genuinely modal | `report/linked-overleaf-reports.tsx:308` |
| "Dashboard always has a left sidebar" | **Acceptable** — the sidebar is collapsible and becomes a bottom bar below 900px | `app-shell.tsx:84,129-140`, `nav.css:16-40` |

---

## 5. Limits of this audit

- **Source read, not rendered.** No finding was measured in a browser: no
  device testing, no contrast measurement, no Lighthouse or axe run. R5's
  consequence under a collapsing address bar is reasoned from the sibling file's
  own documented finding, not observed. R1's severity is reasoned from the page
  length and the section count, not from analytics.
- **No user research.** "The empty state is where a new user decides" is a
  design judgement, not a measurement.
- **The desktop shell was not audited for visual design.** `apps/desktop` is an
  Electron host that loads the same web bundle, so its design surface is the web
  app's; only its native chrome was out of scope here.
- **Performance was not profiled.** The list-Virtualisation, view-timeline and
  `content-visibility` work is documented in the source with measurements taken
  by whoever wrote it; this audit read those claims and did not reproduce them.
- **Colour contrast was not computed.** The palettes are internally consistent
  and the project ships a `contrast.css` theme plus a
  `apps/web/scripts/contrast-audit.mjs` script, which is the right instrument —
  running it across all fourteen themes would be the way to close this gap
  properly.
- **R9's call-site list is from grep, not from a rendered walkthrough**; the
  count (fifteen) is the count of `<div className="empty">` occurrences.
- **Re-verified, not re-audited.** The `d2dcc35` pass confirmed every cited
  line still says what this report says it says; it did not look for new
  findings introduced between `4767270` and `d2dcc35`.
