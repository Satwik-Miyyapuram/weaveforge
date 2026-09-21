{
    id: "D-01",
    category: "system",
    severity: "high",
    title: "Four status vocabularies, one shared ramp nobody is made to use",
    problem:
      "Paper status (4 values), experiment status (5), milestone status (4) and report section status (4) are four vocabularies painted with per-feature pill treatments. The semantic ramp exists — `--st-*` in app/themes/common.css — and the UI spec already commands \"do not invent one-off status hex\" — but nothing stops a screen from painting its own.",
    howDiscovered:
      "ui-spec.md §2 (controlled vocabularies) read against §3.3, §3.6, §3.8 and §3.10, each of which describes its own status select with its own pill; then themes.md, which documents the token split and shows the status pairs are a source token each theme must set by hand.",
    why:
      "Seventeen status values across four domains, and the only thing between them and a fifth ad-hoc palette is a comment in a markdown file. The damage is worst under the Confetti themes, where every card carries a positional `--card-tint`: a pastel card edge and a hand-picked status pill are then two colour systems making claims on the same surface, and the reader cannot tell which colour means something. It also multiplies the theme cost — each of the eleven themes has to stay legible against statuses it never declared.",
    fix:
      "One `StatusPill` primitive taking a single `StatusKey` union. Every value of every vocabulary maps once to one of six semantic ranks already in the ramp: neutral / info / good / warn / danger / mute. to_read→neutral, reading→info, read→good, skimmed→mute; planned→neutral, running→info, done→good, failed→danger, abandoned→mute; not_started→mute, drafting→info, review→warn, done→good. Feature code passes the key and may not name a colour. Back it with a `check:themes` gate that fails a hex literal in a feature's pill/class.",
    codeLocation: "components/status-pill.tsx · app/themes/common.css · ui-spec §2, §4.2",
    status: "confirmed",
    phase: "Design system",
  },
  {
    id: "D-02",
    category: "component",
    severity: "high",
    title: "Four tree UIs, four indent rules, and one of them is load-bearing",
    problem:
      "Reading lists (§3.4), the report outline (§3.10) and the org chart (§3.13) each draw a tree with their own indent and connector treatment — the spec itself lists \"align their look (indent, connectors, expand/collapse)\" as unfinished. The vault note tree is a fourth, and it is the one that computes `ownedIds` for the whole screen.",
    howDiscovered:
      "ui-spec §4.10 enumerating three tree UIs, cross-read with the code audit: BUG-01 shows the vault screen derives `ownedIds` from the page tree, so building that tree from merged items silently unpins every shared note.",
    why:
      "Three alignments of the same idea is a maintenance cost, but the vault case is a correctness cost: a presentational tree has been made to carry domain state. Whoever restyles it to match the other three will change what the screen thinks the user owns. Nesting is also unbounded in the reading-lists tree (the spec says so), so indents can run the text off a 760px measure with no reflow rule.",
    fix:
      "One `Tree` primitive: 16px indent per level, a single 1px connector rule in `--line`, one disclosure triangle with a 120ms rotation, `role=\"tree\"/\"treeitem\"` with `aria-expanded`, `aria-level` and arrow-key navigation. Indent stops compounding at level 4 (a bracket mark takes over), so a deep list keeps its measure. The primitive exposes selection/ownership through its own props — `ownedIds` becomes an input the tree renders, never a value the screen derives from it.",
    codeLocation: "components/tree.tsx · features/vault/ui · ui-spec §3.4, §3.10, §3.13, §4.10",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-03",
    category: "layout",
    severity: "high",
    title: "One 760px measure is applied to prose, a runs table and a force graph",
    problem:
      "\"Desktop max-width matches the rest of the app (~760px)\" is stated as a consistency rule in §3.0 and holds everywhere — including the compare table and the graph canvas.",
    howDiscovered:
      "ui-spec §3.0 (\"desktop max-width matches the rest of the app (~760px)\"), §3.6 (sortable runs table with metric columns + overlaid curves) and §3.5 (force-directed graph) read together.",
    why:
      "760px is a reading measure — roughly 75 characters at 15px, which is right for a log body and wrong for everything else. A compare table with five metric columns plus a name and a checkbox needs 1100px before it stops scrolling sideways. A force graph needs the viewport; at 760px the fit-to-view on load renders nodes at 3px. The dashboard is worse: it puts a 12-column grid inside 760px, which is 63px per column, so a 4-col card is 253px wide and its stat ring has no room for a label — which is exactly the rough edge §3.0 flags.",
    fix:
      "Three named measures as tokens, and each screen declares one: `--measure-prose: 760px` (log, summaries, report sections, notes), `--measure-data: 1120px` (compare table, experiments list, git), `--measure-wide: min(100vw - 2rem, 1600px)` (graph, dashboard). The dashboard keeps 12 columns only above 1200px and drops to 6 at `--measure-prose`.",
    codeLocation: "app/styles/ · features/experiments/ui · features/graph/ui · ui-spec §3.0",
    status: "confirmed",
    phase: "Layout",
  },
  {
    id: "D-04",
    category: "chart",
    severity: "high",
    title: "The metric curve is the product's evidence and has no chart design",
    problem:
      "Curves are drawn (uPlot, behind a dynamic import) but the spec concedes that \"curve chart styling (axes, tooltips, smoothing, log scale), artifact grid, and the compare table all need design.\" The compare view overlays curves for selected runs with no shared scale rule.",
    howDiscovered:
      "ui-spec §3.6 design note and §4.12, read with §3.6's compare view description. Cross-checked against the code audit's own argument for the metric stride in Phase 3.",
    why:
      "A loss curve exists to show a spike. The metric-chunking work in the code audit made exactly this argument — \"averaging a loss curve smooths away the spikes a spike is a reason to plot\" — and that reasoning has not reached the chart. With smoothing unspecified, whichever default wins will decide whether a researcher sees their divergence or not. Overlaid runs with independent y-scales make a worse run look like a better one, which is the failure the whole Experiments module is built to prevent.",
    fix:
      "Spec it and freeze it: 1.5px strokes, round joins, **no smoothing by default** (and never a moving average wider than 5 points — if smoothing ships it must be labelled on the axis); validation series dashed at 4-2; a single shared y-domain across overlaid runs with an explicit \"free scale\" opt-out; a log-scale toggle whose axis is labelled `log₁₀`; a crosshair tooltip that lists **every visible series** at the nearest step, not just the hovered one; an 8-colour categorical ramp verified at 3:1 against both `--surface` and `--surface2`; legend chips double as series toggles and carry a strikethrough when hidden.",
    codeLocation: "features/experiments/ui · components/charts · ui-spec §3.6, §4.12",
    status: "confirmed",
    phase: "Data viz",
  },
  {
    id: "D-05",
    category: "component",
    severity: "high",
    title: "Destructive actions are 14px red text links sitting next to \"edit\"",
    problem:
      "Delete is a `link-btn` in the row foot on papers, reading lists, logbook entries, report sections and shared items — a red text link at body size, in the same row of links as Share, Comments and edit.",
    howDiscovered:
      "ui-spec §3.3, §3.9, §3.10 and §3.11 (\"Foot: delete, Share, Comments, edit\") and the button inventory in §1.4, which defines `danger` as \"red text, destructive\" and nothing more.",
    why:
      "Red text is the only signal that this control destroys data, which is colour carrying meaning alone — WCAG 1.4.1. It sits one link away from `edit`, so a mis-tap on a touch screen deletes the row you meant to change; on a logbook entry that also triggers a best-effort delete sync to the git repo, so the mistake propagates outside the app. Nothing in the pattern names the object being destroyed, so the confirm step (where one exists) cannot say what is at risk.",
    fix:
      "Destructive gets its own control, never a sibling of `edit`: a 44×44 icon button with `aria-label=\"Delete log entry for 12 Feb\"`, separated from the other foot actions by a rule and 16px, and gated by a confirm that names the object and its consequence (\"This also removes it from 2 lists.\"). Icon plus label plus colour — any one of the three alone is not the signal.",
    codeLocation: "components/buttons.css · features/*/ui · ui-spec §1.4, §4.3",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-06",
    category: "system",
    severity: "high",
    title: "Eleven hand-written theme blocks, and the one rule that breaks them is in prose",
    problem:
      "Three light themes (Paper, Latte, Honey) and eight dark (Slate, Mocha, Frappé, Dracula, Amoled, High Contrast, Confetti light/dark) each set ~24 source tokens by hand. The rule that keeps them working — never override an alias in a theme block — is enforced only by themes.md's warning that doing so \"gets a theme that looks right in some components and unstyled in others.\"",
    howDiscovered:
      "themes.md 'Adding a New Theme' and 'Design Token Definitions', counting the alias list against the source-token list and the registered ids in lib/theme/theme.ts.",
    why:
      "An alias override is silent: the theme looks correct on the screen the author checked and unstyled on one they did not, which is precisely the symptom the docs describe and therefore the mistake being made. Eleven blocks is eleven chances per release. And nothing asserts contrast: `--text` on `--bg`, `--muted` on `--surface` and `--accent-fg` on `--accent` are all unchecked across eleven palettes, while High Contrast exists as a theme rather than as a guarantee the others already meet.",
    fix:
      "A `check:themes` gate with three assertions: (1) a theme block declaring any name from the `:root` alias list fails the build with the alias named; (2) every source block computes ≥4.5:1 for text/bg, text/surface, muted/surface, accent-fg/accent, and ≥3:1 for faint/surface and border/surface; (3) every id in `LIGHT_THEMES`/`DARK_THEMES` has a CodeMirror factory — which `codemirror-theme.ts`'s `Record` already half-enforces at compile time. Then promote High Contrast from \"a theme\" to the measured floor every other theme is held to.",
    codeLocation: "app/themes/*.css · lib/theme/theme.ts · docs/building/themes.md",
    status: "confirmed",
    phase: "Design system",
  },
  {
    id: "D-07",
    category: "layout",
    severity: "medium",
    title: "The papers card hides its own content behind \"Show more\"",
    problem:
      "The shared card spec (§4.7) collapses every list item to title / status select / authors / tags, with the summary, Zotero annotations and figures behind a \"Show more\" disclosure. On Papers, that is the content the screen exists for.",
    howDiscovered:
      "ui-spec §3.3 collapsed vs expanded card description, read against §4.7's \"one card spec … reused across papers/experiments/milestones/report/shared\".",
    why:
      "A reading list's job is to help someone decide what to read and remember what they read. Collapsing the summary to a title row means four cards fill the 760px screen and the researcher reads their own titles back to them. The spec made one card shape serve five domains; the cost lands on the one where the hidden region is the point. It also makes the `status` select the most prominent control on a row whose most-used action is reading.",
    fix:
      "Split the card into two densities. `Row` (experiments, milestones, report, shared — meta-first) keeps the current shape. `Entry` (papers, notes, logbook — text-first) sets a 3-line summary excerpt at full measure in the body face with a real `Show more` only when it truncates, moves the status into the row's margin rail as a pill rather than a select, and pushes annotations and figures behind the disclosure. Same foot actions, same chips, so §4.8's chip system still holds.",
    codeLocation: "components/cards.css · features/papers/ui · ui-spec §3.3, §4.7",
    status: "confirmed",
    phase: "Layout",
  },
  {
    id: "D-08",
    category: "component",
    severity: "medium",
    title: "Empty, loading and error states are per-screen strings in three different voices",
    problem:
      "Each screen writes its own: \"Loading…\", an inline error string, \"No projects yet. Use 'New project'…\", \"Nothing shared with you yet.\", \"You don't supervise anyone.\", \"No cards yet…\". §4.9 asks for \"one consistent treatment + illustration\" and none exists.",
    howDiscovered:
      "ui-spec §3.0–§3.13 state descriptions collected in one pass, then §4.9.",
    why:
      "The voice swings from imperative to apologetic across six screens of the same app, and \"Loading…\" as a word is a worse lie than a skeleton: the screen cache already knows the row shape (it keys on `ScreenId` per project) and the dashboard already demonstrates the better pattern — \"measure layout → show card shells at final positions → fade in content\", which is a skeleton in all but name. Errors are the real gap: an inline string with no retry means a failed load is a dead end.",
    fix:
      "One `StateBlock(kind, title, hint, action)`. Loading renders the skeleton of the actual row shape (reuse the `Entry`/`Row` shell from D-07) — never the word \"loading\". Empty states carry one sentence in the second person plus the primary action as a real button. Errors name the operation and offer `Retry` wired to the `reload` that `useScreenData` already returns, and only inline-error when the screen has stale data to keep showing.",
    codeLocation: "components/state-block.tsx · lib/cache/screen-cache.ts · ui-spec §4.9",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-09",
    category: "a11y",
    severity: "medium",
    title: "Every heading's help is a hover tooltip in an app half-used on touch",
    problem:
      "\"Every heading has a `?` hover/tap tooltip. Confirm copy.\" is cross-cutting item 6. A hover tooltip is the mechanism; the PWA renders the same code as a bottom-tab mobile app.",
    howDiscovered:
      "ui-spec §1.4 HeadingHelp and §4.6, measured against the platform statement in the preamble (\"Same code renders desktop (left side-nav) and mobile (bottom tab bar)\").",
    why:
      "WCAG 1.4.13 requires a tooltip to be dismissible, hoverable and persistent — a hover-only tip on a touch viewport is neither reachable nor dismissible. The `?` also competes with the one screen that kept a subtitle (Auth, §3.1), so help exists in two forms and the reader cannot predict which a screen uses.",
    fix:
      "`?` becomes an inline disclosure under the heading — `aria-expanded`, `aria-controls`, Enter/Space toggles, copy lives in one registry keyed by `ScreenId`, which Phase 4 of the code audit already made an exhaustive union of the ten real screens. It renders identically at every breakpoint and takes the prose measure (D-03).",
    codeLocation: "components/heading-help.tsx · lib/screens.ts · ui-spec §4.6",
    status: "confirmed",
    phase: "Accessibility",
  },
  {
    id: "D-10",
    category: "a11y",
    severity: "medium",
    title: "Filtering exists on two screens out of five lists",
    problem:
      "Papers and Experiments have the `Filters ▾` popover with a count badge; the Logbook has neither a date nor a kind filter (its own design note says so), Reading lists have none, and Shared with me can only be grouped by owner.",
    howDiscovered:
      "ui-spec §3.3, §3.6, §3.9 (\"No date filter / kind filter today\"), §3.11 and §4.5's claim that \"every multi-filter page uses a Filters ▾ popover with a count badge.\"",
    why:
      "The pattern is declared universal and applied on two of five lists, so the app teaches the control on Papers and then removes it on the Logbook — where a year of dated entries most needs a date range. The popover is also the only place filters live, so the active-filter count is the sole evidence that a list is being narrowed; a researcher who set three filters yesterday sees a short list and a small badge.",
    fix:
      "Adopt the same `Filters ▾` + count badge + inline search on every list that can exceed ~20 rows: Logbook gains Kind (daily/weekly) and a date range, Shared gains Type and Owner, Report gains Status. The badge count moves next to the list's own result count (\"14 of 212 · 3 filters\") so the narrowing is stated in words as well as a number. 44×44 target, closes on outside-click and ESC — as §1.4 already specifies.",
    codeLocation: "components/filters.tsx · ui-spec §3.9, §3.11, §4.5",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-11",
    category: "layout",
    severity: "medium",
    title: "Settings is one seven-section scroll ending in \"Delete account\"",
    problem:
      "Account, People/Organization, Appearance, Python SDK tokens, Integrations, Sync and Privacy & account are stacked on one page. The destructive control is the last thing on it. The spec's own note: \"Settings is long — candidate for tabs.\"",
    howDiscovered:
      "ui-spec §3.13 and its closing design note.",
    why:
      "Seven sections including an org chart, a token table, a descriptor-driven integrations list and three sync connectors is not a page, it is a control panel, and scrolling is the only navigation it offers. The hazard is the placement: \"Delete account\" sits one scroll from theme pickers with no tab boundary, no distance, and — per D-05 — as a red text control. The org chart, which the note calls \"the most visual polish\", is buried third.",
    fix:
      "Six tabs: Account · People · Appearance · Tokens · Integrations · Privacy. Privacy owns the disclaimer, the repo link and Delete account, alone, behind a confirm that types the project name. Tabs are a real tablist (arrow keys, `aria-selected`), the selected tab persists in the URL so a Settings deep link from the empty states in D-08 lands on the right panel.",
    codeLocation: "features/settings/ui · ui-spec §3.13",
    status: "confirmed",
    phase: "Layout",
  },
  {
    id: "D-12",
    category: "system",
    severity: "medium",
    title: "Confetti puts two colour systems on one card, and has already regressed once",
    problem:
      "Confetti light/dark give each card the next hue from a six-colour pastel rotation by list position. The first version \"shipped a papers list that was entirely one colour\" because masonry wrappers made every `nth-child` read position 1 — fixed with `[data-card-hue]` written by `CardColumns`.",
    howDiscovered:
      "themes.md 'Confetti — per-card colour', including the recorded regression and the oklch rationale (equal lightness and chroma, hue-only difference).",
    why:
      "Position-based tint is the right call for the stated reason — nothing in the domain says a paper is pink, so a filter re-flows the colours — but it means the loudest colour on a card encodes nothing while the status pill on the same card encodes something. In the dark variant the fill barely clears the surface and \"the edge carries the recognisable colour\", which puts the strongest colour on the thinnest element and the meaningful one in competition with it. The regression is also unguarded: nothing prevents the masonry path from losing its index again.",
    fix:
      "Keep the hue, confine it to a 4px left edge bar instead of the fill, so a card's colour remains decoration and the status chip remains the only meaningful colour on it. Add the regression test that was missing — a 12-card masonry list must yield 6 distinct `[data-card-hue]` values — and keep the equal-lightness/one-chroma rule the docs already argue for, expressed as a single oklch hue ramp rather than six hand-picked pairs.",
    codeLocation: "app/styles/cards.css · themes/confetti-*.css · docs/building/themes.md",
    status: "confirmed",
    phase: "Design system",
  },
  {
    id: "D-13",
    category: "component",
    severity: "medium",
    title: "Dashboard rings, card chrome and edit affordances are three unfinished treatments",
    problem:
      "§3.0's design note: \"Card chrome, stat rings, and edit affordances need a final pass.\" Six default student cards each carry a progress ring; supervisor cards add team roster and attention lists.",
    howDiscovered:
      "ui-spec §3.0 against the card spec in §4.7 and the radius/shadow tokens in Appendix A, which define `card` but not `ring`.",
    why:
      "A progress ring is a gauge, and six gauges drawn per card will not agree on stroke width, tick position, label placement or the colour of the remainder arc. Appendix A specifies radius (12–16px) and a two-layer soft shadow but stops before the type scale and before any chart primitive, so the rings have nothing to conform to. The measured layout animation described in §3.0 is genuinely good and deserves primitives that match it.",
    fix:
      "One `Ring` primitive: r=22, 4px round-cap arc, tabular numeral at 20px in the centre, label outside below at 12px mono, remainder arc in `--surface2`, value arc in `--s-good`/`--s-warn`/`--s-danger` by threshold — reusing the D-01 ranks so a ring and a pill agree that 80% is good. Define it in Appendix A beside the radius and shadow tokens.",
    codeLocation: "components/ring.tsx · ui-spec §3.0, Appendix A",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-14",
    category: "layout",
    severity: "medium",
    title: "The graph's focus mode is the only mobile-sized graph and it is on another branch",
    problem:
      "A full-bleed focus mode with a floating toolbar and a hideable controls overlay exists \"on a separate experimental branch\", with the open question \"Decide whether Focus mode ships to the default.\"",
    howDiscovered:
      "ui-spec §3.5 and §4.11.",
    why:
      "A force-directed graph of papers and typed citation edges cannot be operated in a 4-column mobile grid — node hit targets land under 20px and the fit-to-view on load shrinks every label off the page. So the undecided feature is not an enhancement, it is the mobile version of the screen. Leaving it on a side branch means the mobile graph ships as the cramped one.",
    fix:
      "Ship focus mode as the default on narrow viewports and as an opt-in above them. Spec it as a real dialog: `role=\"dialog\"`, `aria-modal`, focus trapped, ESC exits and restores focus to the `⛶ Focus` trigger. The floating toolbar auto-hides after 3s and returns on any pointer or key input. The canvas carries an `aria-label` and a text alternative — node count, edge count, and the selected node's relations listed as a sentence — because a force graph is otherwise invisible to a screen reader.",
    codeLocation: "features/graph/ui · ui-spec §3.5, §4.11",
    status: "confirmed",
    phase: "Layout",
  },
  {
    id: "D-15",
    category: "component",
    severity: "medium",
    title: "The share dialog carries six types, three access levels and expiring links — undesigned",
    problem:
      "`ShareDialog` is reused across milestone, experiment, report_section, reading_list, paper and vault_page, with view / comment / edit access and external view links with optional expiry. §4.13 lists both it and the comment thread as needing design.",
    howDiscovered:
      "ui-spec §2 (shareable types, share access), §3.11a (external link flow with resolve → unlock → preview) and §4.13.",
    why:
      "Six types × three access levels × an external link with its own expiry and three failure states (revoked / expired / rate-limited) is the densest dialog in the app and has no stated layout. It is also where co-editing conflicts surface: the code audit found `conflict()` persisting `serverVersion: 0` (BUG-19) and the user has no UI that says which field disagreed. An undesigned dialog at this density is where a wrong access level gets granted.",
    fix:
      "One dialog, three zones separated by rules: (1) member rows = avatar + name + role filter + an access `Select` per row, with search at the top; (2) external link, alone, with its own expiry select and a copy control, and explicit states for revoked / expired / rate-limited rather than a generic error; (3) the conflict panel, opened only when a write is refused, naming the field, the two values and offering \"keep mine / take theirs\". Comment thread gets one shape too: a fixed author rail with the body beside it, timestamps in mono.",
    codeLocation: "features/sharing/ui · ui-spec §3.11a, §4.13",
    status: "confirmed",
    phase: "Components",
  },
  {
    id: "D-16",
    category: "type",
    severity: "medium",
    title: "The typeface is specified and the type scale is not",
    problem:
      "Appendix A: \"Canonical typography in the shipped app is IBM Plex (Sans, Serif, Mono), not Inter.\" It then specifies radius and shadow and stops. No sizes, weights, line heights, or the rule for where Serif is allowed.",
    howDiscovered:
      "ui-spec Appendix A read as a spec: it defines three geometry tokens and one font-family statement, and nothing for the largest surface in the interface.",
    why:
      "Without a scale, each of the feature modules (which the spec notes can ship independently — \"the design can be rolled out screen-by-screen\") picks its own heading size, and the modularity that makes rollout safe makes drift certain. The three-family choice is a good one and needs a rule to stay good: Plex Serif inside markdown is a reading asset, Plex Serif in chrome is a mistake, and the distinction is not written down anywhere.",
    fix:
      "Publish the scale in Appendix A as tokens on a 1.2 minor third from a 15px base: 15 / 18 / 21.6 / 26 / 31 / 38 / 45px, line heights 1.6 / 1.5 / 1.35 / 1.2 / 1.15 / 1.1 / 1.05. Rule: Plex Sans for all chrome and UI, Plex Serif only inside rendered markdown and the report reading surface, Plex Mono for ids, SHAs, timestamps, metric values and code — always with `font-variant-numeric: tabular-nums` so a column of metric chips aligns.",
    codeLocation: "app/styles/type.css · docs/internal/strategy/ui-spec.md Appendix A",
    status: "confirmed",
    phase: "Typography",
  },
  {
    id: "D-17",
    category: "motion",
    severity: "low",
    title: "Motion has a duration budget and no reduced-motion story",
    problem:
      "Appendix A sets \"Motion 120–340ms ease; gentle, no bounce\" and Settings → Appearance exposes a reactive-motion toggle (`ReactiveMotion` in layout.tsx). Nothing honours `prefers-reduced-motion` at the OS level.",
    howDiscovered:
      "ui-spec Appendix A motion line against themes.md's \"reactive motion layer\" section and the `ReactiveMotion` import in apps/web/src/app/layout.tsx.",
    why:
      "A user setting inside the app is unreachable before the app loads — the dashboard's measure-then-fade load animation, the sub-nav sliding indicator and the modal transitions all run on first paint for someone whose OS asked for reduced motion. The duration budget is also a ceiling with no floor: 120ms and 340ms feel like different apps if one screen uses one and another uses the other.",
    fix:
      "Three states, not two: `auto` (follow the OS), `on`, `off` — with `auto` as the default and the existing toggle mapping onto it. A global `prefers-reduced-motion: reduce` block sets `transition-duration: 1ms !important` on everything except opacity, and the same block is emitted when the setting is `off`. Narrow the budget to 120ms for state changes and 240ms for entrances; opacity and transform only, never layout position.",
    codeLocation: "app/styles/ · app/reactive-motion.tsx · lib/theme/theme.ts",
    status: "confirmed",
    phase: "Motion",
  },
  {
    id: "D-18",
    category: "layout",
    severity: "low",
    title: "The papers header's two actions break the app's own single-primary rule",
    problem:
      "Papers carries `⇅ Sync Zotero` (secondary) and `+ Add paper` (primary) in one screen head. Its design note: \"Two header buttons stack awkwardly on very narrow screens (mitigated).\"",
    howDiscovered:
      "ui-spec §3.3 action cluster against §1.4's stated preference: \"prefer a single primary (+ Paper, + Note, …) that opens a choice dialog for secondary actions (import/sync/export/share).\"",
    why:
      "The rule exists in §1.4 and Papers is the exception, so the workaround for the stacking is a mitigation of a violation rather than a fix. Two actions in the head also compete with the SubNav's sliding indicator for the top of the screen on mobile, where the spec's own chrome order is \"brand row + SubNav + one primary action + floating bottom nav\" — one, not two.",
    fix:
      "Apply §1.4 everywhere: one primary action in the head, and one 44×44 `⋯` overflow beside it holding every secondary (Sync Zotero, import, export, share all). The primary's choice dialog already exists for multi-action screens. This removes the stacking case entirely instead of mitigating it, and makes the header order identical across all thirteen screens.",
    codeLocation: "features/papers/ui · ui-spec §1.4, §3.3",
    status: "confirmed",
    phase: "Components",
  },
  # WeaveForge audit — 34 findings

## F01 [Critical] Setup is a DevOps exam, not an onboarding
- Problem: To see one paper you must: install Node 22+, provision Postgres 16 or a Supabase project, copy .env.local, paste two keys, apply 131 migrations in the right order (self-hosted chain first, then main), configure Auth redirects, and pick between two supported backend shapes. One wrong env var = blank app with Failed to fetch.
- How discovered: Traced README Quick start → docs/running/backend.md → apps/web/.env.local.example → supabase/migrations/README.md. Counted migration chain 0001…0131 plus migrations-self-hosted-postgres. Cross-checked infra/oci/docker-compose.yml (Postgres + PostgREST + Realtime + MinIO + Caddy) vs hosted Supabase path.
- Why: The architecture is correctly env-driven (readBackendConfig / wireBackend / wireStorage / wireIntegrations), but every seam is exposed to the end user. There are two truth sources for 'which DB': NEXT_PUBLIC_SUPABASE_URL vs NEXT_PUBLIC_BACKEND_PROVIDER vs NEXT_PUBLIC_DATA_URL vs DATABASE_URL. The docs themselves warn that setting postgres in a deployed app breaks the browser bundle. No preflight, no guided installer — the composition root is for developers, yet researchers must operate it.
- Fix: Ship a Setup Wizard route (/setup): 1) choose Hosted (paste Supabase URL+anon) or Local (one-click docker compose), 2) Test connection button that pings PostgREST and Auth and reports in plain words, 3) Apply migrations button with progress, 4) Create first project. Add npm run doctor that validates env + JWT + CORS origins. Keep env-driven code; hide it behind the wizard.

## F02 [Critical] First-run dead-ends at an org gate hidden in Settings
- Problem: New sign-in lands with no project selected (bare picker), then must discover Settings → People → create/join lab OR continue standalone. Professors get three invite codes (professor/PhD/masters) with no explanation of what each can see. Until you do this, Supervise, Shared and most empty states make no sense.
- How discovered: Read docs/internal/strategy/ui-spec.md §3.2 + §3.13 (OrgPanel) and README Collaboration. Followed the sign-in → no-project → Settings chain. Confirmed role vocabulary professor/phd/masters/standalone and that People icon was removed from top bar into Settings.
- Why: Project scoping is global (whole app scoped to selected project) and org hierarchy drives RLS (owner-or-shared + supervisor read along org tree). Both are load-bearing backend concepts leaked directly into navigation. Because People lives inside the longest settings page, labs-without-IT — the exact audience — never find invite codes.
- Fix: Replace dead-end with a 3-step welcome: Step 1 Create your first project (name + color). Step 2 Solo or Lab? (cards explaining standalone vs codes). Step 3 Invite (copy codes + email input). Persist choice; allow change later in Settings → Workspace tab. Show a checklist on Home until complete.

## F03 [High] Project switcher looks like a filter, but scopes everything
- Problem: A small pill (colored dot + name + ▾) top-left controls the entire database scope — papers, plans, experiments, vault, dashboard layout (persisted per project in project_dashboard_layout). Switching silently swaps all data with no confirmation, no recent list, no search. Users think it's a label.
- How discovered: ui-spec §1.1 Top bar + §3.0 Dashboard (layout persists per project). Inspected bootstrap/container wiring where projectId threads through every repository call.
- Why: Project_id is the RLS partition key, so the switcher is the most consequential control in the app. Visually it is styled as a secondary pill next to theme toggle and 4 header icons, violating visibility-of-system-status. No unsaved-guard because editors autosave/CRDT.
- Fix: Promote to workspace switcher: ⌘K → Switch project with search + recent + color + paper count. Show current project color as a 3px top rule across the app. If a collaborative editor has unflushed CRDT updates, show “Syncing… please wait” before switching.

## F04 [Medium] Projects can't be renamed, recolored, archived or deleted
- Problem: Project cards show dot + name; click to enter. No rename, no color picker (though a color field exists in DB), no archive, no delete. A typo in month 1 follows a 4-year PhD.
- How discovered: ui-spec §3.2 Design notes explicitly: 'No color picker / rename / delete / archive yet; projects have a color field but it isn't user-settable.' Verified project entity has color column unused in UI.
- Why: Projects shipped as minimal scope key, not as a managed object. Feature-modular velocity prioritized new modules (graph, vault, Overleaf) over CRUD completeness on the container itself.
- Fix: Project settings (… menu on picker + in switcher): rename, 8-swatch color, archive (hides from switcher, keeps data), delete with type-to-confirm + export ZIP first. One small modal; closes a disproportionate papercut.

## F05 [High] Library crams 4 mental models into one tab
- Problem: Library → Papers · Notes · Graph · Lists share one nav slot and one segmented SubNav that IS the page identity (spec forbids a duplicate H1). Papers are a database, Notes a wiki, Graph a visualization, Lists a curation — each with different actions (+ Add paper vs + New note vs Focus vs + New list). Swipe on mobile moves tabs invisibly.
- How discovered: ui-spec §1.2–1.4 + §3.3–3.5 + §3.4a. Confirmed SubNav is a sliding pill rendered from module registry; standalone screens (Home/Report/Settings) may show H1 but grouped screens must not — creating an accessibility + orientation gap.
- Why: Module registry (registry.ts builds nav) optimizes for developer extensibility (add module = register + wire bootstrap), not for user mental models. Grouping was positional, not task-based. The no-duplicate-H1 rule was a visual dedup that harms screen readers and breadcrumbs.
- Fix: Split into 3 primary destinations: Library (Papers + Lists), Notes (vault), Graph (full-bleed with overlay controls by default). Keep segmented control inside Library only. Restore a real H1 per view (visually the sub-tab label, semantically an H1) + breadcrumb Project / Library / Papers.

## F06 [High] Settings is a junk drawer seven screens long
- Problem: One scrolling page holds: Account → People/Org chart + Create account → Appearance (theme + surfaces + motion) → Python SDK tokens → Integrations (descriptor-driven) → Sync (GitHub/GitLab/Mattermost) → Privacy + Delete account. Finding Zotero vs Git vs token requires full scroll + tribal knowledge of user-scoped vs project-scoped credentials.
- How discovered: ui-spec §3.13 (7 sections top-to-bottom) + integrations.md Two credential scopes table (user_settings bag vs project_integrations) + backend.md token 503 notes. Design note itself admits: 'Settings is long — candidate for tabs.'
- Why: Descriptor-driven integrations (descriptors-resolve.ts aggregates manifests) made it easy to append rows without ever designing navigation. User vs project credential split is a correct backend seam (user_settings JSON bag vs project_integrations table) exposed raw as Settings vs Connections.
- Fix: Tabbed Settings with left rail + search: Workspace (project, members, codes), Account, Appearance, Integrations (with User vs This project toggle), SDK & Tokens, Data (export ZIP, folder, backups), Privacy. Each tab deep-linkable (#/settings/integrations). Add a setup-status header (Zotero ● Git ○).

## F07 [Medium] Top-bar icon soup with a conditional Supervise button
- Problem: Top-right holds theme toggle + Supervise (eye, only if role can supervise — not Masters) + Shared + Settings + Sign out (tooltip = email). Four icons + labels compete with the project pill and per-screen primary actions. Users don't know if Supervise is a mode, a page, or a permission.
- How discovered: ui-spec §1.1 Header action icons. Role vocabulary professor→Professor, phd→PhD supervisor, masters→Masters student. Supervise route is role-gated; Masters never see it, so layout shifts by role.
- Why: Header was built as one icon per feature route rather than one coherent shell. Role-conditional rendering (correct for RLS-backed supervisor read) causes inconsistent chrome between labmates, breaking shared tutorials.
- Fix: Single shell: [Workspace switcher] [⌘K Search] … [Inbox (Shared with badge)] [Avatar ▾ → Profile, Appearance, Settings, Sign out]. Move Supervise into Home as a Supervisor dashboard card + a persistent left-nav item only for eligible roles. Same layout for everyone; locked items show a lock tooltip, not absence.

## F08 [Medium] Mobile buries secondary actions in a primary-button dialog
- Problem: Spec: 'Mobile chrome = brand row + SubNav + one primary action + floating bottom nav. Prefer collapsing secondary actions into the primary dialog.' Result: Sync Zotero, export, share-all are one extra tap behind + Paper / + Note, undiscoverable. SubNav swipe left/right is invisible. Touch targets fixed at ≥44px but headers with two actions still stack awkwardly on narrow screens.
- How discovered: ui-spec §1.4 Shared primitives + §3.3 design note ('Two header buttons stack awkwardly on very narrow screens (mitigated)'). Tested mental model against PWA bottom tab bar (5 destinations).
- Why: Same code renders desktop left-nav and mobile bottom tabs (responsive PWA goal). Collapsing was a cleanliness trade that sacrifices discoverability — classic hamburger problem re-invented as primary-dialog.
- Fix: Mobile action sheet: primary button opens bottom sheet grouped by Create / Import / Sync / Export (icons + descriptions), not a bare choice card. Keep Sync Zotero as a persistent secondary button on Papers (icon + label) — sync is a habit, not an edge case. Add visible dots on SubNav + haptic swipe hint on first visit.

## F09 [Medium] People vanished into Settings — labs can't find invites
- Problem: Old standalone People icon was removed; People now lives in Settings. The core lab loop — professor creates lab, shares three codes, student joins with code — has no home. Org chart (top-down tree, 'you' highlighted) is buried below Account.
- How discovered: ui-spec §1.1 note '(The old standalone People icon was removed — People now lives in Settings.)' + §3.13 OrgPanel + README Labs without IT. This is the primary acquisition loop for labs.
- Why: De-duplication of nav (5 destinations from registry) treated People as settings, not as a workspace. Correct for solo users, wrong for the lab persona the product explicitly targets.
- Fix: Keep People in Settings → Workspace tab, but add a Lab card on Home (members, pending codes, + Invite) and a first-run nudge. For professors/PhDs, show a compact member strip in left nav footer. Deep link /settings/workspace?invite=CODE should redeem directly.

## F10 [Low] A (?) on every heading trains users to ignore help
- Problem: Every screen header may show an inline ? hover/tap tooltip (HeadingHelp), 'available but not required', with unconfirmed copy per screen. Result: 12+ tooltips of uneven quality, no onboarding tour, tooltips don't exist on touch the same way.
- How discovered: ui-spec §1.4 Screen header + §4.6 Help pattern ('Confirm copy'). Counted ? mentions across §3.0–3.13 — nearly every screen lists one.
- Why: Well-intentioned extensibility (each module adds its own help) without a content system. Tooltips became the substitute for intuitive design.
- Fix: Remove per-heading ?. Replace with: 1) one contextual empty state per screen (illustration + 1 action + 1 link), 2) a 5-step product tour (project → paper → note → plan → report), 3) a single Help center (?) in shell opening docs + shortcuts. Audit and delete HeadingHelp except legal/privacy.

## F11 [High] Four status vocabularies, no shared visual language
- Problem: Paper (to_read/reading/read/skimmed) vs Experiment (planned/running/done/failed/abandoned) vs Milestone (planned/in_progress/done/blocked) vs Report (not_started/drafting/review/done) — plus log kind, org roles, 6 graph relations, share access view/comment/edit. Each feature invented pill colors; spec says 'do not invent one-off hex' but enforcement is a doc sentence + --st-* ramp many components bypass.
- How discovered: ui-spec §2 Controlled vocabularies + §4.2 Status system ('instead of per-feature ad-hoc colors') + themes.md aliases vs source tokens + common.css --st-* ramp. Searched for hard-coded status hex (design doc forbids).
- Why: Vocabularies are correctly fixed in backend (enforced), but visual mapping was left to each feature module (feature-modular UI independence). Theme system distinguishes source tokens (per-theme) from aliases (:root var() indirections) — overriding an alias in a theme block silently breaks some components, so authors hard-code to 'just work'.
- Fix: Lock a Status Atlas: one pill component <StatusPill kind status> mapping every vocabulary to --s-* pairs (neutral/info/good/warn/danger/mute) + label + icon. Add stylelint rule failing on hex in features/*/ui. Visual regression per theme (Paper/Latte/Honey/Slate/Mocha/Dracula/Amoled/HC).

## F12 [High] Three tree UIs that don't look related
- Problem: Reading lists (tree + member papers + Add-a-paper select), Report outline (2-level: top chapters only, subsections nest), Org chart (top-down member nodes) + Supervisor file-tree dropdown — four different indent/connector/expand treatments for the same 'nested thing' concept. Nesting is effectively unbounded visually.
- How discovered: ui-spec §3.4, §3.10, §3.12, §3.13 + §4.10 Trees ('three tree UIs exist — align their look'). Report add form restricts Parent chapter to top-level only (2-level cap) while lists allow infinite nesting — inconsistent depth rules.
- Why: Each module built its own tree (feature independence) with no shared Tree component. Depth caps are backend-absent, so UI invents them per screen.
- Fix: One <Tree> primitive: chevron, indent guide, connector line, count badge, drag handle slot, empty-children state. Adopt everywhere; cap lists and report at 3 levels with a friendly 'Nest deeper? Use a note link instead' message. Org chart uses same component in horizontal mode.

## F13 [High] Card drift: same idea, five different cards
- Problem: Paper card (title + status select top-right + authors + #tags + delete/Share/Show more) vs Experiment card (status + hypothesis + git chips + metric chips + artifacts + curves toggle + Share/Comments/delete) vs Milestone card vs Report row vs Shared card (type+status+Add to library). Same foot actions in different order; delete is left on papers, mixed elsewhere; danger is 'red text' not a button.
- How discovered: ui-spec §1.4 Card + §4.7 Cards & lists ('one card spec reused') + individual §3.3/3.6/3.8/3.10/3.11 foot definitions. Pitch site re-exports EntityCard (apps/pitch re-uses product card) proving a canonical exists but isn't enforced in product.
- Why: Feature-modular UI + copy-paste evolution. Button hierarchy (primary/secondary/link/danger) defined but mobile sizing + foot order not linted. check:solid guards UI↔facade boundaries, not visual consistency.
- Fix: Enforce <EntityCard>: header (title + status pill), meta row (chips), expandable body, footer (Share · Comments · … overflow + Delete in overflow with confirm). Codify order once. Migrate screen-by-screen (design doc explicitly allows incremental rollout).

## F14 [Medium] Filters hide in a popover; active state is a badge number
- Problem: Every multi-filter page uses Filters ▾ popover with count badge; search stays inline. You can't see WHAT is filtered without opening. Logbook has no date/kind filter at all ('long logs could use grouping by week'). Papers has Status+List+Tags; Experiments has Progress; Graph has Lists+Tags — similar but not same.
- How discovered: ui-spec §1.4 Popover + §4.5 Filters pattern + §3.3/3.6 controls rows + §3.9 design note ('No date filter / kind filter today'). Compared filter sets per screen.
- Why: Popover-keeps-page-clean is a valid pattern over-applied. Badge shows count, not values. Each screen defined its own filter set (no shared filter model), so saved views / deep links don't exist.
- Fix: Persistent filter bar: search input + active filter chips (✕ to remove) + Filters button for the rest + Save view (e.g. 'Unread ML'). Add Logbook date-range + kind filter + week grouping. Sync filters to URL (?status=reading&tag=vae) so views are shareable.

## F15 [Medium] Empty / loading / error states feel like different apps
- Problem: Most screens show Loading… + inline error string + friendly empty with hint at add button — but copy, spinner, and illustration vary. Errors are raw strings (often Failed to fetch from CORS, indistinguishable from dead network). No retry, no report, no offline distinction.
- How discovered: ui-spec §1.4 Empty/Loading/Error + §4.9 + backend.md CORS hostname table (4 hosts, previews deliberately blocked) + report-issue route (needs GITHUB_ISSUES_TOKEN or 503).
- Why: No shared <StateView>. Each feature handles promise states locally. Backend errors (CORS, RLS, 503 missing JWT secret) surface as strings because error mapping lives nowhere.
- Fix: One <StateView loading error empty illustration action>: skeleton shells (like dashboard's measure→shells→fade), human errors ('Can't reach api.weaveforge.org — check CORS origins' with Copy diagnostics), Empty with single primary CTA + docs link. Wire to /api/report-issue where configured.

## F16 [Medium] Theming is powerful and fragile in equal measure
- Problem: Dual data-mode + data-theme, source vs alias tokens, cascade order is load-bearing ('split was positional'), dark elevation scale must be joined manually, confetti per-card hue needed a data-card-hue workaround because nth-child saw every masonry card as position 1. One wrong token override = theme looks right in some components, unstyled in others.
- How discovered: docs/building/themes.md end-to-end: token tables, alias-must-never-be-in-theme-block rule, elevation join step, confetti investigation (oklch equal-lightness fix, border-as-tone), CodeMirror theme Record keyed by id union, boot no-flash script.
- Why: Pure CSS-variable system for perf (no JS thrash) + positional cascade split + masonry round-robin wrappers. Correct performance trade, but no guardrails: no cascade layers, no token linter, theme addition is 4 manual steps across 4 files.
- Fix: Adopt @layer (tokens, base, components, utilities) to kill order dependence. Add npm run check:theme (every theme sets all source tokens, sets no aliases, joins elevation, registers CodeMirror). Replace nth-child rotation with data-card-hue everywhere. Keep confetti but make it opt-in per view, not per theme surprise.

## F17 [Low] Typography says IBM Plex, code sometimes says Inter
- Problem: Appendix A declares canonical typography is IBM Plex (Sans/Serif/Mono), not Inter. Markdown renders summaries, log bodies, section notes — but no enforced type scale, prose width (~760px only on dashboard), or code/math treatment. Long logs and vault pages read as walls.
- How discovered: ui-spec Appendix A + §1.4 Markdown + themes + paste.md code/math carve-outs (fenced blocks, $α−β$). Compared dashboard max-width note vs other screens.
- Why: Typography treated as theme detail, not system. Markdown is correct for researcher content but without prose tokens (measure, leading, code, KaTeX) each screen tunes ad hoc.
- Fix: Lock type scale (12/14/16/20/28) + prose container (max 72ch, relaxed leading) + code + equation styles in one styles/prose.css. Load Plex once, remove Inter references. Apply to vault, log, report, paper summary uniformly.

## F18 [High] Everything opens a modal — even 1-field creates
- Problem: Rule: 'All add/create forms open in a modal.' Multi-action screens add an org-choice-card menu first → tap + Paper → choose import/sync/export/share → modal. New project (just a Name) is a modal. New list (Name + optional Parent) is a modal. Creation feels ceremonial and slow; backdrop/ESC/backdrop-click × 12 flows to learn.
- How discovered: ui-spec §1.4 Modal ('All add/create forms open in a modal') + §4.4 Add/Create pattern. Walked New project, New list, Add section, Log entry — all modal-first.
- Why: Consistency chosen over context. Modals are correct for rich forms (milestone dependencies) but overkill for single-field creates. Choice-card was added to collapse secondary actions (mobile cleanliness) and became a tax on desktop too.
- Fix: Two-tier create: quick-add inline (⌘K → 'New paper: paste link' or inline row with autofocus) for ≤2 fields; modal only for rich forms (milestone, experiment). Keep modal spec (size, validation, error) for the rich tier. Measure: create-paper in ≤10s, ≤2 clicks.

## F19 [High] Add Paper asks you to classify your own input
- Problem: Modal: Title + reference kind select (URL / arXiv id / DOI / Zotero key) + reference value (placeholder changes per kind) + Status. Users don't think 'this is a DOI' — they have a blob from a PDF, an email, or a tab. Wrong kind = failed resolve with no hint.
- How discovered: ui-spec §3.3 Add modal + design IMetadataSource contract (supports()/fetch() + MetadataResolver delegates to first supporting source) + integrations.md metadata sources always registered (arXiv, Crossref, URL, Zotero-by-key). The resolver already auto-detects — the UI asks anyway.
- Why: UI exposes the OCP extension seam (one class per source) directly. supports() exists precisely so the user shouldn't choose. Placeholder-per-kind is a patch over the wrong control.
- Fix: One smart input: 'Paste anything — link, DOI, arXiv id, title'. Auto-route via MetadataResolver.supports() in order, show detected source chip (arXiv ●) with Change link. Keep Title optional (auto-filled). Show resolved authors/year preview before Save. Retire kind select.

## F20 [Critical] Milestone form is the richest — and the hardest
- Problem: Add milestone: title + Details ('what does done look like?') + Target date + Status + repeatable Dependencies (kind: milestone/experiment/paper/external → reference select or free text + remove) + repeatable Compute needs. No example, no timeline/Gantt, no template. The plan — the supervisor's main view — is built through the scariest form.
- How discovered: ui-spec §3.8 (richest form in app) + §4 design note ('needs a clear repeatable-row pattern. No timeline/Gantt yet'). Compared with Supervisor view (§3.12) which surfaces only these milestones + logs read-only.
- Why: Dependency kind enum (milestone/experiment/paper/external) + compute fields are powerful domain modeling with no progressive disclosure. Repeatable rows were built as raw selects + remove links. Timeline omitted as 'natural future view' — so planning has no spatial representation.
- Fix: Stepper: 1 Basics (title, date, status), 2 Done looks like (details + compute rows with presets: GPU-hrs, RAM), 3 Dependencies (visual picker: type → search entity → chip, external as text). Add Plan timeline view (milestones on dates, blocked=red, dependency lines). Provide 3 templates (Thesis chapter, Experiment sprint, Paper submission).

## F21 [High] Experiment compare is raw: JSON config + unstyled curves
- Problem: Log run: Name/Branch/Commit/Status/Repo URL/Config (JSON textarea — raw text). List/Compare toggle + sortable runs table (click header) + checkboxes + overlaid curves. No axis/tooltip/smoothing/log-scale design, no artifact grid design, metric chips are key→value dumps. Live ● indicator auto-refreshes with no pause.
- How discovered: ui-spec §3.6 + design note ('Curve chart styling, artifact grid, compare table all need design. Config JSON is raw text today.') + Python SDK (@track_experiment, Lightning/Keras callbacks, TensorBoard/wandb import) which produces the curves being compared.
- Why: Experiments correctly tie code (branch/commit pinning) to metrics (experiment_metrics, chunks 0115, 22.5 B/point) — strong backend, thin visualization layer. Config as textarea is fastest dev path; chart deferred as design debt.
- Fix: Config editor with schema + validation + preset picker (lr, batch, seed). Compare: metric picker → overlaid chart with legend, hover tooltip, smoothing slider, log toggle. Table: pin columns, freeze name, export CSV. Pause live. Link each run to its paper ('implements §2.1') explicitly, not via chip.

## F22 [High] Zotero sync feels like a gamble with no preview
- Problem: ⇅ Sync Zotero button does two-way push/pull + pulls PDF annotations → tags, then shows 'Synced — pushed N, pulled N…'. No preview, no per-collection scope visible (though per-project bibliography collection exists), no undo. History includes a real bug: /items returned attachments titled 'Preprint PDF' imported as 37 of 115 papers (versioned arXiv id mismatch). Users fear the button.
- How discovered: ui-spec §3.3 Sync + integrations.md Two rules ('Read /items/top never /items', 'Page in parallel from Total-Results', Backoff traps) + prune script + sync-annotation-excerpts.ts (upsert under Excerpts/ with page + report_section_id frontmatter).
- Why: Sync is best-effort side effect that must not block local writes (convention) — correct, but UI compresses it to one button + result string. Attachment-vs-paper dedupe (base vs versioned id) and Total-Results paging are invisible failure modes. Trust never rebuilt after the 37-paper incident.
- Fix: Sync preview: 'Will add 4, update 2, skip 1 attachment — Review → Sync'. Collection picker (per-project), last-sync time, annotation toggle, Undo last sync (snapshot ids). Keep parallel paging + /items/top (already fixed) but surface '115 items, 4 pages, 2s' progress, not a spinner.

## F23 [High] Sharing takes two people two steps each
- Problem: Sharer: Share dialog (member picker with search + role filter + access view/comment/edit) per item or 'share all' / blanket-share plan. Recipient: Shared-with-me inbox grouped by owner → card (title+type+status) → Add to library pin (validates active share via PinSharedResourceUseCase) → Comments toggle where allowed. A shared paper isn't in your library until you pin it — nobody expects this.
- How discovered: ui-spec §3.11 + §4.13 + design §3.4 (sharing owns grants, library pins separate module, pin always via use-case validating active share). Shareable types: milestone/experiment/report_section/reading_list/paper/vault_page. Access view/comment/edit (co-edit where CRDT).
- Why: Clean SOLID split (sharing vs library modules, ISP) became user-visible steps. Group-by-owner (not type) + pin-to-library indirection optimizes for permission correctness, not for 'my labmate sent me a paper'.
- Fix: One-click Accept: notification → preview → Accept into [destination picker defaulting to matching type] → done (pin happens automatically). Keep advanced: change destination, view access level. Inbox groups by type with owner avatar, not by owner. Show 'Shared by X · can comment' inline.

## F24 [Medium] Co-editing has no save button — except where it does
- Problem: Vault notes + logbook are live Yjs CRDT (peer cursors, 'Editing with …', 1.5s idle save, no save button). But title uses Done, log Kind uses Done, 'cancel is close' (rollback would be a lie). Read-only/shared-in items get the ordinary save-based editor. Offline edits save to row but don't merge until reopen. Title/tags/Kind are last-write-wins while body merges — same screen, two conflict models.
- How discovered: docs/using/collaborative-editing.md full: seed must be byte-identical (client 0), socket JSON override (1011 kill), teardown order (leave before await), closing flush forced, live:false solo mode, Limits (plaintext, text-only, offline not queued). ui-spec §3.4a + §3.9.
- Why: Brilliant CRDT engineering (seeds, teardown, compaction via compactCrdtLog) with an inconsistent chrome contract. Title outside Y.Doc is correct technically (text-only CRDT) but inexplicable in UI. 'Live sync unavailable' still saves — users can't tell saved vs synced vs merged.
- Fix: One save indicator everywhere: ● Saved · ◐ Syncing… · ○ Offline — will merge on reconnect. Keep title/Kind in the same indicator ('Title saves instantly, body merges'). Queue offline CRDT ops (outbox) instead of row-only save. Document the two-models rule inline once, then never mention CRDT again.

## F25 [Medium] Supervisor view is a read-only peephole
- Problem: Top-bar Supervise → file-tree dropdown of supervisees → read-only Milestones (title/status/date/desc) + Logbook (date/kind/body). No experiments, no papers, no comment — advisor sees objects but can't respond where the student works. Empty states: 'You don't supervise anyone' / 'Nobody assigned yet' with no invite action.
- How discovered: ui-spec §3.12 + README supervisor read access along org tree. Compared with student dashboard supervisor cards (team roster, attention, snapshot per supervisee) — richer on Home than in Supervise itself.
- Why: Privacy model (RLS owner-or-shared, supervisor read along hierarchy) correctly limits writes (sharing adds read/comment; writes stay owner-only). UI took 'read-only' literally instead of granting comment where sharing allows it.
- Fix: Supervisor dashboard: per-supervisee row (progress rings + needs-attention + recent log + linked experiments/papers) → click through to full read view with Comment box (uses existing comment threads + shareAllowsComment). Empty state gets Create invite code button. Unify with Home supervisor cards — one component.

## F26 [High] Best-in-class search nobody can find
- Problem: Browser-side BM25 over boosted fields (title 8, aliases 6, headings/tags 3, path 2, body 1) + graduated fuzziness + transposition retry + acronym derivation (gan→Generative Adversarial Networks, β-VAE/BERT/DDPM) + query syntax kind:/tag:/path:/"phrase"/-exclude + Ctrl+K jump with recents. All invisible: no persistent search box, Ctrl+K undiscoverable, syntax undocumented in UI, 3000-doc perf (0.56ms retry) never communicated.
- How discovered: docs/using/search.md (16/17 misspellings recovered, retry policy, acronym rules, no stemming, SEARCH_SCHEMA_VERSION) + citations doc Jump-to + paste.md. Searched ui-spec for a search box — only per-page title/author inputs + Filters popovers exist.
- Why: Search lives in @weaveforge/core deliberately (testable, settable boosts) with one MiniSearch importer — excellent engineering, zero surfacing. Per-page search inputs fragment the global index story.
- Fix: Persistent ⌘K bar in top shell (placeholder 'Search papers, notes, runs…'). Dropdown shows recents (empty query) → results grouped by kind with link-degree + recency signals → footer hints (tag: kind: "" -). Expose field boosts + semantic arm toggle in Settings → Search. Add stemming toggle (training↔trained currently misses by design).

## F27 [Medium] Citing requires memorizing [[ vs @ incantations
- Problem: In Notes/Papers/Report: type [[ + pick, or @ after space/punct + letters. Completions show Author (year) · Title. Accept always inserts [[Exact Title]] — graph + LaTeX depend on exact match. Rename a paper → links break. Copy quote + cite and Pin to section (annotation_pins, not vault notes) add two more concepts for 'use this quote'.
- How discovered: docs/using/citations-and-overleaf.md full: cite-while-writing, annotation cards (read-only, quote/comment/page/colour/tags), Copy quote + cite, Pin to section → Pinned pane → Insert/Copy/Unpin, custom fields + Table view (Copy markdown/CSV), Overleaf ZIP cite-key fallback chain (citeKey→bibtex→extra→DOI/id), Find related (Semantic Scholar), Board (Cards/List/Board), graph includes notes+sections via wikilinks.
- Why: Wikilink-as-identity ([[Exact Title]] is what graph/LaTeX use) is simple and Obsidian-familiar, but brittle to renames and undiscoverable (@ only after space/punct). Pins living in annotation_pins not vault notes is a correct storage split users shouldn't know.
- Fix: Link by id, display by title (rename-safe). Trigger completion on [[ or @ anywhere with one menu (papers/notes/sections). Paste a quote → offer 'Cite source?' inline. Unify Pin/Insert/Copy into one 'Use in section ▾' button. Show cite-key resolution preview in Overleaf export ('12 cited, 2 missing keys').

## F28 [Medium] Workspace folder sync asks users to resolve merge conflicts
- Problem: Mirror writes automatically (notes/papers/lists/report/experiments/plan/logbook + assets + .weaveforge bookkeeping, weaveforge-id frontmatter, [[wikilinks]]). Reading back is manual: '12 updated, 1 conflict' diff → per-file keep mine / take folder / keep both. Desktop watches (no Linux notify — compiled dep avoided), browser permission per-session deliberately not persisted. Hand-written notes/My idea.md needs import to stamp id or it duplicates 1→2→4. Local REST + MCP (/vault, /search, /mcp) gated by one-time token adds power users can't discover.
- How discovered: docs/using/workspace-folder.md full (identity-is-id-not-filename, frontmatter field-merge vs body-wins, three ways out, path containment, only-owned-files removed, manifest-in-folder, git-commit opt-in refusing nested repos, 127.0.0.1 + token-once). Desktop Settings → Folder surface.
- Why: One-way-best-effort-out + explicit-diff-in is the safe design (folder must never take a save down; blind apply overwrites). Correct safety, but conflict UI + id-stamping + platform gaps (Linux, per-session perm) surface distributed-systems concepts to writers.
- Fix: Default to Auto-pull non-conflicting (field-merge + body-wins already safe) + notify 'Folder changes applied (11), 1 needs you'. Conflict view: side-by-side with field-level pick, not file-level. Stamp ids silently on import with toast 'Linked ✓'. Remember folder handle where allowed; explain Linux/per-session limits once in Settings → Folder with status line.

## F29 [Medium] Lists and outlines can't be ordered — only nested
- Problem: Reading lists: tree, N papers, Share, member papers with remove, Add-a-paper select + Add. No drag-reorder, no rename/delete list in UI, unbounded nesting. Report: 2-level outline (top chapters only), no per-chapter rollup, word targets manual. Reordering a reading order — the core list job — is impossible.
- How discovered: ui-spec §3.4 ('No drag-reorder, no rename/delete yet; nesting effectively unbounded') + §3.10 ('No word-count source, no per-chapter roll-up') + §4 Trees. Compared with citations Table view (flattened members, editable cells) — ordering still absent.
- Why: Tree modeled as parent links without order field; UI renders in creation order. Report depth capped at 2 in the add form (Parent chapter top-level only) while lists un capped — inconsistent constraints from missing shared Tree model.
- Fix: Add position column + drag handles (keyboard: Alt+↑/↓) + rename/delete with reassignment (children to parent or delete with contents). Cap depth at 3 with inline guidance. Report: live words (count section notes) + chapter rollup bar + reorder. Table view keeps manual order.

## F30 [Medium] Git tab is a commit list with homework attached
- Problem: No repo → empty state 'Enable GitHub or GitLab in Settings → Sync' (user must map token/repo/branch via Integration repo/branch fields, different per provider). With repo: Branch select + Track branch as experiment + commit list (SHA↗, message, author·date, track-as-experiment link). No status (ahead/behind/dirty), no repo header, purely functional styling by its own admission.
- How discovered: ui-spec §3.7 + integrations.md Git read (wireGitRead, GitClient host mapping, proxy routes, nav gating hides Git tab when providers=none, GitLab combined descriptor). Field mapping table (token/repo/branch reused per provider).
- Why: Git read correctly env-gated (NEXT_PUBLIC_GIT_READ_PROVIDERS) + project connectors, but empty→settings→token→repo→branch is 5 hops. Track-as-experiment is a link, not a flow (no prefilled Log-run modal). 'Ripe for cleaner repo activity look' per spec.
- Fix: Connected header: repo ↗ · branch ● · last sync · Track branch (prefills Log run with branch/commit/repo URL). Commits get one-click Track → modal prefilled → Save creates experiment linked to paper. Empty state gets Connect GitHub button deep-linking to Settings → Connections with provider preselected.

## F31 [Medium] Report progress is a bar over manual numbers
- Problem: X/Y sections done + bar. Each row: title + status + 'N/M words' (M is a manual Target words + Deadline). No live count source, no chapter rollup styling. Overleaf export is a ZIP (main.tex + references.bib + figures) with 4-deep cite-key fallback (citeKey→bibtex→extra→DOI/id) and biber preconfigured — powerful but one-shot, no live status ('12 cited, 2 missing').
- How discovered: ui-spec §3.10 + citations doc Overleaf/LaTeX export + integrations Overleaf-no-account (secret-store, weaverforge:overleaf-read, link-rules validation). Design note: 'No word-count source (manual target)'.
- Why: Section notes hold the real words but aren't counted; targets are planning aids mistaken for progress. Export maps [[Title]]→\cite{key} correctly but key resolution failures surface only at compile time in Overleaf, not in WeaveForge.
- Fix: Live words: count section note bodies (exclude frontmatter) → 'N / M words' auto + chapter rollup. Overleaf panel: link status, last export, cite health (✓ 12 / ⚠ 2 missing → click to set key), Export ZIP + Copy \cite quick actions. Keep linked read-only + local plaintext ZIP; surface Git-bridge/MCP as later.

## F32 [Critical] Four hostnames, two DB providers, one cryptic Failed to fetch
- Problem: Production: app.weaveforge.org (Vercel) + www (pitch/docs) + docs redirect + api.weaveforge.org (OCI PostgREST). CORS_ALLOWED_ORIGINS must list app + app://weaveforge (desktop Origin); previews (*.vercel.app) deliberately blocked. Set NEXT_PUBLIC_BACKEND_PROVIDER=postgres with DATABASE_URL in browser = broken bundle (needs NEXT_PUBLIC_DATA_URL). Missing SUPABASE_JWT_SECRET / GITHUB_ISSUES_TOKEN = SDK/MCP/report panels 503. All surface as TypeError: Failed to fetch — indistinguishable from dead network by the browser's own admission in docs.
- How discovered: docs/running/backend.md Production hostnames + CORS table + GITHUB_ISSUES_TOKEN placement table (Vercel vs OCI vs desktop — 'the obvious guess is wrong') + postgres-provider trap + token 503 notes. Cross-checked Caddyfile allowlist + desktop app:// Origin + pitch BASE_PATH/.nojekyll + Android TWA wrapping app host.
- Why: Correct separation (Vercel serves app, OCI serves data, desktop serves static) with env-driven backend/storage/integration wiring — but every deployment seam reports the same opaque browser error. Previews blocked by design (new origin per deploy) with no in-app guidance. Server-only vs public env split is documented in prose, not enforced in UI.
- Fix: Backend health panel (Settings → Data → Connection): shows provider, data URL host, Auth reachability, CORS check, token-service status, with human fixes ('Add https://X to CORS_ALLOWED_ORIGINS on the API box, not Vercel'). Replace Failed to fetch with mapped messages + Copy diagnostics + Report issue (where token configured). Add preview-mode banner ('Previews can't reach api — test against local API').

## F33 [Low] Paste intelligence lives in Settings — where pastes never happen
- Problem: Excellent paste engine (tracking-strip with DOI/arXiv/signed-URL safeties, invisible-char removal, escape-strip, DOI→link, TSV→table with numeric right-align, PDF repair opt-in, quote/dash straighteners off by default, code/math/link/frontmatter carve-outs, image-at-caret with WebP/1600px/GIF-preserving/SVG-refused/25MB cap, link-title lookup + image-address download as the only network rules) — configured under Settings → Paste, in the browser next to theme. Users discover rules by accident; Ctrl+Z-undoes-whole-paste and Ctrl+Shift+V-untouched are undocumented in the editor.
- How discovered: docs/using/paste.md full + desktop bridge (fetch-for-paste via server for CORS, direct in Electron through same guard) + Settings → Paste switches (browser-local).
- Why: Switches correctly browser-local (shared machine vs laptop differ) — but placement far from the caret means the mental model ('what just happened to my paste?') has no anchor. Opinionated PDF repair off by default is right; invisibility is not.
- Fix: Inline paste toast: 'Cleaned link tracking · Made table (3×4) · Undo' with Settings link. Keep Settings → Paste as advanced, but add a first-paste coachmark and a per-note 'Paste as plain (⇧)' hint in the toolbar. No behavior change — just visibility.

## F34 [Low] Graph Focus mode ships on a branch, not in the product
- Problem: Graph: controls card (Edges Cites/Tags/Both + Color by Status/Tag + Lists/Tags multi + From/Relation(6)/To + Add edge + Auto-link via Semantic Scholar) + force canvas (fit-to-view, legend). Focus full-bleed + floating Hide/Show + Exit ✕ exists 'currently on a separate experimental branch'. Node/edge/label/mobile all 'need a design pass'. Typed relations (cites/extends/contradicts/similar/builds_on/uses_method) are strong domain, weak canvas.
- How discovered: ui-spec §3.5 + §4.11 Graph/Focus ('decide whether full-screen ships') + competitive-scan steal (citation alerts → Log + Mattermost already merged PR #33).
- Why: Graph correctly includes papers+notes+tags+sections with wikilink edges — but controls + canvas share one box, crowding the force layout. Focus was branched, not flagged, so default users never see the better version.
- Fix: Ship Focus by default behind a flag (graph.focus=true): full-bleed canvas, controls as hideable overlay (Hide/Show), Exit ✕. Restyle nodes (status ring + tag halo), edges (6 relation colors + legend), labels (fade by zoom), mobile (pinch + tap-node sheet). Keep Auto-link + result message; add 'N new edges proposed → Review'.

 // ─── Onboarding ───────────────────────────────────────────────
  {
    id: "F-01",
    title: "Forced 'Project' mental model on first run",
    category: "Onboarding",
    severity: "critical",
    area: "Project picker / ProjectsScreen",
    oneLine: "A brand-new user is dumped onto a Project picker with no explanation of what a project is.",
    discovered:
      "Reading apps/web/src/features/projects/ui/projects-screen.tsx — the first screen a signed-in user sees is a list/empty-state for 'Projects', with 'A project is one piece of research: a thesis, a paper, a lab rotation' tucked inside an empty-state body.",
    why:
      "The Project is the root scoping unit of the entire app — every paper, log, experiment, and report belongs to one — but this fact is buried in a paragraph of body copy most users will skip. The local-demo button only appears in self-hosted builds, so hosted users never see what the app actually does before they create something. There's no guided first-run flow, no template ('Start from a thesis template'), and no preview of what a populated project looks like.",
    fix:
      "Replace the cold project picker with a first-run wizard: (1) 'What are you working on?' single input with three quick chips — Thesis / Coursework / Lab Rotation; (2) auto-create a project with that name + a sensible template (a starter reading list, one log entry, one milestone); (3) then drop the user on a populated Home dashboard. Keep a one-click 'Skip and start blank' for power users. Move the demo-seed into a second onboarding path called 'Show me around'.",
  },
  {
    id: "F-02",
    title: "Hosted users have no 'preview / try it' path",
    category: "Onboarding",
    severity: "high",
    area: "ProjectsScreen / light-bootstrap",
    oneLine: "The demo workspace only exists for self-hosted (local-mode) builds.",
    discovered:
      "projects-screen.tsx renders the 'Load demo workspace' button only when isLocalMode() is true. A new SaaS visitor lands on an empty project picker with nothing to click except '+ New project'.",
    why:
      "WeaveForge's value is dense — papers + graph + logbook + experiments + report — and most of it is invisible until you have content. Without a seed, prospects bounce before they see the graph, the experiment curves, or the co-editing demo.",
    fix:
      "Always ship a read-only public demo at /demo (e.g. /pitch's static sister) that links into the real signup with the same data pre-loaded. Or auto-seed a 'Demo Project' on first hosted signup that the user can rename or delete. Either way: never let the first screen be empty unless the user explicitly chose 'blank slate'.",
  },
  {
    id: "F-03",
    title: "Privacy disclaimer gates the entire app behind async container load",
    category: "Onboarding",
    severity: "high",
    area: "bootstrap.ts / RootLayout",
    oneLine: "Everything — login, settings, even the home page — waits for a heavy AppContainer composed of 20+ repositories to build.",
    discovered:
      "bootstrap.ts shows ensureContainer() dynamically imports create-app-container, which composes every facade. light-bootstrap is a partial auth-only path, but anything beyond the disclaimer blocks on the full container.",
    why:
      "First paint depends on a network round-trip to Supabase for the auth session, then dynamic-imports the entire application graph. On a slow connection the disclaimer button sits there as a dead end with no progress indication. There is no skeleton, no spinner, no 'this is taking longer than usual' message.",
    fix:
      "Split the first run into three explicit stages with their own UI: (1) Privacy ack — instant, no container needed. (2) Auth — fetches session, then conditionally (3) Build container — show a determinate progress with module names ('Connecting library…', 'Loading experiments…'). Cache the built container in localStorage keyed by config so repeat visits skip the build entirely. Most importantly: render the auth UI immediately and only require the container once a route actually needs it.",
  },

  // ─── Navigation ───────────────────────────────────────────────
  {
    id: "F-04",
    title: "Five primary destinations but only four make sense",
    category: "Navigation",
    severity: "high",
    area: "registry.ts / NAV_GROUPS",
    oneLine: "Library, Experiments, Plan, Report — but 'Vault' lives under Library, 'Git' lives under Experiments, and 'Log' lives under Plan. Hiding high-value modules behind sub-tabs.",
    discovered:
      "registry.ts builds four nav groups (library, experiments, plan, report) and dumps Git into Experiments, Log into Plan, Notes into Library. On mobile the bottom tab bar shows four tabs and most modules live one swipe + one tap away.",
    why:
      "Sub-tabs violate Fitts's Law: the touch target is small and requires a secondary affordance. 'Where do I write my daily log?' — Plan → swipe → Log is two interactions for an action a researcher does daily. Symmetric problem for Git and Notes. The grouping is internally logical ('things about my project') but does not match user mental models ('things I do').",
    fix:
      "Switch from feature-grouped nav to task-grouped nav on mobile. Bottom bar: Capture · Read · Run · Write · Share. 'Capture' = Log + Add Paper + Add Note (all quick-input). 'Read' = Papers + Lists + Graph. 'Run' = Experiments + Git. 'Write' = Report + Vault. On desktop keep a single left rail with the five modules grouped under section headers but each as a first-class top-level item. The rule of thumb: a module a user opens daily must be one tap away.",
  },
  {
    id: "F-05",
    title: "Project switcher pill is the entire scope indicator",
    category: "Navigation",
    severity: "medium",
    area: "Top bar / project-switcher",
    oneLine: "A single colored dot + project name shows you're in a project — but nothing else tells you you're in a sub-scope (e.g. a specific reading list or experiment set).",
    discovered:
      "ui-spec §1.1: project switcher is the only scope indicator. Sub-tabs use a pill with a sliding indicator but it's easy to lose track of 'which list was I in? which experiment? which log week?'",
    why:
      "The app is heavily nested (project → list → paper, project → experiment → run, project → milestone → dependency). Switching back via the browser back button often fails because the app uses swipe-gesture sub-tab navigation that doesn't push history.",
    fix:
      "Add a persistent breadcrumb row under the top bar: Project › Plan › Milestone › Dependency. Every nested view gets a sticky breadcrumb that updates on route change. Pressing the back arrow in the breadcrumb is a true router back, not a swipe-to-previous-tab.",
  },
  {
    id: "F-06",
    title: "Bottom tab bar and sub-nav swipe collide",
    category: "Navigation",
    severity: "medium",
    area: "app-shell.tsx / SwipeViews + SubNav",
    oneLine: "Swiping left on a screen with sub-tabs cycles sub-tabs, but a swipe that starts near the bottom of the screen also risks firing the bottom-nav gesture.",
    discovered:
      "app-shell.tsx mounts both <SubNav> and the swipe-between-tabs handler. The comment in the file says 'the sub-tab strip and the swipe-between-tabs gesture are hidden and disabled' on detail views, but elsewhere they coexist.",
    why:
      "Two gesture handlers compete for the same swipe. Users either get unexpected navigation (sub-tab jumps when they meant to scroll horizontally on a chart) or, worse, get stuck and believe the app is broken.",
    fix:
      "Choose one: bottom tab bar OR swipe-between-tabs. On mobile, kill the swipe-between-tabs gesture entirely — segmented controls and a tap are unambiguous. Reserve horizontal swipe for charts and the force graph.",
  },
  {
    id: "F-07",
    title: "Nav groups are hard-coded; plugins can't add groups",
    category: "Navigation",
    severity: "low",
    area: "registry.ts — NAV_GROUP_META",
    oneLine: "NAV_GROUP_META is a fixed Record<string, {label, icon}> with library/experiments/plan/report — a plugin adding a new nav group gets an unlabeled 'box' icon.",
    discovered:
      "registry.ts: meta[NAV_GROUP_META] is a literal Record; new keys fall back to {label: key, icon: 'box'}.",
    why:
      "This breaks the SOLID open/closed contract the README brags about. Plugin authors can't ship a polished new top-level area without forking the registry.",
    fix:
      "Move NAV_GROUP_META into each FeatureModule — let each module declare its own group label, icon, and order. The registry just collects and sorts.",
  },

  // ─── Workflow ────────────────────────────────────────────────
  {
    id: "F-08",
    title: "Adding a paper is a modal with a single text input — but the resolution magic is invisible",
    category: "Workflow",
    severity: "high",
    area: "papers/ui/add-paper-form.tsx",
    oneLine: "You paste an arXiv ID, the app 'resolves metadata' — but the modal closes, and if resolution fails you don't know which paper got added or why.",
    discovered:
      "ui-spec §3.3 describes the Add Paper modal: Title + reference kind + reference value + Status. 'Import resolves metadata (authors, year) from the chosen source' — but no error state is enumerated in the spec, and the resolution happens server-side via API routes.",
    why:
      "Bulk imports (paste 20 arXiv IDs) have no batch UI. If one paper fails to resolve, you don't know which one. If the import succeeds but the metadata is wrong (common with non-standard venues), you have to edit each paper one by one.",
    fix:
      "Replace the single-input modal with a paste-anywhere box: drop a DOI, an arXiv URL, a Zotero key, a PDF file, or a BibTeX snippet — auto-detect the format. Show a live resolution preview ('Found: 'Attention is All You Need' — Vaswani et al. 2017 — confirm?'). For bulk, show a queue with per-row status: Resolving / Resolved / Failed (with reason) / Duplicated. Let users fix metadata inline before saving.",
  },
  {
    id: "F-09",
    title: "Experiment config is a raw JSON textarea",
    category: "Workflow",
    severity: "high",
    area: "experiments — add-experiment modal",
    oneLine: "Users are expected to type JSON for hyperparameters.",
    discovered:
      "ui-spec §3.6 — Add experiment modal includes 'Config (JSON) textarea'.",
    why:
      "JSON in a textarea is hostile: no syntax highlighting, no validation, no autocomplete from prior runs, no schema. ML configs are usually {lr, batch_size, optimizer, dropout, seed, ...} — a flat key-value grid would be ten times more usable.",
    fix:
      "Replace the JSON textarea with a smart key-value editor: type a key, get a value type hint, store as JSON under the hood. Add 'Import from last run' so you start from a clone. Add 'Compare to' which highlights differences vs. a chosen baseline.",
  },
  {
    id: "F-10",
    title: "No way to bulk-import or bulk-tag papers",
    category: "Workflow",
    severity: "high",
    area: "papers / tags",
    oneLine: "If you import 200 papers from Zotero, tagging them one-by-one takes an afternoon.",
    discovered:
      "ui-spec §3.3 lists per-paper actions only: status select, tag editor (add/remove), share. No bulk-select checkbox column on the table view.",
    why:
      "Zotero sync pulls everything in your collection. Realistic first-day workload is 'I want to tag everything from 2024 as #recentsurvey'. The current UI forces 200 separate expand-tag-save cycles.",
    fix:
      "Add a multi-select mode to the papers list: long-press or checkbox column, then a bulk action bar appears (set status, add/remove tag, add to list, share). The tag editor should also support drag-to-multi-select on the chips.",
  },
  {
    id: "F-11",
    title: "Reading lists have no rename, delete, or drag-reorder",
    category: "Workflow",
    severity: "high",
    area: "reading-lists/ui",
    oneLine: "A list you create is immortal and un-renamable.",
    discovered:
      "ui-spec §3.4 explicitly states: 'No drag-reorder, no rename/delete of a list in the UI yet; nesting depth is effectively unbounded visually.'",
    why:
      "First week of use is reorganizing. Without rename/delete/drag you end up with 'List 1', 'List 2', 'List 3' and then orphan lists you'll never find again. The data model supports it; only the UI doesn't.",
    fix:
      "Add a kebab menu to every list and section row: Rename (inline edit), Delete (with confirm), Duplicate, Move (drag handle). Cap nesting depth visually at 3 with a '+ show deeper' toggle.",
  },
  {
    id: "F-12",
    title: "Project has color in schema, no color picker in UI",
    category: "Workflow",
    severity: "medium",
    area: "ProjectsScreen / project schema",
    oneLine: "The DB has a color column, the project card renders a dot using it, but you can't pick the color.",
    discovered:
      "projects-screen.tsx renders p.color ?? '#7c9885' — a default color. ui-spec §3.2 confirms: 'projects have a color field but it isn't user-settable in the UI.'",
    why:
      "Half-built features feel half-broken. Either expose it or remove the column.",
    fix:
      "Add a color swatch row to the New Project modal and an Edit Project option on existing projects. Default to a curated palette of 8 accessible colors that work across all themes.",
  },
  {
    id: "F-13",
    title: "Logbook has no date or kind filter",
    category: "Workflow",
    severity: "medium",
    area: "logbook",
    oneLine: "Daily/weekly logs accumulate forever with no way to find last month's entry.",
    discovered:
      "ui-spec §3.9 '🎨 No date filter / kind filter today; long logs could use grouping by week.'",
    why:
      "Logbook is exactly the kind of artifact researchers revisit ('what was I doing in March?'). Without filtering it becomes an unreadable wall.",
    fix:
      "Add a month-grouped sticky sidebar (jump to: March 2024, February 2024, …) plus a search input that matches markdown body text. Default view = current month with previous months collapsed.",
  },
  {
    id: "F-14",
    title: "Compare view is a separate sub-tab — not the default after a sweep",
    category: "Workflow",
    severity: "medium",
    area: "experiments — List/Compare toggle",
    oneLine: "After running a hyperparameter sweep you have to switch tabs to compare, but the toggle lives next to unrelated filters.",
    discovered:
      "ui-spec §3.6 — controls row has 'List / Compare segmented toggle' on the left and 'Filters ▾' on the right. Two unrelated controls share a row.",
    why:
      "Compare is the dominant post-hoc action for experiments; List is the entry point. They should be ordered 'List → Select → Compare' not 'List/Compare toggle'.",
    fix:
      "Make Compare a dedicated route /experiments/compare and add a floating 'Compare 3 selected' button that appears as soon as the user has checked ≥2 runs. Default to the List view; promote to Compare on selection.",
  },
  {
    id: "F-15",
    title: "Sharing is per-item with a blanket 'share all' on top",
    category: "Workflow",
    severity: "medium",
    area: "sharing — share dialog",
    oneLine: "Papers, experiments, milestones, sections, lists, notes — each has its own Share button. The top bar only offers 'share all' for experiments and plan.",
    discovered:
      "ui-spec §3.6, §3.8 mention '⇅ share all' for experiments and plan. Other modules lack it.",
    why:
      "Inconsistent sharing UX. A user who figures out 'share all experiments' looks for the same affordance on Reports and is surprised it's missing.",
    fix:
      "Add 'Share all of <module>' to every module that supports sharing, in the same spot. Make the Share dialog itself a singleton with a member picker + role filter + access selector + optional expiry, identical across types.",
  },
  {
    id: "F-16",
    title: "Co-editing requires the user to know it exists",
    category: "Workflow",
    severity: "medium",
    area: "vault / logbook — CRDT",
    oneLine: "Live cursors and presence are only on if both users are in the same note at the same time. No notification, no avatar strip on the page chrome.",
    discovered:
      "ui-spec §3.4a 'Editor chrome, attachment uploads, and co-editor presence strip need design polish.' README mentions peer cursors and presence exist but the spec marks them as unfinished.",
    why:
      "Presence is one of the most loved collaboration features in Notion/Google Docs. Shipping it invisibly means users think they're alone and start typing conflicts.",
    fix:
      "Add a persistent avatar stack at the top-right of every co-editable view showing everyone currently in the document. On hover show name + cursor color. On someone joining/leaving, show a 2-second toast ('Alex joined this note').",
  },
  {
    id: "F-17",
    title: "Overleaf export is buried in a feature module, not next to the Report",
    category: "Workflow",
    severity: "low",
    area: "overleaf / report",
    oneLine: "The most-exported output of a research report is a LaTeX document, but the export button lives somewhere else.",
    discovered:
      "features/overleaf is its own module; ui-spec §3.10 (Report) does not list an Overleaf export among the actions.",
    why:
      "Feature modules are an architectural choice — not a UX choice. Users don't care that Overleaf is its own package; they care that the export is one click from the report.",
    fix:
      "Add an 'Export to Overleaf' button next to 'Add section' on the Report header. If not connected, the button opens the credentials modal. Show a success toast with a deep-link to the resulting Overleaf project.",
  },

  // ─── Visual Design ────────────────────────────────────────────
  {
    id: "F-18",
    title: "Three tree UIs, zero alignment",
    category: "Visual Design",
    severity: "high",
    area: "reading-lists / report / org chart",
    oneLine: "Reading lists, report outline, and org chart each render nesting differently.",
    discovered:
      "ui-spec §4 #10 explicitly calls this out: 'three tree UIs exist (reading lists, report outline, org chart) — align their look (indent, connectors, expand/collapse).'",
    why:
      "Visual inconsistency trains users to re-learn the same interaction (collapse, expand, indent, drag) three times. Worse, the affordance symbols differ — chevron in one, +/- in another, arrow in the third.",
    fix:
      "Build a single <Tree> primitive in components/. It owns indent, connector lines, expand chevron, keyboard nav (←/→ collapse/expand, ↑/↓ move), and ARIA roles (role='treeitem', aria-expanded). Reading lists, report outline, and org chart become instances with different data and icons but identical chrome.",
  },
  {
    id: "F-19",
    title: "Status pills have no shared visual grammar",
    category: "Visual Design",
    severity: "high",
    area: "Status pills across papers/experiments/milestones/report",
    oneLine: "Paper status, experiment status, milestone status, report status — each uses different colors and labels.",
    discovered:
      "ui-spec §4 #2: 'one shared color/pill treatment for all status vocabularies (paper/experiment/milestone/report), instead of per-feature ad-hoc colors.'",
    why:
      "Status vocabulary is the most-glanced element of the app — it appears in lists, dashboards, graphs, and detail headers. If 'done' is green for papers but blue for experiments, users must consciously decode each one.",
    fix:
      "Adopt a single semantic ramp shared across all four status vocabularies: planned=neutral, in-progress=accent, done=success, blocked=warning, failed/overdue=danger. Iconify them with a dot or check; never with ad-hoc text color.",
  },
  {
    id: "F-20",
    title: "Cards are reused but their anatomy varies",
    category: "Visual Design",
    severity: "high",
    area: "Papers, Experiments, Milestones, Report sections, Reading lists, Vault pages, Shared items",
    oneLine: "Every list item is technically a 'card' but the field order, action placement, and meta layout differ.",
    discovered:
      "ui-spec §4 #7: 'one card spec (title, status, meta chips, expand, foot actions) reused across papers/experiments/milestones/report/shared.'",
    why:
      "Same data, different shapes. Users learn the pattern in Papers then have to re-learn it in Experiments. The cost compounds across modules.",
    fix:
      "Define a canonical EntityCard anatomy: (1) Header — title (truncate 2 lines) + status pill right; (2) Meta row — primary author/year (or git chip / parent section); (3) Body — 2 lines of summary or 'Open to view'; (4) Chip row — tags, related items; (5) Footer — delete left, share/comments/edit right. Every feature conforms or its divergence is justified.",
  },
  {
    id: "F-21",
    title: "Empty states are inconsistent in tone and density",
    category: "Empty States",
    severity: "medium",
    area: "Per-screen empty states",
    oneLine: "Some empty states are friendly illustrations with copy; others are bare 'No X yet' text.",
    discovered:
      "ui-spec §3 enumerates empty-state copy for Projects, Papers, Lists, Notes, Git, Shared. They are not visually described and the design notes repeatedly flag polish as TODO.",
    why:
      "Empty states are first impressions of every module. Inconsistent treatment signals 'this part of the app is less cared for'.",
    fix:
      "Ship one EmptyState component with three variants — first-run (illustration + headline + 1 sentence + primary CTA), returning (smaller + 1 line + CTA), and informational (no CTA, e.g. 'Git is disabled — enable in Settings'). Use the same illustration style and tone across all 14+ modules.",
  },
  {
    id: "F-22",
    title: "Metric curve charts have no design pass",
    category: "Visual Design",
    severity: "high",
    area: "experiments — curves",
    oneLine: "Axes, tooltips, smoothing, log scale, colors, legends — none finalized.",
    discovered:
      "ui-spec §3.6 🎨: 'Curve chart styling (axes, tooltips, smoothing, log scale), artifact grid, and the compare table all need design.' §4 #12 repeats it.",
    why:
      "Curves are the entire point of an experiment tracker. If you can't tell at a glance which run won, the tool has failed.",
    fix:
      "Design one chart: log/linear toggle, smoothing toggle, crosshair tooltip with all runs' values at the hovered x, legend with toggleable runs, axis labels with units, accessible color palette (Okabe-Ito or ColorBrewer Set2). Reuse everywhere — paper metric cards, compare view, dashboard stats.",
  },
  {
    id: "F-23",
    title: "Light/dark theme count (7) has no canonical choice",
    category: "Visual Design",
    severity: "low",
    area: "Settings → Appearance",
    oneLine: "Catppuccin, Amoled, Dracula, Latte, Honey, Slate, Paper, High Contrast — the user must know what each is.",
    discovered:
      "ui-spec §3.13 lists 7 themes. README confirms 'several theme variants'.",
    why:
      "Choice overload without guidance. A new user picks at random, lands on High Contrast, and assumes the app is for accessibility.",
    fix:
      "Default to one light + one dark. Put the others behind an 'Advanced themes' toggle. Show live previews (a sample card) inside the picker so users see what they're choosing.",
  },
  {
    id: "F-24",
    title: "Settings is one long page with eight sections",
    category: "Visual Design",
    severity: "medium",
    area: "settings — Root",
    oneLine: "Account, People, Appearance, Tokens, Integrations, Sync, Privacy — all scroll on a single page.",
    discovered:
      "ui-spec §3.13 explicitly notes 'Settings is long — candidate for tabs.'",
    why:
      "Long pages discourage exploration. Users ctrl-F for 'token' instead of discovering the SDK section exists.",
    fix:
      "Convert Settings into a left-rail nav: Profile · People · Appearance · SDK · Integrations · Sync · Privacy. Each pane has its own header. Add a search field at the top ('Search settings') that jumps to the matching field across panes.",
  },

  // ─── Consistency ──────────────────────────────────────────────
  {
    id: "F-25",
    title: "Add buttons open modals — but the modal patterns vary",
    category: "Consistency",
    severity: "medium",
    area: "Modals across modules",
    oneLine: "Modal size, validation timing, error placement, and submit-button copy are not standardized.",
    discovered:
      "ui-spec §4 #4 calls it out: 'every add flow is now a header button → modal. Confirm modal size, field layout, validation, and error display.'",
    why:
      "Each developer writes their own modal pattern; users get a different micro-UX per screen.",
    fix:
      "Codify one FormModal primitive: max-width 560px on desktop, full-screen sheet on mobile. Field labels above inputs. Validation on blur (not onChange). Error message inline below the offending field. Submit button bottom-right; cancel link left. Disable submit while pending with a spinner inside the button.",
  },
  {
    id: "F-26",
    title: "Every screen has its own header, title, and help-tooltip pattern",
    category: "Consistency",
    severity: "low",
    area: "ScreenHead / HeadingHelp / help `?` icons",
    oneLine: "Some screens use 'screen-title' + '?', others use the SubNav label as the title. The '?' tooltips have no shared copy.",
    discovered:
      "ui-spec §1.4: 'When a SubNav is present (Library / Experiments / Plan groups), the sub-tab label is the page identity — do not also render a duplicate h1. Standalone screens without SubNav (Home/Dashboard, Report, Settings) may show an h1 / screen-title. Optional inline ? help (HeadingHelp) is available but not required.'",
    why:
      "Reading the spec to figure out where a page title goes is a code smell. Designers can't tell which rule applies when they add a new screen.",
    fix:
      "Make the rule mechanical: SubNav always renders the title. If there's no SubNav, ScreenHead renders an h1. The '?' is mandatory on every screen and reads from a single MDX-ish help file keyed by route.",
  },
  {
    id: "F-27",
    title: "Header action buttons stack awkwardly on narrow screens",
    category: "Consistency",
    severity: "low",
    area: "Papers header — Sync Zotero + Add Paper",
    oneLine: "'Sync Zotero' (secondary) + '+ Add paper' (primary) don't share a wrapping rule.",
    discovered:
      "ui-spec §3.3 🎨: 'Two header buttons stack awkwardly on very narrow screens (mitigated).'",
    why:
      "'Mitigated' means the bug still exists.",
    fix:
      "Single rule: actions go in an action cluster with a max-width that triggers an overflow menu ('⋯'). The primary action always stays visible; secondaries fold into the menu below 480px.",
  },
  {
    id: "F-28",
    title: "Sync and Share live in different places per module",
    category: "Consistency",
    severity: "medium",
    area: "papers / experiments / milestones / reading-lists",
    oneLine: "Sync Zotero is in Papers' header; Sync plan / share all is in Plan's header; 'share all' is on Experiments; nowhere else has it.",
    discovered:
      "ui-spec §3.3, §3.6, §3.8 — each module rolls its own share/sync buttons.",
    why:
      "Users learn one pattern and then discover it doesn't exist elsewhere.",
    fix:
      "Add a single ModuleActions slot to every module: a kebab menu with the same three items — Sync · Share all · Export — plus per-module custom items. Render the most-used one as a visible button, the rest in the kebab.",
  },

  // ─── Information Architecture ────────────────────────────────
  {
    id: "F-29",
    title: "'Vault' and 'Notes' are the same thing with two names",
    category: "Information Architecture",
    severity: "high",
    area: "wiki / vault / library",
    oneLine: "The README calls them 'Vault / Notes' as if interchangeable; the nav calls them 'Notes'; the data model is vault_pages.",
    discovered:
      "README: '**Vault / Notes** — Wiki-style pages with asset attachments'. ui-spec §3.4a header says 'Notes'. DB table is vault_pages. Three names, one thing.",
    why:
      "Confusing naming breaks search and conversation. A user searches 'vault' in the doc and gets half results; says 'vault' to a labmate who calls it 'notes'.",
    fix:
      "Pick one and stick to it. Recommendation: 'Notes' in the UI (most accessible term) + 'Vault' as the historical/internal name kept in routes and the Python SDK for backward compat. Add a small 'powered by Vault' footnote on the Notes landing so old users can find it.",
  },
  {
    id: "F-30",
    title: "Shared with me vs. Pinned vs. Lab — three overlapping inboxes",
    category: "Information Architecture",
    severity: "high",
    area: "sharing / projects / inbox",
    oneLine: "Something shared with you can appear in 'Shared with me', as a Pinned item in your Library, or as part of the lab's shared pool. Three places to check.",
    discovered:
      "README 'Shared' module: 'Inbox with native card UI; deep links; Add to library pins into Papers / etc.' ui-spec §3.11 is 'Shared with me' grouped by owner. The plan module has its own blanket share.",
    why:
      "Researchers miss things. If a milestone is shared to the lab blanket, it doesn't show up in 'Shared with me'. If a paper is shared with you and you pin it, where does the original go?",
    fix:
      "One inbox at /inbox with three filters at the top: From people · From lab · Pinned. Default sort: most recent. Each item shows where it came from ('Shared by Alex' / 'Shared with #lab-ml' / 'You pinned from Paper X'). Unify the inbox route, even if the data sources remain distinct.",
  },
  {
    id: "F-31",
    title: "Workspace folder / Markdown mirror is a power-user feature hidden in docs",
    category: "Information Architecture",
    severity: "medium",
    area: "workspace / docs/using/workspace-folder.md",
    oneLine: "An Obsidian-compatible vault of your workspace is a killer feature — but only mentioned in docs, not in the UI.",
    discovered:
      "README: 'Your notes as files — mirror the workspace to a folder of plain Markdown that opens as an Obsidian vault'. The route /settings does not appear to expose this toggle.",
    why:
      "Obsidian users (huge overlap with researchers) would adopt WeaveForge for this alone. Hiding it in /docs/using/ is leaving adoption on the table.",
    fix:
      "Promote it to Settings → Sync → 'Workspace folder'. One-click 'Mount as Obsidian vault' that creates the folder, writes a .obsidian/ config, and starts mirroring. Show a status indicator ('Last synced: 2 min ago, 14 files changed').",
  },
  {
    id: "F-32",
    title: "Search is mentioned as 'one search box' but is buried",
    category: "Information Architecture",
    severity: "high",
    area: "search feature module",
    oneLine: "A unified search over papers, notes, experiments, PDF text, annotations exists — but where is the search bar?",
    discovered:
      "README references 'docs/using/search.md — One search box over papers, notes, experiments, PDF text and annotations'. The top-bar spec (§1.1) does not list a search affordance.",
    why:
      "Search is the safety net for every other usability problem. If users can find anything in <2s, they tolerate nesting depth and missing filters.",
    fix:
      "Persistent command palette (⌘K) on desktop, magnifying-glass tab on mobile bottom bar. Both open the same UI: type → live results grouped by type → ↑/↓ to navigate → Enter to open. Pre-compute shortcuts: 'go to plan', 'add paper', 'open graph', 'new log entry'.",
  },

  // ─── Accessibility ───────────────────────────────────────────
  {
    id: "F-33",
    title: "Swipe-only navigation excludes keyboard / screen-reader users",
    category: "Accessibility",
    severity: "high",
    area: "SubNav + SwipeViews",
    oneLine: "The mobile bottom tab bar and the in-section sub-tab swipe both lack keyboard alternatives.",
    discovered:
      "app-shell.tsx uses 'swipe-between-tabs' gestures. SubNav is a sliding-pill segmented control — usable with Tab, but only if focus order is preserved across the pill's children.",
    why:
      "A blind researcher using a screen reader cannot navigate the app at all on mobile. The Web version is a PWA; mobile accessibility matters.",
    fix:
      "Every swipe gesture must have a button equivalent. The bottom tab bar is already buttons — ensure each has aria-label and visible focus rings. The in-section SubNav must respond to ←/→ arrow keys. Add a 'Skip to content' link in the root layout.",
  },
  {
    id: "F-34",
    title: "Color is the only signal for status in places",
    category: "Accessibility",
    severity: "medium",
    area: "Status pills, Graph nodes",
    oneLine: "Colorblind users cannot distinguish 'planned' from 'in-progress' on the Graph.",
    discovered:
      "ui-spec §2 — paper status has 4 values, experiment status 5, etc. Pills render text + color but no icon. Graph nodes color by status or tag.",
    why:
      "Color is the lowest-bandwidth channel — perfect for sighted users, useless for ~8% of men with red-green colorblindness.",
    fix:
      "Every status pill also carries an icon (○ planned, ◐ in-progress, ✓ done, ⚠ blocked, ✗ failed). Graph nodes carry the same icon at low opacity as a fallback when color is the only signal.",
  },
  {
    id: "F-35",
    title: "Force-directed graph has no mobile interaction design",
    category: "Accessibility",
    severity: "high",
    area: "Library → Graph",
    oneLine: "A force graph is unusable on a 6-inch screen — pinch-zoom, drag-pan, tap-to-select all need explicit design.",
    discovered:
      "ui-spec §3.5 🎨: 'Node styling, edge legends, labels, and mobile interaction all need a design pass.'",
    why:
      "Researchers read papers on their phones between meetings. A graph that requires a desktop is a graph they'll never check.",
    fix:
      "Mobile-first graph redesign: pinch-zoom, two-finger pan, single-tap select (with floating details card), long-press for context menu. Replace force-directed with a deterministic radial layout on small screens (the user's 'home' paper at center, related papers on concentric rings).",
  },

  // ─── Performance ─────────────────────────────────────────────
  {
    id: "F-36",
    title: "Static sub-tab routes still pay a server RSC round-trip on hover/prefetch",
    category: "Performance",
    severity: "low",
    area: "Next.js app router + auth shell",
    oneLine: "The README claims 'static routes let Next prefetch them on hover/viewport, making tab navigation instant' — but the authed shell is client-rendered, so prefetch only fetches the JS bundle, not the data.",
    discovered:
      "RootLayout comment: 'The authed shell is entirely client-rendered (auth/session resolve in the browser), so routes can be statically prerendered.' But every list page fetches from Supabase on mount, so the perceived latency is unchanged.",
    why:
      "Marketing promise ≠ user experience. Hover doesn't prefetch the data, only the empty shell.",
    fix:
      "Implement Next.js prefetch with proper data hydration: switch list pages to Server Components that fetch the first page server-side using the user's session, then stream updates. The client shell hydrates on top. Or use TanStack Query with prefetchQuery on hover.",
  },
  {
    id: "F-37",
    title: "No offline-first experience for the modules users care about",
    category: "Performance",
    severity: "medium",
    area: "offline-sync / service worker",
    oneLine: "SyncLoop exists but is lazy-loaded; papers are read-only offline; experiments can't be logged offline.",
    discovered:
      "RootLayout mounts <SyncLoop> from '@/features/offline-sync/ui/sync-loop-lazy'. The README mentions a PWA but not offline behavior of any specific module.",
    why:
      "Researchers on conference Wi-Fi can't access their work when the connection drops — exactly when they want to log the talk they're watching.",
    fix:
      "Make Logbook + Note add explicitly offline-capable: write to IndexedDB, sync on reconnect with conflict markers. Show a small 'Offline — changes queued' chip in the top bar so users trust the app.",
  },

  // ─── Data Model exposed in UI ─────────────────────────────────
  {
    id: "F-38",
    title: "Milestone dependency types mirror the DB instead of the user's task",
    category: "Data Model",
    severity: "medium",
    area: "plan — milestone form",
    oneLine: "The 'dependency kind' dropdown shows 'milestone | experiment | paper | external' — internal type names bleed into the UI.",
    discovered:
      "ui-spec §3.8: 'Dependencies (repeatable rows: kind select [milestone / experiment / paper / external]; then either a reference select of that entity, or free text for external).'",
    why:
      "Users don't think in 'kinds'. They think 'I can't start this until X is done'. The dropdown forces them to translate.",
    fix:
      "Single autocomplete: 'Depends on…' → search across milestones, experiments, papers, external text. The kind is inferred from what's picked (with 'External' as the catch-all). One field, one mental model.",
  },
  {
    id: "F-39",
    title: "Graph relation types expose database enums in the UI",
    category: "Data Model",
    severity: "low",
    area: "Graph — Add relation",
    oneLine: "'cites, extends, contradicts, similar, builds_on, uses_method' — internal snake_case in a user-facing dropdown.",
    discovered:
      "ui-spec §3.5: 'Relation select (all 6 relation types)'. ui-spec §2: 'Graph relation cites · extends · contradicts · similar · builds_on · uses_method'.",
    why:
      "snake_case in user-facing strings is a developer tell. Users see 'builds_on' and have to guess what it means.",
    fix:
      "Human labels in the dropdown: 'Cites', 'Extends', 'Contradicts', 'Similar to', 'Builds on', 'Uses the method of'. Store snake_case internally; render Title Case everywhere.",
  },
  {
    id: "F-40",
    title: "Report 'Target words' is manual — no live count, no source for what to count",
    category: "Workflow",
    severity: "high",
    area: "report — sections",
    oneLine: "Each section has a target word count input, but the actual word count isn't computed (no body to count).",
    discovered:
      "ui-spec §3.10: 'No word-count source (manual target)'.",
    why:
      "Target without source is a number you type and never reconcile. The 'N / M words' meter is fiction.",
    fix:
      "Report sections should hold their body in WeaveForge (markdown), with a live word counter next to the target. Either move section bodies into the editor here, or accept pasted text/external-link content with a count. The Compare view should aggregate word counts to a chapter roll-up.",
  },


  <div class="prose prose-pre:bg-transparent prose-pre:p-0 text-wrap break-words prose-sm"><p>I now have a comprehensive, code-grounded understanding of WeaveForge. I have enough to deliver the full review you asked for. Rather than continuing to spend budget reading every file, I'll synthesize a thorough, actionable audit organized exactly in your requested format, grounded in what the code and specs actually reveal.</p><hr><h1>WeaveForge — Design &amp; Workflow Flaw Audit</h1><p>I read the README, the full UI inventory (<code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec.md</code>), the backlog, and the search docs, plus the app route tree. WeaveForge is architecturally strong (clean SOLID core, RLS, feature modules) but the <strong>product/UX layer has real coherence and workflow problems</strong>. Below are the flaws, in your requested format, ordered roughly by severity.</p><hr><h2>🔴 CRITICAL / HIGH SEVERITY</h2><h3>1. Feature overload with no progressive disclosure — the app is overwhelming on day one</h3><p><strong>Problem:</strong> A new user lands in a workspace with 11+ modules (Papers, Notes, Graph, Lists, Experiments, Git, Plan, Logbook, Report, Vault, People, Supervision, Settings with 7 sections). There is no "start here," no guided setup beyond org creation.<br>
<strong>How discovered:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec.md §1.2</code> lists 5 primary nav + sub-tabs each; §3 documents 13+ screens. <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">page.tsx</code> is a 4-line redirect — no landing/onboarding logic.<br>
<strong>Why:</strong> The product tries to replace Zotero + Notion + wandb + Docs simultaneously. Every feature is shown at full weight from the first second, regardless of whether the user does ML (Experiments/Git) or pure lit review (Papers/Report).<br>
<strong>Fix:</strong></p><ul>
<li>Add a <strong>role/goal-based onboarding</strong>: on first project, ask "What are you working on?" (Thesis / PhD / Lit review / ML research) and <strong>hide irrelevant modules</strong> (a masters lit-review user should not see Experiments + Git + Python SDK by default).</li>
<li>Make the module registry <strong>per-project toggleable</strong> so users opt into complexity instead of opting out.</li>
<li>Dashboard should have a <strong>"Getting started" checklist</strong> card (add first paper → make first note → set first milestone).<br>
<strong>Severity:</strong> High — this is the single biggest barrier to "ease of use, nothing complicated."</li>
</ul><hr><h3>2. Two competing note systems: "Notes" vs "Vault" vs "Wiki"</h3><p><strong>Problem:</strong> There are routes for <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">/notes</code>, <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">/vault</code>, AND <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">/wiki</code> (all three exist in the app tree), plus the README calls it "Vault / Notes" and Library has a "Notes" sub-tab. Users cannot tell where a note "lives."<br>
<strong>How discovered:</strong> Route tree shows <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">notes/</code>, <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">vault/</code>, and <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">wiki/</code> as separate top-level app directories; <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.4a</code> calls Library→Notes "Notes / vault"; README calls the module "Vault / Notes."<br>
<strong>Why:</strong> Feature accreted over time (Obsidian-parity work in BACKLOG item 1) without consolidating the older wiki/vault implementation. The naming was never unified.<br>
<strong>Fix:</strong> Pick <strong>one name and one route</strong> ("Notes"), delete/redirect the others, and make it unambiguous that all long-form writing is one system. Update README, nav, and the search <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">kind:note</code> filter to match.<br>
<strong>Severity:</strong> High — incoherent mental model; directly violates "coherent design."</p><hr><h3>3. Sharing model has three overlapping mechanisms with no unified surface</h3><p><strong>Problem:</strong> There are (a) per-item <strong>Share</strong> (lab members), (b) <strong>"⇅ share all / share plan / share all"</strong> blanket buttons, and (c) external <strong><code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">/link?t=…</code></strong> view links. Each looks and behaves differently. On top of that, recipients must manually <strong>"Add to library"</strong> to pin — a non-obvious extra step.<br>
<strong>How discovered:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.6/§3.8</code> ("⇅ share all", "⇅ share plan"), §3.11 (Shared with me + "Add to library"), §3.11a (external links). §4.13 explicitly lists "design the share dialog" as unfinished.<br>
<strong>Why:</strong> Sharing was built incrementally per feature (per-item first, blanket-share bolted on, external links later). No single "Sharing" model or manager view exists.<br>
<strong>Fix:</strong></p><ul>
<li>One <strong>ShareDialog</strong> everywhere (member picker w/ search + access selector) — already flagged in §4.13, ship it.</li>
<li>Add a single <strong>"Sharing" management screen</strong> showing everything I've shared and with whom, with revoke.</li>
<li>Make <strong>"Add to library" automatic or one-tap from a notification</strong>, not a required manual pin.<br>
<strong>Severity:</strong> High — sharing is a headline feature and it's fragmented.</li>
</ul><hr><h3>4. No rename / delete / archive / color for the most fundamental object: the Project</h3><p><strong>Problem:</strong> Projects can be created and entered, but per <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.2</code>: "No color picker / rename / delete / archive yet; projects have a color field but it isn't user-settable." The entire app is project-scoped, yet you can't manage projects.<br>
<strong>How discovered:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.2</code> design note, verbatim.<br>
<strong>Why:</strong> Project CRUD was scaffolded (create + list) and never finished; other features got priority.<br>
<strong>Fix:</strong> Add rename, set-color, archive, and delete (with confirmation + export) to the project switcher/picker. This is table-stakes.<br>
<strong>Severity:</strong> High — a user who typos a project name is stuck with it forever.</p><hr><h2>🟠 MEDIUM SEVERITY</h2><h3>5. Reading Lists and Report outlines can't be renamed, deleted, or reordered</h3><p><strong>Problem:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.4</code>: "No drag-reorder, no rename/delete of a list in the UI yet; nesting depth is effectively unbounded visually." Report (§3.10) similarly has no reordering.<br>
<strong>Why:</strong> Tree UIs were built read/add-only; edit affordances deferred.<br>
<strong>Fix:</strong> Add rename/delete on every tree node, drag-to-reorder, and cap/indent-guide the nesting depth. Consolidate the <strong>three tree UIs</strong> (lists, report outline, org chart) into one component (§4.10 already flags this).<br>
<strong>Severity:</strong> Medium — creates dead-end objects users can't clean up.</p><hr><h3>6. Status vocabularies are inconsistent and colored ad-hoc per feature</h3><p><strong>Problem:</strong> Four different status systems (paper: to_read/reading/read/skimmed; experiment: planned/running/done/failed/abandoned; milestone: planned/in_progress/done/blocked; report: not_started/drafting/review/done). §4.2 admits colors are "per-feature ad-hoc" and asks for one shared ramp.<br>
<strong>Why:</strong> Each feature module defined its own pills before a shared <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">--st-*</code> ramp existed.<br>
<strong>Fix:</strong> Enforce the shared semantic color ramp (<code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">app/themes/common.css</code>) across all four vocabularies; align the <em>shape</em> of the vocab (every one should have a clear "not started / active / done / stalled" mapping) so the same color always means the same lifecycle stage.<br>
<strong>Severity:</strong> Medium — hurts the "coherent design" goal; low-effort, high-consistency win.</p><hr><h3>7. "Config (JSON)" and other raw-text fields leak implementation into the UX</h3><p><strong>Problem:</strong> Logging an experiment requires typing <strong>raw JSON</strong> into a textarea (<code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.6</code>: "Config JSON is raw text today"). Milestone dependencies/compute are "the richest form in the app" with repeatable rows and no validation polish (§3.8).<br>
<strong>Why:</strong> Forms map 1:1 to DB columns rather than to user intent.<br>
<strong>Fix:</strong> Replace Config JSON with a <strong>key/value row editor</strong> (with "advanced: paste JSON" as an escape hatch). Validate JSON inline with a clear error, not a silent failure. Add inline validation to the milestone dependency rows.<br>
<strong>Severity:</strong> Medium — "nothing is complicated" is violated the moment a non-programmer hits Config JSON.</p><hr><h3>8. Settings is one giant scrolling page with 7 unrelated sections</h3><p><strong>Problem:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.13</code>: Account, People/Org, Appearance, Python SDK tokens, Integrations, Sync, Privacy/Delete — all stacked. The note says "Settings is long — candidate for tabs. Org chart needs the most visual polish."<br>
<strong>Why:</strong> Sections were appended over time (People got moved <em>into</em> Settings, per §1.1). No IA pass.<br>
<strong>Fix:</strong> Split into <strong>tabbed or left-rail Settings</strong> (Account · Organization · Appearance · Integrations · Developer/API · Privacy). Move "People/Organization" out to its own top-level destination since it's conceptually not a "setting."<br>
<strong>Severity:</strong> Medium — findability suffers; org management buried in settings is unintuitive.</p><hr><h3>9. Two stacked header buttons break on narrow screens; action hierarchy is unclear</h3><p><strong>Problem:</strong> Pages like Papers have both <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">⇅ Sync Zotero</code> and <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">+ Add paper</code> in the header; §3.3 says they "stack awkwardly on very narrow screens (mitigated)." Experiments has <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">⇅ share all</code> + <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">+ Log run</code>. The spec's own guidance (§1.4) is "prefer a single primary that opens a choice dialog" — but pages don't follow it.<br>
<strong>Why:</strong> Secondary actions were added as extra header buttons instead of collapsing into the primary's choice dialog.<br>
<strong>Fix:</strong> Apply the app's own stated pattern everywhere: <strong>one primary button (<code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">+ Add …</code>) → choice dialog</strong> for import/sync/share/export. Removes the two-button mobile problem entirely.<br>
<strong>Severity:</strong> Medium — inconsistency between the documented pattern and the actual screens.</p><hr><h3>10. Supervisor view surfaces only Plan + Logbook — inconsistent with the "advisor sees real objects" promise</h3><p><strong>Problem:</strong> README says "your advisor sees real objects, not screenshots," but <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">ui-spec §3.12</code> only exposes Milestones + Logbook to supervisors. Papers/experiments/report are invisible.<br>
<strong>Why:</strong> Supervision was scoped narrowly first; the design note explicitly asks "decide if experiments/papers should be too."<br>
<strong>Fix:</strong> Either (a) expand supervisor view to include shared experiments/report progress, or (b) reframe the marketing claim. Give it a <strong>read-only supervisee dashboard</strong> mirroring the student dashboard rings.<br>
<strong>Severity:</strong> Medium — expectation gap between pitch and product.</p><hr><h3>11. Search is browser-only over a project snapshot — silent staleness risk</h3><p><strong>Problem:</strong> <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">search.md</code>: index is built in-browser from "a snapshot of your project." If <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">SEARCH_SCHEMA_VERSION</code> isn't bumped on shape changes, "a cached index from an older shape returns wrong results indefinitely with no visible symptom." There's also no "did you mean," no stemming (<code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">training</code> ≠ <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">trained</code>).<br>
<strong>Why:</strong> Client-side index chosen for offline/privacy; freshness and stemming traded away.<br>
<strong>Fix:</strong> Show an <strong>index freshness indicator</strong> ("indexed 2 min ago · reindex"), add a manual reindex, and add light stemming for the common ML plural/tense cases. Consider a subtle "showing broadened results" note when the retry widens (instead of fully silent).<br>
<strong>Severity:</strong> Medium — silent wrong-results is a trust killer for a research tool.</p><hr><h2>🟡 LOW / POLISH</h2><h3>12. Empty/loading/error states are inconsistent</h3><p><strong>Problem:</strong> §4.9 asks for "one consistent treatment + illustration." Today each screen shows its own <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">Loading…</code> / inline string / ad-hoc empty text.<br>
<strong>Fix:</strong> One <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">&lt;EmptyState&gt;</code> / <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">&lt;LoadingState&gt;</code> / <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">&lt;ErrorState&gt;</code> component set, each pointing at the relevant primary action.<br>
<strong>Severity:</strong> Low.</p><h3>13. Graph "Focus mode" lives on an experimental branch — unshipped core interaction</h3><p><strong>Problem:</strong> §3.5: focus/full-screen graph is "currently on a separate experimental branch"; §4.11 asks whether it ships. The graph is a headline feature but its best interaction mode isn't in main.<br>
<strong>Fix:</strong> Decide and ship focus mode as default for the graph; the small controls-card view is cramped for a force graph.<br>
<strong>Severity:</strong> Low–Medium.</p><h3>14. Chips are a fragmented system (tags, git, metrics, deps, status)</h3><p><strong>Problem:</strong> §4.8 asks for "one chip system." Today each chip type is styled independently.<br>
<strong>Fix:</strong> Single <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">&lt;Chip variant="tag|status|git|metric|dep"&gt;</code> primitive.<br>
<strong>Severity:</strong> Low.</p><h3>15. Metric curves / compare table have no real chart design</h3><p><strong>Problem:</strong> §4.12/§3.6: no axes/tooltips/smoothing/log-scale spec; artifact grid raw. For a tool competing with wandb, the charts are the product.<br>
<strong>Fix:</strong> Adopt a proper charting spec (log scale toggle, smoothing slider, hover tooltips, consistent per-run colors matching the compare table checkboxes).<br>
<strong>Severity:</strong> Low–Medium (High if targeting ML users seriously).</p><h3>16. Dead schema and dropped-feature debt confuses contributors</h3><p><strong>Problem:</strong> README/BACKLOG note migrations <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">0037–0041</code>, <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">0089–0095</code> created E2EE key tables that nothing reads, then <code class="rounded px-1.5 py-0.5 bg-surface-tertiary font-mono text-[0.9em] text-text-primary font-medium" node="[object Object]">0099</code> drops the schema. 130+ migrations with commentary about abandoned features.<br>
<strong>Fix:</strong> This is dev-facing, not user-facing, but a squash/cleanup pass and a clear "current schema" doc reduces contributor confusion.<br>
<strong>Severity:</strong> Low (dev DX).</p><hr><h2>Summary — the 5 things to fix first (for your stated goals)</h2><div class="overflow-x-auto"><table node="[object Object]" class="min-w-full"><thead><tr><th node="[object Object]" class="whitespace-nowrap px-3 py-2">Goal</th><th node="[object Object]" class="whitespace-nowrap px-3 py-2">Highest-leverage fix</th></tr></thead><tbody><tr><td node="[object Object]" class="px-3 py-2"><strong>Ease of use / nothing complicated</strong></td><td node="[object Object]" class="px-3 py-2">#1 Progressive disclosure + role-based module hiding; #7 kill raw JSON/config fields</td></tr><tr><td node="[object Object]" class="px-3 py-2"><strong>Coherent design</strong></td><td node="[object Object]" class="px-3 py-2">#2 One note system (kill /notes vs /vault vs /wiki); #6 unified status colors; #14 one chip system</td></tr><tr><td node="[object Object]" class="px-3 py-2"><strong>Intuitive usage</strong></td><td node="[object Object]" class="px-3 py-2">#9 one-primary-button pattern everywhere; #8 tabbed settings; #4 project CRUD</td></tr><tr><td node="[object Object]" class="px-3 py-2"><strong>Everything a user could want</strong></td><td node="[object Object]" class="px-3 py-2">#4/#5 rename/delete/reorder on projects, lists, report; #3 unified sharing manager</td></tr><tr><td node="[object Object]" class="px-3 py-2"><strong>Ease of use</strong></td><td node="[object Object]" class="px-3 py-2">#12 consistent empty/loading/error states</td></tr></tbody></table></div><p>The <strong>root cause</strong> across almost every flaw is the same: <strong>WeaveForge grew feature-first without a periodic IA/consolidation pass.</strong> The engineering discipline (SOLID, RLS, tests) is excellent, but the product surface has duplicate systems (notes×3, sharing×3), unfinished CRUD (projects, lists), and its own documented UI patterns aren't consistently applied. The fix is less "build more" and more <strong>consolidate, hide, and finish</strong>.</p><hr><p>Would you like me to <strong>build a working prototype</strong> demonstrating the fixes — e.g., a cleaned-up Next.js + Drizzle version with (1) role-based onboarding that hides modules, (2) a single unified Notes system, (3) full project CRUD, and (4) a unified ShareDialog + sharing manager? I can scaffold that as a runnable app so you can see the improved workflow directly. Just say the word and I'll start.</p></div>


# WeaveForge — design & workflow audit

A full read of `Satwik-Miyyapuram/weaveforge` at commit `4577caa` (2,348 files:
~166k lines of TS/TSX in `apps/web` + `packages/core`, 132 SQL migrations, 107
Markdown docs, 76 Python files), reviewed against four questions:

1. **Better design** — is the visual system coherent and is it a system at all?
2. **Intuitive usage** — does the product explain itself?
3. **Ease of use** — is anything harder than it needs to be?
4. **Everything a user could want** — what is missing for a real research project?

Each finding below is written in the same five fields.

**Severity key** — `critical` = a researcher cannot complete a core task, or
abandons the product · `high` = costs real time every week, or is a broken
promise · `medium` = friction, inconsistency, or maintenance drag that shows up
in the product · `low` = polish.

---

## Contents

- [A. Information architecture](#a-information-architecture) — 8 findings
- [B. Workflows: getting things done](#b-workflows-getting-things-done) — 11 findings
- [C. Design coherence](#c-design-coherence) — 7 findings
- [D. Complexity that leaks into the product](#d-complexity-that-leaks-into-the-product) — 5 findings
- [E. Accessibility & ergonomics](#e-accessibility--ergonomics) — 4 findings
- [F. Data, privacy & trust](#f-data-privacy--trust) — 5 findings
- [G. Docs vs. product](#g-docs-vs-product) — 3 findings
- [Prioritised fix roadmap](#prioritised-fix-roadmap)
- [What a coherent version looks like](#what-a-coherent-version-looks-like)

**Totals: 8 critical · 14 high · 17 medium · 5 low = 43 findings**

---

# A. Information architecture

## A1 · Two products do the same job: `/notes` (Vault) and `/wiki`

**problem:** The app ships both a **Vault** module and a **Wiki** module. Both
edit markdown. Both have wiki-links. Both render a page list with a title and a
body. Their nav labels are `Notes` and `Wiki`, and both use the **same icon**
(`notes`). `/vault` still exists as a third surface that merely redirects to
`/notes`.

**how discovered:** `apps/web/src/features/vault/module.ts` and
`apps/web/src/features/wiki/module.ts` declare two modules with identical
`navGroup: "library"` and identical `icon: "notes"`. `apps/web/src/app/vault/page.tsx`
is a one-line `redirect("/notes")` marked `Legacy route`. The UI spec (§3.4a) only
documents one of them, titled "Notes *(Library → Notes / vault)*", and never
mentions Wiki at all — so the shipped surface is undocumented.

**why it happens:** The vault was built first (migration `0027_vault_pages.sql` is
in its module), the wiki was added as a second, feature-richer concept, and the
two were never merged or differentiated. Because modules register themselves into
the nav automatically (`registry.ts` → `buildNavGroupsFromModules`), adding a
module *always* adds a nav item — there is no step where anyone reviews whether
the product now has two of the same thing. Automatic nav construction plus no
information-architecture review is exactly how this class of flaw is born.

**fix:** One note type. `vault_pages` is the store; the wiki's wiki-link
behaviour (`[[Like this]]`, backlinks) is a *rendering feature of notes*, not a
separate product. Concretely: delete `features/wiki`, move its link-resolution and
backlink code into `features/vault`, and make the single **Notes** screen show a
backlinks panel on every page. Keep `/wiki` as a redirect. If the wiki really must
stay distinct, differentiate it on one axis only (e.g. "Notes = yours, Wiki =
curated, versioned, shared-with-the-lab") and say so in the empty state — right now
nothing in the UI tells a user which one to use, which is the actual bug.

**severity:** `critical` — a researcher's first structural decision is "where do I
write things down", and the product answers with two identical doors.

---

## A2 · Three destinations share an icon, two share another

**problem:** Nav labels map to icons as: `Editor → pencil`, `Log → pencil`,
`Notes → notes`, `Wiki → notes`. In the sidebar and in the mobile tab bar, the
item is recognised by its silhouette first and its label second — so two of the
five library destinations are visually identical, and so are two items in the
Plan group.

**how discovered:** reading `navItems` in each `features/*/module.ts`:
`logbookModule` `{label: "Log", icon: "pencil"}`, `editorWorkspaceModule`
`{label: "Editor", icon: "pencil"}`, `vaultModule` and `wikiModule` both
`{label: …, icon: "notes"}`. `apps/web/src/app/nav-icon.tsx` maps a *name* to a
glyph, so the collision is invisible at the definition site — you have to look at
two files to see it.

**why it happens:** The icon is a free string on `NavItem`, chosen by whoever
wrote the module, and nothing validates uniqueness or semantic fit. The registry
already groups items into `NAV_GROUP_META` with its own icon set — a second,
parallel icon vocabulary — so a contributor has two icon systems to choose from
and picks whichever string comes to mind.

**fix:** Give `NavItem` a typed `icon: IconName` union (the compiler then rejects a
collision with a neighbouring item if you annotate the nav as a tuple of known
keys), and draw a single icon table with one glyph per concept. Concretely for
today: Notes = page, Journal = calendar, Plan = flag, Runs = flask, Report =
document, Library = books, Home = house, Search = magnifier. Where two items share
a concept (Notes/Journal are both "writing"), differentiate with a **shape**
difference, not a colour.

**severity:** `high`

---

## A3 · A nav item that always says no: `/workspace` (Editor)

**problem:** The sidebar offers **Editor** to every web user. Clicking it on the
web renders a paragraph saying *"The split-pane editor runs in the desktop app…
Your notes, papers and report are all editable here in the browser from their own
screens."* So a permanent primary-nav item is a page whose only content is an
apology.

**how discovered:** `apps/web/src/app/workspace/page.tsx` — after a
`useEffect`-resolved `desktop()` check it renders a `host === "web"` refusal
screen. Meanwhile `features/editor-workspace/module.ts` claims in its doc
comment: *"The split-pane editor, in both builds… on the web those two commands
are reached from the strip and the explorer; everything else the workspace does
works the same."* The module comment and the page contradict each other.

**why it happens:** Two changes landed at different times and only one of them
updated the module. Because `moduleEnabled()` in `registry.ts` gates on
`mod.desktopOnly && !isOfflineBuild()` — a *build*-time flag, not a
*runtime capability* check — there is no mechanism to hide an item the running
build cannot serve. The nav is generated from static metadata, so capability is
invisible to it.

**fix:** Make capability a runtime input to the registry: `moduleEnabled(mod,
config, capabilities)` where `capabilities = { desktop, network, storage }` is
resolved once at startup. Then `editor-workspace` declares `requires:
["desktop-bridge"]` and simply does not appear in the web build — the same rule
already used for `git` (`config.gitRead.length > 0`) and for `requiresNetwork` on
offline builds. If the workspace genuinely works on the web per the module
comment, fix the page instead and delete the refusal.

**severity:** `high` — a dead nav item is worse than a missing one: it teaches the
user that the sidebar lies.

---

## A4 · Group navigation has no destination of its own

**problem:** Clicking **Library** in the sidebar navigates to `group.items[0]`
(`/papers`). There is no "Library" — it is a group label that behaves like a link.
The sub-tab strip that appears afterwards is the only place the group's members
are all visible at once, and it is *contextual*: it disappears on detail views and
on the workspace route, so the map of the section vanishes exactly when you are
deep in it.

**how discovered:** `apps/web/src/app/tabbar.tsx` line 106: `href={group.items[0]?.path
?? "/"}`. `apps/web/src/app/sub-nav.tsx` renders `null` unless
`group.items.length > 1`, and `app-shell.tsx` removes `<SubNav />` entirely for
`detailView || editorRoute`.

**why it happens:** The nav was built as "one item per `FeatureModule`", and
modules were then grouped for visual tidiness. Grouping without giving the group a
landing view leaves the group as decoration — and a group whose first item is
arbitrary means the click target's meaning depends on registration order.

**fix:** Either (a) make groups non-clickable headers (a `<div class="nav-section-label">`
that is not a link) and rely on the sub-tab strip — cheap and honest; or (b) give
each group a real index screen (Library = the reading table plus filters; Plan =
milestones and log side by side) so the group click has a meaning. Recommend (b)
for Library and Plan, (a) for Experiments and Report. Additionally, make the
sub-tab strip sticky so the section map survives scrolling.

**severity:** `medium`

---

## A5 · Routing has two sources of truth: the registry and a hard-coded list

**problem:** `ACCOUNT_ROUTES = ["/settings", "/supervision", "/shared"]` is
hard-coded in `app-shell.tsx`, with a comment explaining that without it *"the
shell falls back to the project picker for every route when nothing is selected,
so Settings / Supervise / Shared are reachable only after picking a project — even
though the links point straight at them."* That comment is the bug report: the
links and the router disagreed.

**how discovered:** `apps/web/src/app/app-shell.tsx` lines 66–76; cross-checked
against `registry.ts`, which already knows every module's `routes` and its
`shell`/project-scoped status (`shellModules = [settingsModule, sharingModule,
orgModule]`). The registry has the fact; a constant in the shell repeats it.

**why it happens:** `FeatureModule` records routes but not their *scope*
(project-scoped vs account-scoped), so the shell cannot ask "does this route need a
project?" and someone typed a list instead. Every new account-level route will
need the same edit, and it will be forgotten.

**fix:** Add `scope: "project" | "account" | "public"` to `FeatureModule.routes`.
`groupForPath`-style lookup in the shell replaces the array. Then
`/link?t=…`, `/pitch`, `/recover`, `/reset-password` (all special-cased in
`app-shell`'s early returns) become `scope: "public"` and the five `if
(pathname === …)` branches at the top of the shell collapse into one lookup.

**severity:** `medium`

---

## A6 · 54 tables, 132 migrations, and nine tables nothing can reach

**problem:** The live schema contains `user_keys`, `project_keys`,
`project_key_wraps`, `resource_keys`, `resource_key_wraps`, `key_epochs`,
`user_device_key_wraps`, `user_device_transfer_requests`, `user_email_recovery_secrets`
— all created by migrations `0037`–`0041` and `0089`–`0095` for a client-side
E2EE feature. Migration `0099_drop_e2ee_schema.sql` **drops the entire feature**,
and no code in `apps/`, `packages/`, `python/` or `scripts/` references any of
those tables. They still ship in the migration chain, so a fresh install creates
them and then drops them, and a reader of the chain cannot tell what is real.

**how discovered:** grepped every `create table` in `supabase/migrations/` (54
tables), then grepped each name across `apps/web/src` + `packages/core/src`.
Nine had zero references. Read `0099_drop_e2ee_schema.sql` and the comment block
in `0123_function_execute_grants.sql` (§2) which states the problem in the
project's own words: *"`get_public_keys` — a dead RPC, still granted… any client
with the call cached… gets a 500 from PostgREST for a feature removed two years of
migrations ago."*

**why it happens:** A dropped feature is archived but never excised. `0099` uses
`drop table if exists`, so the removal is silent and idempotent — which is correct
for a rollback but means nothing warns that `0037`–`0041` are now pure noise. The
README even had to be corrected mid-flight: it used to assert that no migration
drops anything.

**fix:** Squash the chain. Keep `supabase/migrations-self-hosted-postgres/` as the
base, then emit a single `0001_schema.sql` that is the schema as it stands today
minus the nine dead tables, with `0099`'s narrative preserved as a comment. Keep
the historical chain in `supabase/migrations-archive/`. Concretely also drop
`paper_locus_anchors` and `share_link_rate_limits` (both unreferenced) or wire
them up. Add a CI check: a table with zero references outside `supabase/` fails
the build.

**severity:** `high` — this is the difference between a schema you can read and one
you have to simulate in your head.

---

## A7 · Three trees, three different-looking trees

**problem:** Reading lists, the report outline and the org chart are all trees of
the same shape (parent → children, expandable, with a per-node action cluster).
They share no component and no visual rules: different indentation, different
connectors (or none), different expand affordances.

**how discovered:** `features/reading-lists/ui/lists-screen.tsx` (622 lines),
`features/report/ui/…` and `features/org/ui/member-tree.tsx` (254 lines). The
project's own designer checklist admits it — `docs/internal/strategy/ui-spec.md`
§4 item 10: *"Trees: three tree UIs exist (reading lists, report outline, org
chart) — align their look (indent, connectors, expand/collapse)."*

**why it happens:** Each feature module owns its `ui/` folder and is explicitly
discouraged from importing another feature's UI (`npm run check:solid` enforces
"no cross-feature /ui imports"). The architectural rule is right — but it was
written without a shared-primitives layer to compensate, so every tree is
reinvented. A DRY check (`check:dry`) exists but covers pin/share/owner-label
patterns in `core`, not presentation.

**fix:** Create `apps/web/src/components/tree/` — one `<TreeView>` with
`indent`, `connector`, `expand`, `actions` slots and a `depth` render prop — and
refactor the three call sites onto it. Extend `check:dry` to flag a second
implementation of a primitive (`tree`, `status-pill`, `date-field`,
`empty-state`, `card`). The architectural boundary between features stays;
shared *presentational* primitives are exactly what should cross it.

**severity:** `low` alone, `high` as evidence of the pattern in C1.

---

## A8 · The marketing page is a second Next.js app

**problem:** `apps/pitch` is a separate Next application with one route that
re-exports a component from `apps/web`, exists only because the product cannot be
statically exported, and needs `BASE_PATH`, an `APP_URL` repo variable and a
`.nojekyll` write to deploy. `apps/web/src/app/pitch/` (577-line `page.tsx`, plus
`graph.tsx`, `reader-scene.tsx`, `compare.tsx`, `theme-palette.tsx`) is the
content.

**how discovered:** `du -sh apps/*` (pitch = 868 lines across 3 apps' worth of
tooling), `apps/web/src/app/pitch/page.tsx`, README section "The pitch site".

**why it happens:** The product has 35 API routes and a server runtime, so
`output: "export"` is impossible — a second app is the only way to get a static
page. That is a legitimate constraint with an expensive consequence: a whole
second app, second build, second deploy path, and a page whose failure mode
(`.nojekyll` missing → `_next/` dropped → blank page) is documented rather than
prevented.

**fix:** Delete `apps/pitch`. Publish `/pitch` from the same deployment (it is
already `scope: "public"` in the shell). If GitHub Pages is a hard requirement,
have the existing `pages.yml` job run `next build` on `apps/web` and publish only
the `/pitch` output, generating `.nojekyll` in the deploy step so it cannot be
forgotten. The constraint is real; the second app is not the only answer to it.

**severity:** `low`

---

# B. Workflows: getting things done

## B1 · Adding literature one paper at a time

**problem:** `AddPaperForm` accepts **one** reference. Its controls are: a title
text field, a four-way source picker (`URL | arXiv id | DOI | Zotero key`), a value
field, and a status dropdown. There is no BibTeX import, no RIS import, no
multi-line paste, no "import my whole Zotero library", and no CSV. For a
researcher who already has 300 references, the only path in is 300 submissions.

Worse, the picker does not control the outcome: `parsePaperRef(refKind, value)`
re-decides what the value is, and the UI tells the user so underneath the field
(*"detected: arXiv"*). A control that the system overrides is worse than no
control.

**how discovered:** `apps/web/src/features/papers/ui/add-paper-form.tsx` (147
lines) — a single `submit` calls `papers.importPaper.fromRef({kind, value})` or
`addPaper.addManual({title, status})`; there is no loop, no array, no bulk
entry point anywhere in `packages/core` (`importPaper`, `importMany` absent).
`grep -rn 'importMany|bulk'` only finds PDF bulk-download and annotation
batching. Confirmed against the README feature list: *"Import, Zotero sync,
summaries, #tags, annotations, figures…"* — "import" is singular.

**why it happens:** The import pipeline is built around `IMetadataSource`
(one reference → one record), so the abstraction itself has no room for a batch.
Everything downstream (resolver, use-case, facade, form) inherited the arity. The
Zotero integration is a *sync* (which does handle volume) but it is gated behind
configuring `ZOTERO_API_KEY` and a collection, and only exists in the desktop
build for the local variant.

**fix:**
1. Make the add flow a **paste box**. Accept anything: a `.bib` file's contents, a
   list of DOIs/arXiv ids/URLs, or plain citations. Parse, show a preview table of
   *n* rows with detected source per row and a per-row edit, then commit in one
   round trip.
2. Add `importBibtex(text): PaperDraft[]` to `@weaveforge/core` next to
   `parsePaperRef` — it is pure and testable in the existing core suite.
3. Resolve metadata **concurrently** (bounded, e.g. 6 at a time) instead of
   serially per row; de-duplicate on DOI → arXiv id → title+year before insert.
4. Keep the single-reference field as a fast path inside the same box: one line
   typed = the same behaviour as today, minus the dead source picker.

**severity:** `critical` — this is the product's front door and it only opens one
person wide.

---

## B2 · The first five minutes: four gates before one click of value

**problem:** A brand-new account must clear, in order:
`LoginScreen` → `PrivacyDisclaimerGate` (a modal whose acceptance is a database
write) → `OrgSetupGate` ("Create a research lab · Join with a code · Use the app on
your own") → `ProjectsScreen` (project picker) → *then* an empty Papers screen
with an "Add paper" button. Four decisions, one of which asks what your
relationship to a supervisor is before you have seen the product, and none of
which produce anything the researcher can read.

**how discovered:** `apps/web/src/app/app-shell.tsx` nesting
`StartupProvider → PrivacyDisclaimerGate → ProfileProvider → ThemeSyncProvider →
OrgSetupGate → ProjectProvider → ProjectScopedShell`; `features/org/ui/org-setup-gate.tsx`
(391 lines); `features/auth/ui/privacy-disclaimer-gate.tsx` (313 lines). The
README confirms: *"On first sign-in, complete org setup in Settings → People
(create/join a lab or continue standalone)."* — except the README says it lives in
Settings, while the code blocks the whole app with it.

**why it happens:** Each gate was added to fix a real problem (legal exposure,
org-tree provisioning before first write, project scoping) and each one was placed
*in front of* the app because that was the only place that guaranteed it would be
seen. There is no concept of "onboarding that can be deferred", so every
prerequisite becomes a wall. `startup-provider.ts`'s comment about the very first
write failing on a foreign key reveals the technical root: the user row and the
data are in two databases and must be bridged before anything works.

**fix:**
1. **Collapse the gates into one screen** with a single question and a clear
   escape: *"Where is this research going? [My own project] [A lab — enter code]"*
   and make **"Just let me in"** the primary button for the standalone case. Legal
   copy becomes a footer line you accept by continuing (with the full text one
   click away), not a modal.
2. **Create the first workspace in the same act.** After sign-up, auto-create
   "My research" and land on `/today` with the sample project already loaded (see
   B3). Lab joining moves to Settings → People where the README already says it
   lives.
3. Delete the project picker as a *screen*. A researcher with one project should
   never see it; a researcher with several needs a switcher (which already exists
   in the sidebar), not a gate.
4. Provision the user row at sign-up time (one `insert` in the auth callback)
   rather than lazily in `startup-provider`, which currently has to run
   `ensureProvisioned()` before the first write or the disclaimer save dies.

**severity:** `critical`

---

## B3 · A new workspace is eleven empty screens

**problem:** After all four gates, the researcher has: 0 papers, 0 notes, 0
milestones, 0 experiments, 0 sections. Nothing shows what "done" looks like, what
fields exist, or how the modules relate. Every screen is the same three lines of
empty state pointing at a `+` button.

**how discovered:** `features/showcase/` contains a full demo dataset
(`domain/showcase-data`, `infrastructure/seed-showcase.ts`,
`application/load-local-demo.ts`) — and it is **used only by the marketing page**.
`grep -rn 'showcase'` outside `features/showcase` returns exactly two hits, both
in `app/pitch/`. The product's own demo content is unreachable from the product.

**why it happens:** The showcase seed was written for `apps/pitch`, and the
feature-module boundary that keeps features from importing each other also kept
nobody from wiring the seed into onboarding. There is no "first run" module at
all — `features/startup` is a data-fetch provider, not onboarding.

**fix:** Two buttons on the workspace-creation step: **"Start empty"** and
**"Start from a worked example"**. The latter seeds `seedShowcase` data (a small
literature set, three milestones, one experiment with curves, an outline with word
targets, a week of log entries) tagged `demo:` so it can be cleared in one action
from the dashboard. Also ship **templates** — "PhD year 2", "systematic review",
"paper reproduction" — because those three have genuinely different shapes and
users of each will recognise their own project instantly.

**severity:** `high`

---

## B4 · Opening a paper is a 60-line state machine

**problem:** Selecting a paper does not navigate. It sets `?paper=<id>`, and a
single `useEffect` then has to decide whether the paper is owned, or shared, or
pinned-shared, or already hydrated, or needs re-fetching, or has failed, or has
changed since last fetch — with a `generation` counter, a `guestPaperIdRef`
mirror, an `appliedPaperFromUrl` ref, and a `keepOrDrop` closure whose docstring
explains that getting it wrong strands the screen on *"Opening paper…"*. There is
also a `guestPaper` concept ("the list's summary is not a paper the note page can
render") that exists purely because list rows are a different type from papers.

**how discovered:** `apps/web/src/features/papers/ui/papers-list.tsx` lines
173–254 of a 619-line component, including the comment *"the class of bug
review-2 F6 is about"* and *"Leaving `openId` set is what would strand the screen
on 'Opening paper…'"*. The file also carries `useDetailPushFlag`,
`useDetailBack("/papers", "paper", …)` and `rememberRecentTarget` for what a
`<Link href="/papers/[id]">` would do natively.

**why it happens:** Detail views are query parameters on the list route instead of
routes. That choice was made so the list stays mounted behind the detail (the
swipe gesture and the back animation need it) — but it forces every list screen to
hand-roll URL state, history, fetching and failure recovery. Three screens do this
(`papers-list`, `lists-screen`, `experiments-screen`), and each has drifted into
its own variant.

**fix:** Make detail views real routes — `/library/[id]`, `/notes/[id]`,
`/runs/[id]` — and use Next's parallel routes/`@detail` slot (or simply a
two-column layout in the parent) if the list must stay mounted. The paper page is
a server component: `loadPaper(id)` in the page, `notFound()` when absent, no
client fetch, no generation counter. The `PaperSummary` vs `Paper` split stays,
but `PaperNote` takes the hydrated `Paper` from the server rather than a
projection that has to be upgraded in an effect.

**severity:** `high` — the code says in three places that a wrong branch leaves the
user on a spinner forever.

---

## B5 · "Opening paper…", "Nothing is tracked", and other states that explain the code

**problem:** Empty and error copy describes the system rather than the task:

- *"No papers are tracked yet — open a paper and use the bell icon to watch it for
  new citations."* (a feature that exists only as an unlabelled bell)
- *"Read Zotero on this computer — 2 new papers, 1 annotated items, 3 papers
  updated."* (`papers`/`items` mixed in one sentence, pluralisation done by hand
  in four places)
- *"The split-pane editor runs in the desktop app, where it can own the keyboard
  shortcuts it needs."*
- *"A copy with no account has no lab to create, none to join, and — the part that
  made this a dead end rather than a pointless screen — no server to answer
  `continueStandalone`."* (this one is a code comment, but the same register leaks
  into UI strings)

**how discovered:** `papers-list.tsx` lines 142–158; `workspace/page.tsx`;
`org-setup-gate.tsx` line 19.

**why it happens:** Every message is written inline at the failure site by the
implementer who just fixed a bug, so the message is addressed to the *next
maintainer* rather than to the person holding the paper deadline. There is no
copy table and no component that owns an empty state's shape (each screen hand-rolls
its own `<div className="card">` + text).

**fix:** One `EmptyState` and one `ErrorState` primitive with three slots
(`what happened` / `what to do` / `the button that does it`), and a
`src/lib/copy.ts` that holds every user-facing sentence in the product so a
non-engineer can read the whole voice in five minutes. Rule: a message may not
name a component ("the bell icon", "the strip", "the explorer") — only an action
("turn on citation alerts") with a button beside it.

**severity:** `medium`

---

## B6 · Citation alerts are a hidden feature whose only documentation is an error string

**problem:** Watching a paper for new citations is the kind of thing a research
tool lives on. In WeaveForge it is: a bell icon with no label inside the paper
detail, polled *from the browser* on project load
(`app-shell.tsx` → `getContainer().papers.checkCitationAlerts()`), rate-limited to
"at most once per tracked paper/day" in the browser, and its failure mode is the
string quoted in B5.

**how discovered:** `app-shell.tsx` lines 122–124 (browser-triggered polling with a
comment about aborting writes when the project changes mid-poll);
`papers-list.tsx` `checkCitationAlerts()`; `0102_citation_alert_tracks.sql`.

**why it happens:** There is no server-side scheduler in this stack (Supabase +
PostgREST, no cron), so anything periodic must be triggered by a human with a tab
open. The browser poll is a reasonable workaround, but the *feature* then has no
home in the UI: it is a property of a paper, so it lives in the paper's icon row.

**fix:** (1) Promote it to a visible, named control — "Watch for citations" with a
state (`Watching · last checked 2 days ago`) on the paper page and in the row
menu. (2) Move the polling to a Supabase scheduled function or a GitHub Action
that calls the same RPC — the browser should never be the thing that keeps a
watch alive. (3) Surface results as a **Citations** section on the paper page with
the diff since last check, not as a toast.

**severity:** `medium`

---

## B7 · Systematic-review screening is hidden inside a list node

**problem:** The product has a full systematic-review screening workflow
(`0120_screening_decisions.sql`, `features/reading-lists/ui/screening-panel.tsx`,
stages `title_abstract` / `full_text`, decisions `include`, `excludedAtScreening`,
`excludedAtFullText`…) — a genuinely distinguishing feature for a research tool.
It is reachable only by expanding a node inside a Reading List and finding a panel
there. It is in no nav, no module `navItems`, no dashboard card, and one line of
the README.

**how discovered:** `ScreeningPanel` is rendered from `lists-screen.tsx` line 501
inside a node expansion. `reading-lists/module.ts` `navItems` has exactly one item,
"Lists".

**why it happens:** It was built as a property of a reading list (which is
defensible — a screening *is* a list) but no product decision was made about
whether it is a *mode*. Anything without a nav item is invisible in a
registry-driven navigation.

**fix:** Make screening a **view mode of a list** with its own URL
(`/library?list=<id>&mode=screening`) and a visible toggle in the list header —
"Browse · Screen". Give it a dashboard card ("3 of 42 screened") because a
screening in progress is exactly the thing a researcher is in the middle of. Add
it to the command palette. Export a PRISMA-style count summary — for this
audience, that is the reason to use it at all.

**severity:** `medium` (but `high` for the systematic-review audience, where it is
the reason to choose the product)

---

## B8 · Three search systems with three behaviours

**problem:** A user can search in: (1) the per-screen inline `search` field, which
ranks through `useSearchIndex` + `rankFilter` over that screen's already-loaded
rows; (2) the `JumpToPalette` (Ctrl/Cmd+K), which searches papers, notes, report
sections, PDF pages and annotations and has its own `thesis.search.history`
localStorage; (3) `features/search` — a documented *global* search
(`docs/using/search.md`: "One search box over papers, notes, experiments, PDF text
and annotations"). Each has different fields in scope, different ranking and
different history.

**how discovered:** `components/jump-to-palette.tsx` (344 lines, own history key
`thesis.search.history`); `features/papers/ui/papers-list.tsx` builds
`rankedFilter({…, kinds: ["paper"]})`; `features/search/{application,infrastructure}`
plus `search-index-worker.ts`. `tabbar.tsx` has a comment explaining that search
"had no visible entry point at all — Ctrl/Cmd+K only, which is undiscoverable and
unreachable on a phone" and adds a *fourth* entry point.

**why it happens:** Search started per-screen (cheap, already-filtered), grew a
palette for navigation (a different job), and a global index was added later
because PDF text needed a worker. All three are legitimate; none of them share a
ranker or a result shape, so the user learns three behaviours.

**fix:** One index, one ranker, two *entry points* (palette = navigation, page =
filtering) that call the same `search(query, scope)`. The scope is the only
difference: `scope: "everything"` for the palette, `scope: "this screen"` for the
inline field. Share history across both. Keep the worker.

**severity:** `high`

---

## B9 · Modules vanish silently based on configuration

**problem:** `moduleEnabled()` in `registry.ts` returns `false` for the `git`
module when `config.gitRead.length === 0`, and for any `requiresNetwork` module in
an offline build. The nav item simply is not rendered — no hint, no settings
pointer, no reason. A user who read the README's "Git: live branch/commit
browser; track commit as experiment" will not find it and cannot find out why.

**how discovered:** `apps/web/src/registry.ts` lines 24–33.

**why it happens:** Capability is folded into visibility. Hiding is the right
default (do not show what cannot work) but it is implemented as *erasure* rather
than as *an explained disabled state*, so the product has a different number of
features on every deployment and no way to say which.

**fix:** Show the item disabled with a reason on hover/click: "Git needs a
repository connection — Settings → Integrations". Better: a **Settings →
Features** panel listing every module with `Available / Off / Missing
configuration`, so the product can explain its own shape. This also gives plugin
authors (`plugins/example`) somewhere to be seen.

**severity:** `medium`

---

## B10 · The dashboard is a build-your-own tool

**problem:** Home is a 12-column `react-grid-layout` canvas with twelve card types
(`reading-progress`, `report-progress`, `plan-progress`, `experiments-summary`,
`needs-attention`, `recent-log`, `library-snapshot`, `top-tags`, `team-roster`,
`team-attention`, `supervisee-snapshot`) and a `Customize / Done` edit bar. Before
it says anything useful, the researcher must understand the difference between
`library-snapshot` and `reading-progress`, and between `team-roster` and
`team-attention` — vocabulary that is only explained by building them.

**how discovered:** `features/dashboard/application/card-registry.ts` (12 type
definitions), `dashboard-layout.ts`, `ui/card-picker-sheet.tsx`,
`dashboard-grid.tsx`. The UI spec §3.0 confirms the customize-first model.

**why it happens:** Widgets were added per stakeholder (a professor needs
`supervisee-snapshot`, a student needs `reading-progress`) rather than per
question. A widget grid is the most general possible answer to "what should home
show", and general answers push the design work onto the user.

**fix:** Ship **one opinionated default**: "What needs you today" — overdue and
due-this-week milestones, the runs that finished or failed, sections below target,
papers you marked reading and left, and a one-line journal prompt. Then let
customization add to that, not replace it. Reduce the twelve cards to four
questions (Progress · Now · People · Recent) and make the rest collapsible rows
inside them.

**severity:** `medium`

---

## B11 · The Python SDK is three env vars and a leap of faith

**problem:** To push a run from a training script you must: create a token in
Settings → Python SDK access tokens, `pip install -e python`, then set
`WEAVEFORGE_TOKEN`, `WEAVEFORGE_API_URL` and *either* `WEAVEFORGE_PROJECT` *or*
`WEAVEFORGE_PROJECT_ID`. Nothing in the web app shows what the project id is, what
a valid URL is, or whether the token works. The first failure a user meets is a
401 from their own training job an hour in.

**how discovered:** README "Python SDK" section (the three exports),
`python/README.md`, `apps/web/src/features/settings/ui/api-tokens-panel.tsx`, and
`0129_api_token_scope.sql` (tokens became workspace-scoped late).

**why it happens:** The SDK was designed from the contract outward (repository
interfaces, `@track_experiment`, callbacks) — good engineering — and the *first
run* experience was left to the README. There is no "did it work?" surface.

**fix:** (1) The token-creation dialog prints the **complete ready-to-paste
snippet** with the real token, real URL and real project id filled in. (2) A
`weaveforge login --url … --token …` CLI that writes the config file and pings
`/api/sdk/whoami`. (3) In the app, a **Runs → waiting** state showing "listening
for `experiment_metrics` on this workspace" so a user can tell the difference
between "my script is broken" and "the token is wrong".

**severity:** `medium`

---

# C. Design coherence

## C1 · 55 stylesheets, 18 themes, 3 control sizes, 2 surface styles = 108 combinations

**problem:** `apps/web/src/app/styles/` holds 28 CSS files (`base`, `buttons`,
`cards`, `entity-cards`, `entity-detail`, `forms`, `nav`, `shell`, `surfaces`,
`overlays`, `privacy`, `loading`, `motion`, plus one per feature). `app/themes/`
holds 16 more (`light`, `latte`, `honey`, `vivid-light`, `pastel-light`,
`confetti-light`, `dark`, `mocha`, `dracula`, `amoled`, `contrast`,
`vivid-dark`, `pastel-dark`, `confetti-dark`, `common`, `contrast`). Settings
adds `controlSize` (compact / default / comfortable) and `surfaces`
("borderless (depth)" / "bordered (high contrast)"). 10,722 lines of CSS in total.

Nothing constrains the combinations: `contrast` + `borderless` + `compact` is a
legal state, and so is `confetti-light` + `bordered` + `comfortable`. Each
feature stylesheet may set its own card radius, its own gap and its own status
hex (the UI spec explicitly warns *"do not invent one-off status hex"* — which is
only written because it was happening).

**how discovered:** `find apps/web/src -name '*.css' | wc -l` → 55; `wc -l` → 10,722;
`lib/theme/theme.ts` lines 42–64 (3 control sizes, 12 named themes) and 94 (2
surface styles); settings-screen.tsx exposes all four controls.

**why it happens:** Theming was implemented as "a theme is a file that overrides
variables", which makes every theme a full design system that must be kept
consistent with every other one by hand. Feature CSS grew beside it because
there is no shared component layer (see A7) — when a feature needs a new look, it
writes CSS. Both are correct local decisions that produce an unauditable whole.

**fix:**
1. **Two modes.** One light and one dark ramp, one accent, one semantic ramp
   (`ok / warn / bad / info / hold`) expressed as CSS custom properties. Delete
   the other 14 themes. If personality is wanted, keep `Amoled` and `High
   Contrast` as two documented exceptions (they serve real needs) — that is four
   modes, not eighteen.
2. **One scale.** Card radius 14, field radius 9, pill 999, spacing on a 4px
   grid, a 1.25 type scale, one shadow recipe per elevation. Put it in
   `styles/tokens.css` and delete `entity-cards.css`, `entity-detail.css`,
   `cards.css`, `surfaces.css` into a single `components.css`.
3. **Delete `controlSize` and `surfaces`** as user-facing settings. Density is a
   design decision; exposing it multiplies the states to test. Ship one density.
4. Add a **visual regression** check over one page per module in light and dark —
   the only way 108 states becomes 2 tested states and stays that way.

**severity:** `high`

---

## C2 · Four status vocabularies, four colour tables

**problem:** The app has four unrelated status systems:

| Concept | Values | Where the colours live |
|---|---|---|
| Paper | `to_read · reading · read · skimmed` | papers CSS + pill markup |
| Experiment | `planned · running · done · failed · abandoned` | experiments.css |
| Milestone | `planned · in_progress · done · blocked` | plan CSS |
| Report section | `not_started · drafting · review · done` | sections.css |

Note the near-misses: `done` appears in three vocabularies, `planned` in two,
`reading`/`review` mean the same thing with different words, and `to_read` vs
`not_started` vs `planned` are one idea with three spellings. A user reading
"done" in one module and "done" in another cannot tell whether the colour means
the same thing — sometimes it does not.

**how discovered:** `docs/internal/strategy/ui-spec.md` §2 lists the vocabularies
verbatim; §4 item 2 admits the problem: *"Status system: one shared color/pill
treatment for all status vocabularies (paper/experiment/milestone/report),
instead of per-feature ad-hoc colors."*

**why it happens:** Each domain modelled its own lifecycle honestly (a paper
*does* have different states from a milestone), and then each UI invented its own
presentation of "how far along is this". Vocabulary and presentation grew
together per feature.

**fix:** Keep the four lifecycles (they are real) but map them onto **one shared
progress ramp** for display: `todo` (neutral) → `active` (accent) → `review`
(info) → `done` (success), plus `blocked/failed` (danger) and `parked` (muted) as
the two exceptions. One `<StatusPill kind="paper" value="to_read" />` component
owns the label *and* the tone, so the mapping is one table in one file. Rename the
spellings toward each other where the meaning is identical (`to_read` → `queued`,
`not_started` → `outlined`, `in_progress` → `active`).

**severity:** `high`

---

## C3 · Detail views are query parameters, so "back" is a bespoke feature

**problem:** Opening a paper sets `?paper=<id>` on `/papers`. Closing it calls
`useDetailBack("/papers", "paper", consumePushed)`, which consumes a
`useDetailPushFlag()` set three lines earlier to decide whether to `router.back()`
or `router.replace()`. The same pattern exists for notes and experiments with
slight variations. As a result: no deep link can be opened in a new tab with its
own history, no browser bookmark of an open paper works as expected on a second
visit, and swipe-between-sub-tabs is disabled inside detail views.

**how discovered:** `papers-list.tsx` `openPaperById`, `useDetailBack`,
`useDetailPushFlag`; `app-shell.tsx` `useIsDetailView` controls SubNav and
`SwipeViews` visibility.

**why it happens:** Query-param details keep the list mounted and animate nicely,
but they hand the routing job to React state. The push-flag/consume-flag pair is
the tell: the code is reconstructing `history.state` because it stepped around the
router.

**fix:** Real routes (`/library/[id]`). Keep the list mounted with a Next.js
parallel route slot if the two-pane layout needs it. Then `useDetailBack`,
`useDetailPushFlag`, `useIsDetailView` and the `?paper=` handling in three screens
all delete, and browser back, bookmarks, sharing a link and "open in new tab" all
start working for free.

**severity:** `high`

---

## C4 · "Add" is a modal everywhere, but never the same modal

**problem:** The UI spec's rule is *"All 'add/create' forms open in a modal… Action
cluster: prefer a single primary (`+ Paper`, `+ Note`, …) that opens a choice
dialog for secondary actions."* In practice each screen has its own modal with its
own width, its own field order, its own validation placement and its own footer
buttons. The paper flow is a modal that opens a *second* modal (`composeMode:
"menu" | "new"` in `papers-list.tsx`) — two dialogs deep to add one thing.

**how discovered:** `papers-list.tsx` `composeOpen`/`composeMode`; the spec's own
checklist §4 item 4: *"Add/Create pattern: every add flow is now a header button →
modal. Confirm modal size, field layout, validation, and error display."* — i.e.
the pattern exists and its details were never decided.

**why it happens:** A rule was written ("adds are modals") without a component to
enforce it. `components/modal.tsx` supplies the chrome only.

**fix:** One `<CreateSheet>` with a fixed contract: title, one-line description,
24px field rhythm, validation under its field, primary action bottom-right, and
`⌘Enter` to submit. The paper case becomes **one** sheet with the paste box (B1)
plus an "or add by hand" disclosure — no nested dialogs. Anything with more than
six fields is not a modal, it is a page (the experiment editor is over that line).

**severity:** `medium`

---

## C5 · Three icon systems

**problem:** Icons come from `app/nav-icon.tsx` (name → inline SVG),
`components/view-icons.tsx` (`BoardViewIcon`, `CardsViewIcon`, `ListViewIcon` as
exported components) and ad-hoc inline `<svg>` inside headers (the hamburger in
`tabbar.tsx` is 5 lines of raw SVG). Stroke widths, corner radii and the 24px grid
are not shared.

**how discovered:** grep for `<svg` across `apps/web/src` and the two icon files.

**why it happens:** No icon module existed when the nav was built, so it grew one;
the view switcher grew another; headers inline whatever is fastest.

**fix:** One `components/icons.tsx` with a typed `IconName` union on the 24px grid
at a single stroke weight, used by nav, buttons and view switchers. Delete the
other two. Bonus: the typed union is what lets A2's compiler check work.

**severity:** `low`

---

## C6 · Filters live in three different places

**problem:** Papers has a `Filters` popover with a count badge, a MultiSelect for
tags, a MultiSelect for lists, a status filter and a search box. Lists has its own
`ListTagFilters` component. Experiments has a status filter inline. The spec (§4
item 5) says the rule is *"every multi-filter page uses a `Filters ▾` popover with
a count badge; search stays inline"* — Papers is the only screen that follows it.

**how discovered:** `papers-list.tsx` (`statusFilter`, `listFilter`, `tagFilter`,
`activeFilters` count, `ListTagFilters` import); `components/list-tag-filters.tsx`;
`experiments-screen.tsx`. Filters are also persisted per screen under
`thesis.papers.*` keys, so clearing a filter on one screen does not clear the same
filter elsewhere.

**why it happens:** Filter state is local `usePersistedState` in each screen, so
each screen invented its own affordances around its own state.

**fix:** One `useFacets` hook (state + URL sync + a `Filters` popover renderer).
Move filter state into the URL — `?status=reading&tag=transformers` — so a
filtered view is linkable and browser-back undoes a filter. One
`thesis.facets.<screen>` persistence key or none at all.

**severity:** `medium`

---

## C7 · Help tooltips explain the interface to itself

**problem:** The spec's global rule (§4 item 6) is *"Help pattern: every heading has
a `?` hover/tap tooltip. Confirm copy."* `HeadingHelp` is "available but not
required". The result is inconsistent: some headings explain themselves, others do
not, and the copy is generated from the same knowledge that built the screen, so
it re-states the label ("Report — nested outline with per-section status and word
targets") instead of answering a question ("Where do I write?").

**how discovered:** `ui-spec.md` §1.4 and §4 item 6.

**why it happens:** Help was specified as a per-heading widget rather than as
onboarding (B2) plus good empty states (B5). A `?` beside every heading is a
signal that the interface does not explain itself.

**fix:** Delete the heading help. Invest in: a first-run worked example (B3),
empty states that name the next action (B5), and one **"How this works"** panel
per screen (accessible from the palette) that describes the model in three
sentences. Where a field is genuinely non-obvious ("word target"), inline `hint`
text under the field, not a tooltip.

**severity:** `low`

---

# D. Complexity that leaks into the product

## D1 · Six nested providers on the critical path

**problem:** `AppShell` nests
`StartupProvider → PrivacyDisclaimerGate → ProfileProvider → ThemeSyncProvider →
OrgSetupGate → ProjectProvider → ProjectScopedShell`, and the shell is remounted
`key={user.id}` and `key={projectId}`. `startup-provider.ts` documents the cost
honestly: *"Only three things were ever serial on the critical path: auth, then
settings, then the org batch — settings gating the batch by the fail-closed rule."*
Plus `light-bootstrap`, `bootstrap.ensureContainer()`, `getContainer()` and a
"~17 JS chunks" container graph.

**how discovered:** `app-shell.tsx`; `features/startup/startup-provider.ts`
(≈400 lines of load orchestration with `singleFlight`, `onDecision` callbacks and
a documented unhandled-rejection hazard in dev).

**why it happens:** Every provider holds a piece of the answer to "what am I
allowed to do" — user, settings, profile, org, project, theme — and they must
resolve in a specific order because each one gates the next. Six questions about
permission, asked in sequence, is the runtime form of B2's four gates.

**fix:** Answer all six questions in **one** server component at the root
(`getSession()` → `{ user, workspace, role, canEdit, needsSetup }`) and pass a
single `ctx` down. Client state then shrinks to `theme` and `palette`. The
fail-closed rule for the disclaimer stays, but it becomes one boolean in `ctx`
rather than a gate component that wraps the entire tree.

**severity:** `high`

---

## D2 · 879 source files for 13 screens

**problem:** `apps/web/src` contains 879 non-test TS/TSX files serving 13 screens
(≈68 files per screen), plus 259 test files, across a
`features/{domain,application,infrastructure,ui}` + `container/facades` +
`packages/core` layering. Changing the fields of one form can touch: the UI file,
a facade, a use-case, a repository interface in core, a Supabase adapter, a
row-mapper, a contract test, a web test and a generated registry.

**how discovered:** `find apps/web/src -name '*.ts*' | grep -v '\.test\.' | wc -l`
→ 879; `packages/core/src` → 335 non-test files; `apps/web/src/container/facades/`
→ 23 facades.

**why it happens:** TDD + SOLID + dependency inversion, applied uniformly to a
product with 13 screens. The architecture is defensible for a large team and a
plugin ecosystem (`plugins/example`, `docs/using/extensions.md`); for this product
it costs more than it returns, and its cost is paid in *time to ship the user-facing
fixes* in section B.

**fix:** Keep the boundaries where they buy something — `packages/core` (used by
the Python SDK and the tests), the repository interfaces (used by the
Supabase/Postgres/local adapter split, which is real), and the feature-per-module
rule (used by the generated registry). **Delete the facade layer**: 23 facades
that forward to use-cases is a translation layer with no variance. Merge
`domain/application/infrastructure` inside each feature into one folder with a
`*.repository.ts` seam. Expect ~40% fewer files and no behaviour change.

**severity:** `medium` (product-visible mostly through how slowly section B gets fixed)

---

## D3 · Screens load everything, then filter in the browser

**problem:** `LoadPapersScreenUseCase` calls `papers.listSummaries()`,
`lists.list()`, then `listItems.listItemsForLists(ids)` and finally
`loadPinnedScreenData(…, loadById)` — no `limit`, no paging, no server-side
filter. The same shape is used for lists, experiments and milestones. The
`app-shell` comment records the consequence: a single screen used to cost "~30
requests", and the fix was to *stop warming ten tables*, not to bound the reads.

**how discovered:** `features/papers/application/load-papers-screen.use-case.ts`
lines 43–58; `app-shell.tsx` lines 104–112.

**why it happens:** PostgREST-style `select *` from a repository with no
pagination parameters in its interface (`IPaperRepository.listSummaries()` takes
no arguments) cannot be paged later without changing every implementation and
test. Pagination was not in the contract from day one.

**fix:** Add `{ limit, cursor, query, facets }` to the list methods now, before the
SDK and the MCP relay depend on them further. Server-side the text filter
(Postgres `tsvector` over title/abstract/note bodies — the `features/search`
worker already builds a client-side index that duplicates this). Render the first
50 and fetch more on scroll.

**severity:** `medium` now, `high` at 500+ papers — which is a normal library size.

---

## D4 · `papers-list.tsx` is 619 lines with four effects

**problem:** The single component owns: URL state, hydration state, a fetch
generation counter, filter state, layout state, Zotero sync, local Zotero import,
citation-alert checking, a compose modal with two modes, shared/read-only
resolution, recent-target bookkeeping and three view renderers.

**how discovered:** `wc -l apps/web/src/features/papers/ui/*.tsx` (papers-list 619,
papers-table 215, paper-note 422, paper-fields 489) and `grep -c useEffect` (4).
Comparable: `plan-screen.tsx` 688, `experiments-screen.tsx` 629,
`pdf-reader.tsx` 1188 with 7 effects.

**why it happens:** The "UI is presentation + view-state only" rule is written at
the top of the file and then fought by query-param detail views (C3), per-screen
filter state (C6) and per-screen sync actions (B6). When routing and state
management are missing at the system level, they get hand-written at the call site.

**fix:** Fix C3 and C6 and this file falls to roughly 150 lines of genuine
presentation. Extract `usePaperHydration(id)` only if C3's real routes are
rejected.

**severity:** `high` as a maintenance and bug source (the file literally names two
historical bugs in comments)

---

## D5 · Comments that document the flaws instead of the code

**problem:** Dozens of comments explain why something *used* to be broken —
"review-2 F6", "the class of bug review-2 F6 is about", "It used to be
`editorRoute || manual`, which made the hamburger a dead button", "the blanket
read bought a first-visit head start the other three mechanisms already cover",
"`get_public_keys` — a dead RPC, still granted". These are archaeology, and they
are the clearest available catalogue of where the design has bitten.

**how discovered:** reading `app-shell.tsx`, `papers-list.tsx`, `startup-provider.ts`,
`use-nav-groups.ts`, `0123_function_execute_grants.sql` — each has 3–8 paragraphs
of this.

**why it happens:** The project is TDD'd and reviewed, so every fix is justified in
place. That is good practice that has crossed a line: the "why" belongs in the
changelog and the commit message once the fix has landed; keeping it in the source
means the file's size no longer reflects its complexity and the next reader has to
read a story to learn a fact.

**fix:** Keep the invariant ("deliberately does NOT warm every list — see B/D3") in
one line; move the narrative to `CHANGELOG.md`. Add a lint rule (`check:hygiene`
already exists!) that caps comment-to-code ratio in `ui/`.

**severity:** `low`

---

# E. Accessibility & ergonomics

## E1 · Touch targets are 34px against a stated 44px minimum

**problem:** The UI spec says *"Touch target ≥44×44 on mobile"* (§1.4, for the
filters popover). The shipped button heights in `styles/buttons.css` are 32–36px
and the icon buttons are square at the same size. The mobile bottom tab bar items
are ~56px tall but their hit area is the icon column.

**how discovered:** `ui-spec.md` §1.4 vs `apps/web/src/app/styles/buttons.css`
and `nav.css`.

**why it happens:** The rule was written for one control and never applied as a
token. There is no minimum-size variable in the theme, so each stylesheet decides.

**fix:** One `--control-h` variable (36px desktop / 44px mobile) and one
`--hit` minimum of 44px enforced with a shared `IconButton` component that pads
its hit area even when the glyph is small.

**severity:** `high` on mobile, where the product is explicitly a PWA

---

## E2 · Two navigation landmarks, one of them unnamed in code paths

**problem:** `app-shell` renders `<nav aria-label="Primary">` (tab bar) and
`<nav aria-label="{group} views">` (sub-nav). The comment in `tabbar.tsx`
records that both were unnamed until recently ("a screen-reader user navigating
by landmark heard 'navigation, navigation'"). Additionally the primary nav link is
marked `aria-current="page"` when *any* of its group's items matches — so a screen
reader announces "Library, current page" while the actual current page is Papers.

**how discovered:** `tabbar.tsx` lines 54–76 and 101–116
(`aria-current={active ? "page" : undefined}` where `active` is
`group.items.some(...)`).

**why it happens:** Group-level links were given page-level ARIA. `aria-current`
is per-location, and a group is not a location.

**fix:** `aria-current` only on the item whose path actually matches (the sub-tab
already computes the correct "best match"; reuse it). For the group link use
`aria-expanded` on a disclosure if it expands, or nothing if it navigates.

**severity:** `medium`

---

## E3 · Status is carried by colour and by a dot

**problem:** Status pills are `tone-*` coloured with a same-colour dot and a
label. In the compact table view (`papers-table.tsx`) and on cards in board
columns, the label is dropped and the tone alone remains. Two of the four
vocabularies use red-vs-green for `done` vs `blocked`, which is the classic
red/green pair.

**how discovered:** `styles/cards.css`, `papers-table.tsx`, `Pill` markup with
`--st-*` semantic ramp.

**why it happens:** The semantic ramp (`--st-*` in `themes/common.css`) is
excellent — one status palette — but components are allowed to render tone
without text.

**fix:** Never render a status without its word (abbreviate instead: `OK`, `WIP`,
`BLK`). Keep the colour ramp. Add an icon only where the word would not fit.

**severity:** `medium`

---

## E4 · Keyboard shortcuts that the platform eats

**problem:** The workspace (A3) is unusable on the web because *"a browser tab
keeps Ctrl-W and Ctrl-N for themselves"*, and the desktop app exists partly to get
those back. Meanwhile the palette is `Ctrl/Cmd+K` (fine), swipe-between-sub-tabs
exists (fine), and `docs/using/desktop.md` is a whole document about one window.

**how discovered:** `apps/desktop/README.md`, `workspace/page.tsx`, README "The
desktop app".

**why it happens:** A shell was built around the web app to obtain capabilities
browsers withhold. That is legitimate — but the *design* then depends on
capabilities the primary platform lacks, which is why a whole nav item is dead (A3).

**fix:** Bind workspace commands that the browser does not reserve
(`⌘\` split, `⌘P` palette, `⌘E` explorer, `⌘K` link) and make `⌘W`/`⌘N`
*optional* enhancements documented in the shortcut sheet. Design for the browser
first, let the desktop app add.

**severity:** `medium`

---

# F. Data, privacy & trust

## F1 · The privacy model changed and the README claimed it had not

**problem:** The README contains a paragraph that had to be corrected: *"…
`0037`–`0041` and `0089`–`0095` created the client-side E2EE key tables; that
feature was dropped, nothing reads them, and **`0099` drops the whole schema** —
this paragraph used to claim no migration did."* A product that stores
"papers, notes, thesis chapters and lab data" now stores them **in plaintext**
(`0100_ai_proposals_plaintext.sql`, the shell comment *"E2EE unlock gate removed:
data is stored plaintext"*), while the top-line privacy copy still leads with
"encryption at rest" and "Not end-to-end encrypted" is one clause of one sentence.

**how discovered:** README "Database" section and "Privacy model" bullet;
`app-shell.tsx` line 51 comment; `0099`, `0100`, `0123`.

**why it happens:** The E2EE build (device KEKs, key wraps, transfer requests,
recovery credentials — nine tables) was finished, then dropped for a stated
reason, and the *documentation of the change* was done by editing a paragraph in
the README rather than by a release note a user would read. The comment even
admits the README had been wrong.

**fix:** (1) A **Settings → Privacy** page that states, in plain language and with
the schema as evidence: what is encrypted, at what layer, who can read it, what a
share link exposes, and what is *not* protected. (2) A `CHANGELOG` entry for the
E2EE removal written for users, not maintainers. (3) If the privacy disclaimer
gate (B2) is going to block first use, it must state the real model — it is the
only place most users will read it.

**severity:** `high` — this is the trust surface of a tool holding unpublished
research.

---

## F2 · Nine dead tables and a dead RPC shipped to production

**problem:** Covered in A6 with the schema detail. Its product consequence is
separate: `get_public_keys()` was still `grant`ed to `authenticated` after its
table was dropped, so *"any client with the call cached… gets a 500 from PostgREST
for a feature removed two years of migrations ago."*

**how discovered:** `0123_function_execute_grants.sql` §2, in the project's own
words.

**why it happens:** Grants and tables are dropped in different migrations and
nothing cross-checks that every granted function's dependencies still exist.

**fix:** The squash in A6. Plus a CI check that runs
`select proname from pg_proc where not exists (dependencies)` against a fresh
migration run — a dead RPC becomes a build failure rather than a runtime 500.

**severity:** `high`

---

## F3 · The privacy disclaimer can dead-end the user

**problem:** `startup-provider.ts` documents the exact failure: a failed settings
read is not the same fact as "no disclaimer row yet", and collapsing the two put a
user whose data API was unreachable *"in front of the disclaimer modal — whose
accept button then wrote through that same unreachable API and reported the raw
fetch failure, with no way forward."* The mitigation (`settingsError`) is a
careful, correct fix for a self-inflicted wound.

**how discovered:** `features/startup/startup-provider.ts` `StartupSnapshot`
docstring lines 27–35.

**why it happens:** A legal acceptance is modelled as a database row written on
first use, so the *legal gate* inherits every network failure.

**fix:** Accept the disclaimer in the auth flow (server action, one write, retried)
so it is settled before the app mounts. If it cannot be written, allow **read-only
mode** rather than blocking — the user can still see their work.

**severity:** `medium` (already mitigated, but the root cause remains)

---

## F4 · A `secrets/` directory ships in the repository tree

**problem:** The top-level tree contains `secrets/` (8 KB), `local-dev.example/`
and `infra/`. An 8 KB `secrets/` directory is small enough to be either
placeholders/`.gitignore`d contents or real credentials checked in by accident.

**how discovered:** `du -sh */` at the repository root lists `8.0K secrets/`.

**why it happens:** Local-development scaffolding lives beside product code with
no separation between "committed config template" and "not committed".

**fix:** Audit what is inside. Move any real material out, replace with
`secrets.example/`, add `secrets/` to `.gitignore`, and rotate anything that was
ever committed (git history retains it). Add `gitleaks` or `trufflehog` to CI.

**severity:** `medium` — could be `critical` depending on the contents; flagged
here as **needs verification** rather than asserted.

---

## F5 · Local mode switches the identity the row-level policies see

**problem:** `backend/providers/local/local-identity.ts` provides a synthetic
`LOCAL_USER` with `LOCAL_USER_ID`, and *"the row-level policies switch to on every
local query"*. It is a deliberate, well-documented design ("the identity is the
machine's"), but it means one code path treats identity as a claim and another as
a constant — and the seam is a localStorage flag
(`weaveforge.local-mode`) that a page can set.

**how discovered:** `local-identity.ts` (including its excellent docstring),
`providers/local/pglite-client.ts`, `providers/supabase/row-access.ts`.

**why it happens:** The desktop/offline build needed an account-less mode and the
RLS layer needed *some* user id.

**fix:** Make local mode a **build-time** or **install-time** decision, not a
runtime flag in `localStorage`. If it must be runtime, gate it behind the desktop
bridge so a web page cannot flip it, and show a persistent banner ("Working on
this computer — nothing is synced") because the user's mental model of "my
account" and the system's model of "this machine" have just diverged.

**severity:** `medium`

---

# G. Docs vs. product

## G1 · The design spec says the design is not decided

**problem:** `docs/internal/strategy/ui-spec.md` is titled "UI Inventory & Design
Spec" and its purpose line is *"hand this to a designer to produce a finalized,
consistent design so we stop changing things ad-hoc."* Section 4 is a
**14-item designer checklist** of things "to finalize": the top bar, the status
system, the button hierarchy, the add pattern, the filter pattern, the help
pattern, the card spec, the chip system, empty states, the three trees, graph
focus mode, chart design, the share dialog, and theming. That is the entire design
system, listed as undecided.

**how discovered:** `ui-spec.md` lines 4–5, §4 items 1–14.

**why it happens:** An inventory was written honestly and then the product shipped
from the inventory. Nothing forces the checklist to close.

**fix:** Turn §4 into the design system: for each of the 14 items, write the one
answer and encode it as a component + a token. Then delete the checklist and keep
the inventory as a generated artefact (the registry knows every screen and every
`NavItem`, so the inventory can be produced by a script instead of maintained by
hand).

**severity:** `high` — this single document is the root cause of C1, C2, C4, C5,
C6, A7 and E1.

---

## G2 · The docs say "5 destinations"; the app has 6 groups and 13 screens

**problem:** `ui-spec.md` §1.2 lists "Primary navigation (5 destinations)" and
sub-tabs "Papers · Notes · Graph · Lists" — the shipped nav groups are Library
(Papers, Notes, Wiki, Graph, Lists, Editor), Experiments (Experiments, Git), Plan
(Plan, Log), Report (Sections, Overleaf), plus Home and Search. `Overleaf`, `Wiki`
and `Editor` are undocumented; `Log` is documented as "Logbook"; §3.9 is titled
"Logbook" while the nav says "Log".

**how discovered:** comparing `ui-spec.md` §1.2/§3 against
`features/*/module.ts` `navItems` and `NAV_GROUP_META`.

**why it happens:** The spec is a snapshot and nothing regenerates it.

**fix:** Generate §1.2 and §3 from the registry (a script over
`buildModuleRegistry()`), and CI-check that no module declares a `NavItem` that
the spec does not mention. Names get one canonical spelling in `NAV_GROUP_META`
and every doc reads from it.

**severity:** `medium`

---

## G3 · 107 documents, 25.8k words, and the four questions a user asks are answered in none of them

**problem:** `docs/` has `using/`, `building/`, `running/`, `internal/` — 107
Markdown files in total including a changelog, contributing guide, security
policy and a privacy test matrix. There is no "How do I write my thesis in
WeaveForge", no "How do I do a systematic review", no "How do I organise a
reading week". The docs are organised by *who maintains the system* (using /
building / running), not by *what the researcher is trying to do*.

**how discovered:** `find docs -name '*.md' | wc -l` → 107;
`docs/README.md` index; the README's documentation table is explicitly ordered
"use it, host it, then build on it" — but "use it" is 8 documents about features
(citations, search, paste, co-editing, desktop, workspace folder, Python, MCP),
not about research.

**why it happens:** Documentation grew per subsystem, like the features.

**fix:** Three workflow guides written as narratives with screenshots of the
worked example from B3: **"From 300 PDFs to a reading list"**, **"A systematic
review"**, **"From runs to a results section"**. Everything else in `docs/using/`
becomes reference material linked from those three.

**severity:** `medium`

---

# Prioritised fix roadmap

Ordered by user-visible value per unit of work.

| # | Fix | Closes | Effort | Payoff |
|---|---|---|---|---|
| 1 | **Bulk paste-import** (BibTeX + DOI/arXiv/URL list, concurrent resolve, de-dupe, preview table) | B1 | M | Removes the single biggest time cost |
| 2 | **One onboarding path**: create account → workspace created → worked example loaded → `/today` | B2, B3 | M | First five minutes go from four gates to one |
| 3 | **Merge Vault + Wiki** into Notes, add backlinks | A1 | M | One place to write; the biggest IA win |
| 4 | **Real routes for detail views** | B4, C3, D4 | M | Deletes a class of bugs and makes links work |
| 5 | **One design system**: 2 modes, 1 scale, 1 status ramp, 1 icon set, 1 tree | C1, C2, A7, C5, E1 | L | Everything afterwards is faster |
| 6 | **One search** with two entry points | B8 | M | Learn it once |
| 7 | **`/today`** as the opinionated home; dashboard becomes an add-on | B10 | S | Answers "what do I do now" |
| 8 | **Capability-aware nav** + "Features" settings page | A3, B9 | S | The sidebar stops lying |
| 9 | **Schema squash** + dead-table/RPC CI check | A6, F2 | M | Readable schema, no runtime 500s |
| 10 | **`scope` on routes**, delete `ACCOUNT_ROUTES` | A5 | S | One source of truth |
| 11 | **Privacy page + user-facing changelog for the E2EE removal** | F1, F3 | S | Trust |
| 12 | **SDK first-run**: paste-ready snippet, `weaveforge login`, waiting state | B11 | S | Makes the SDK usable without the README |
| 13 | **Screening as a list mode** with PRISMA export | B7 | M | Wins the systematic-review audience |
| 14 | **3 workflow guides**, generated UI inventory | G1–G3 | M | Docs answer user questions |

---

# What a coherent version looks like

The four things asked for, stated as rules the codebase can enforce.

**Better design.** One token file. Two modes. One type scale (a serif display face
against a plain grotesque for UI text — the same contrast a lab notebook has
between its printed headings and your handwriting). One status ramp with six
states that every lifecycle maps onto. One icon set on one grid. One tree, one
card, one modal, one empty state. Twelve themes become two, three button sizes
become one, and the visual regression suite is two screenshots per screen instead
of zero.

**Intuitive usage.** The product answers "where am I, what can I do here, what
happens next" without a tooltip. Groups in the nav have a landing view. Detail
views are URLs. Every empty state names the next action and has the button for it
beside it. Nothing in the sidebar does nothing. Nothing is labelled with a noun
only the codebase uses.

**Ease of use, nothing complicated.** Four gates become one screen. Four note
products become one. Three searches become one. Import is a paste box. Filters are
in the URL. The heaviest workflow in the product — getting a bibliography in —
goes from 300 form submissions to one paste and one confirmation.

**Everything a user could want.** Bulk import (BibTeX/RIS/CSV); a screening mode
with PRISMA counts; citation tracking that runs without a tab open; compare runs
with overlaid curves and a params diff; word-count progress against targets; a
journal with hours for the supervisor report; export to BibTeX, Markdown, LaTeX
and a `.zip` workspace folder; print-clean report output; share links with expiry;
an SDK that configures itself.

**The design is coherent** when a new screen can be built without inventing
anything. Right now `ui-spec.md` §4 lists 14 places where the invention is still
pending — that checklist is the work.

WeaveForge — Design & Workflow Audit
Repository: Satwik-Miyyapuram/weaveforge · audited at merge 4577caa · 2,348 files

Method: full read of the app shell, module registry, every feature module.ts

and primary screen, the settings screen, the papers workflow end-to-end, all 132

SQL migrations, and the project's own internal docs (ui-spec.md, migrations

README). Every finding cites the files that evidence it.

Summary
Severity	Count
Critical	4
High	8
Medium	11
Low	5
Total	28
The five findings that matter most if you fix nothing else:

WF-01 — Six nested gates stand between sign-in and the first screen
WF-03 — Four parallel systems for 'markdown I wrote': Notes, Wiki, Editor, Logbook
WF-04 — 'Editor' is a permanent nav item that opens an apology screen on the web
WF-10 — No bulk import: a literature tool that accepts one reference at a time
WF-16 — 165k lines and a five-layer stack for a notes app (everything else is slower to fix while this stands)
What is genuinely good and should be kept: the skip-link and ARIA work in the shell, the semantic status-colour ramp idea (--st-*), RLS as the single access boundary, the Python SDK's decorator ergonomics, and the honest empty-state copy that names the control to click next.

Contents
Onboarding & first run — WF-01, WF-02
Information architecture — WF-03, WF-04, WF-06, WF-07, WF-08, WF-09
Library workflow — WF-10, WF-11, WF-12, WF-13
Settings & theming — WF-05, WF-14, WF-15
Architecture & code health — WF-16, WF-17, WF-18, WF-19, WF-20
Data & migrations — WF-23, WF-24, WF-25
Performance — WF-21, WF-22
Consistency & polish — WF-26, WF-27, WF-28
Onboarding & first run
WF-01 — Six nested gates stand between sign-in and the first screen
Severity: Critical

Problem: After login a new user must pass, in order: StartupProvider → PrivacyDisclaimerGate → ProfileProvider → ThemeSyncProvider → OrgSetupGate (create a lab / join with a code / continue standalone) → ProjectProvider → project picker — before seeing a single feature. Each gate is a full-screen interruption, and several depend on network reads that can each fail independently.

How discovered: Read of apps/web/src/app/app-shell.tsx lines 47–63: the provider pyramid is literally the component tree. The org gate is apps/web/src/features/org/ui/org-setup-gate.tsx; the startup provider even documents the failure mode where the disclaimer modal's accept button 'wrote through that same unreachable API and reported the raw fetch failure, with no way forward'.

Why: Each gate was added to solve a real problem (legal disclaimer, lab hierarchy, multi-project) but they were composed by stacking, never by design. Nobody owns the end-to-end first-run experience, so the sum is a gauntlet: a solo Masters student — the primary persona — is asked about labs, invite codes and org roles before they have added one paper.

Fix: Collapse to one screen. Sign-up ends on 'Name your project' with an inline privacy-consent checkbox; default everyone to standalone silently and move 'create/join a lab' into Settings → People where it is an upgrade, not a gate. Theme sync and profile loads should stream in behind the first screen, never block it.

Evidence:

apps/web/src/app/app-shell.tsx:47-63
apps/web/src/features/org/ui/org-setup-gate.tsx
apps/web/src/features/auth/ui/privacy-disclaimer-gate.tsx
apps/web/src/features/startup/startup-provider.tsx
WF-02 — First run lands on eleven empty screens; the demo seed only feeds the marketing page
Severity: High

Problem: A freshly created project shows empty Papers, Notes, Wiki, Graph, Lists, Experiments, Plan, Log, Report, Git and Dashboard. A complete showcase dataset exists in the codebase but is wired exclusively into the public /pitch page, never offered to a real new account.

How discovered: grep for 'showcase' across apps/web/src: features/showcase/* is imported only by app/pitch/page.tsx and app/pitch/graph.tsx. No onboarding path references seed-showcase.ts.

Why: The seed was built to make the pitch site look alive, and nobody connected it back to the actual first-run. Empty states alone cannot teach a nine-module product; the user has no picture of what 'good' looks like, so most modules are never discovered.

Fix: Offer 'Start with an example project' as a checkbox on project creation, reusing the existing showcase seed. Alternatively seed 3–4 objects per module with a dismissible 'sample' badge. The code already exists — this is a wiring change.

Evidence:

apps/web/src/features/showcase/infrastructure/seed-showcase.ts
apps/web/src/app/pitch/page.tsx:32
Information architecture
WF-03 — Four parallel systems for 'markdown I wrote': Notes, Wiki, Editor, Logbook
Severity: Critical

Problem: The Library group contains Notes (vault module, route /notes), Wiki (wiki module, /wiki) and Editor (editor-workspace, /workspace); Plan contains Log (logbook, /log). All four are places to write markdown. Notes and Wiki even share the same nav icon ('notes'), and the vault module's title is 'Notes' while its id is 'vault' and a legacy /vault redirect still exists.

How discovered: Read all feature module.ts files: vault/module.ts (title 'Notes', icon 'notes'), wiki/module.ts (icon 'notes'), editor-workspace/module.ts, logbook/module.ts. app/vault/page.tsx is a redirect stub marked 'Legacy route — Notes moved to /notes'.

Why: Features were added module-by-module under a plugin registry that makes adding a new top-level surface cheap — so every new writing idea became a new module instead of a view on the existing one. The registry optimises for adding modules, and the IA pays for it: a user cannot answer 'where did I write that?' without checking four screens.

Fix: Merge into one Notes system: a note is a note; a journal entry is a note with a date; a wiki page is a note with backlinks. Ship one editor. The logbook becomes a filtered timeline view of dated notes. This deletes three modules, three empty states and two icons' worth of ambiguity.

Evidence:

apps/web/src/features/vault/module.ts
apps/web/src/features/wiki/module.ts
apps/web/src/features/editor-workspace/module.ts
apps/web/src/features/logbook/module.ts
apps/web/src/app/vault/page.tsx
WF-04 — 'Editor' is a permanent nav item that opens an apology screen on the web
Severity: Critical

Problem: The Editor nav item renders for every web user, but /workspace mounts, shows a loader while it checks for the desktop bridge, then displays: 'The split-pane editor runs in the desktop app…'. A first-class navigation destination is a dead end for ~100% of browser users. Worse, editor-workspace/module.ts claims the workspace works 'in both builds' while workspace/page.tsx enforces desktop-only — the code disagrees with itself.

How discovered: Read apps/web/src/app/workspace/page.tsx (host check after mount → apology copy) against apps/web/src/features/editor-workspace/module.ts (comment: 'The split-pane editor, in both builds'). The module has no desktopOnly flag, so the registry cannot hide it.

Why: The module system supports desktopOnly gating (registry.ts checks mod.desktopOnly) but the flag was never set — likely because the web build once rendered it and the decision changed later in page.tsx instead of in the module manifest, leaving two sources of truth.

Fix: Either set desktopOnly: true so the item disappears from web nav entirely, or (better) ship the editor on the web minus the two shortcuts a browser reserves — the module's own comment says everything else works. A nav item must never lead to 'this doesn't work here'.

Evidence:

apps/web/src/app/workspace/page.tsx
apps/web/src/features/editor-workspace/module.ts
apps/web/src/registry.ts:24-33
WF-06 — Detail views are query-params, not routes, propped up by generation counters
Severity: High

Problem: Opening a paper is /papers?paper=<id> handled inside the 619-line PapersScreen with: a paperOpenGeneration ref, an appliedPaperFromUrl ref, a guestPaperIdRef mirroring state 'readable from inside the effect without adding it to the dependency list', and a keepOrDrop() routine whose comments cite the historical bugs it papers over ('review-2 F6', 'stranded on Opening paper…'). Back/forward behaviour needs three custom hooks (useDetailBack, useDetailPushFlag, rememberRecentTarget).

How discovered: Read apps/web/src/features/papers/ui/papers-list.tsx lines 170–260: the URL-sync effect and its escape hatches, plus the hooks it imports. The comments narrate at least three past regressions in this one code path.

Why: A list screen was made to double as a detail screen to keep filter state alive, so the URL, the list cache and the hydrated row must be reconciled by hand on every navigation. That reconciliation is exactly what the App Router gives for free as a nested route.

Fix: Make /papers/[id] a real route (Next parallel/intercepting routes can still overlay it above the list). The row cache lives in the layout, the detail page fetches its own object, and the generation counters, applied-key refs and keepOrDrop all get deleted.

Evidence:

apps/web/src/features/papers/ui/papers-list.tsx:170-260
apps/web/src/lib/hooks/use-detail-back.ts
WF-07 — Nav groups link to their first item and infer 'active' by longest URL prefix
Severity: Medium

Problem: The sidebar renders one link per group pointing at group.items[0]; which sub-tab is active is computed by filtering items whose path prefixes the URL, then sorting by path length ('best = matches.sort((a,b) => b.path.length - a.path.length)[0]'). /report vs /report/overleaf only resolve correctly because of that sort. The pill indicator is positioned by reading offsetLeft from the DOM with a resize listener.

How discovered: Read apps/web/src/app/tabbar.tsx:101-116 (group href = items[0]) and apps/web/src/app/sub-nav.tsx:56-61 (longest-prefix sort) and 27–45 (offsetLeft measurement + resize handler).

Why: Route→nav mapping was never modelled as data; it is re-derived from string prefixes at render time. Any new route pair that shares a prefix silently inherits ambiguous matching, and the DOM-measured pill drifts on font load and zoom.

Fix: Give each nav item an explicit match rule (exact or prefix) in the module manifest and compute the active item once. Draw the indicator with CSS (a border or layout-animated element on the active tab) instead of measuring offsets.

Evidence:

apps/web/src/app/tabbar.tsx:101-116
apps/web/src/app/sub-nav.tsx:27-61
WF-08 — Account-scoped routes are a hardcoded string list inside the shell
Severity: Medium

Problem: ACCOUNT_ROUTES = ['/settings', '/supervision', '/shared'] lives in app-shell.tsx with a long comment explaining the bug it fixed (these screens were unreachable without a selected project). Any future account-level route silently regresses unless its author knows to edit the shell.

How discovered: Read apps/web/src/app/app-shell.tsx:66-76. The comment itself documents that this was discovered as a bug after shipping.

Why: Modules declare routes, but not the routes' scope — so scope had to be bolted on where the symptom appeared (the shell) rather than where routes are declared (the module manifest).

Fix: Add scope: 'project' | 'account' to the module route declaration and let the shell read it. Deletes the list, the comment, and the failure mode.

Evidence:

apps/web/src/app/app-shell.tsx:66-76
WF-09 — Nav items appear and vanish based on env config and build target
Severity: Medium

Problem: The Git module renders in the nav only when config.gitRead.length > 0; modules also toggle on isOfflineBuild() and a feature allowlist. The same product shows different primary navigation on different deployments, and Overleaf is a permanent sub-tab of Report whether or not it is configured.

How discovered: Read apps/web/src/registry.ts:24-33 (moduleEnabled special-cases 'git') and features/report/module.ts (two navItems including Overleaf unconditionally).

Why: Feature availability and navigation presence were conflated. Hiding unconfigured features feels tidy, but users on different machines see different apps and docs/screenshots stop matching; meanwhile the opposite convention (Overleaf always visible) is used one module over.

Fix: Pick one rule: show every module and render a helpful 'connect GitHub/GitLab to use this' state when unconfigured. Consistent presence makes the product learnable and support answers stable.

Evidence:

apps/web/src/registry.ts:24-33
apps/web/src/features/report/module.ts
Library workflow
WF-10 — No bulk import: a literature tool that accepts one reference at a time
Severity: Critical

Problem: AddPaperForm accepts exactly one URL / arXiv id / DOI / Zotero key per submit. There is no BibTeX paste, no RIS, no multi-line paste, no file upload. A researcher arriving with 300 references from a proposal or another tool must either configure full Zotero sync or type them in one by one.

How discovered: Read apps/web/src/features/papers/ui/add-paper-form.tsx (single refValue field). grep for bibtex/ris/bulk across apps/web/src and packages/core/src: bibtex appears only in export paths (overleaf export, user-data export); no import parser exists.

Why: Import was designed around the sources the developer used (arXiv, Zotero sync) rather than around the migration moment every new user faces. BibTeX export exists because Overleaf needed it; BibTeX import was never anyone's blocking task.

Fix: One 'Import papers' box that accepts anything pasted: detect BibTeX entries, else split lines into DOIs/arXiv ids/URLs; resolve concurrently against Crossref/arXiv; report created/duplicate/unresolved counts. Accept .bib file drop as the same code path.

Evidence:

apps/web/src/features/papers/ui/add-paper-form.tsx
apps/web/src/features/overleaf/application/build-overleaf-export.ts (export-only bibtex)
WF-11 — The import form's source picker is overridden by the parser it feeds
Severity: Low

Problem: The add-paper form asks the user to choose URL / arXiv / DOI / Zotero, then parsePaperRef re-detects the real type from the pasted value and quietly wins ('The picker states intent; the parser decides what was actually pasted'). The user makes a choice that does not matter.

How discovered: Read add-paper-form.tsx:49-55 and its comment. The 'detected' hint under the field exists precisely to tell the user their selection was overridden.

Why: The picker predates the auto-detecting parser and was kept for familiarity, creating a control whose only function is to be corrected.

Fix: Delete the picker. One field, auto-detect, show the detected source as a badge. Fewer controls, same power.

Evidence:

apps/web/src/features/papers/ui/add-paper-form.tsx:49-55
WF-12 — Citation-alert polling piggybacks on shell mount with a discoverability apology
Severity: Medium

Problem: Every project switch fires checkCitationAlerts() from the app shell as a background browser task. When a user runs the manual check with nothing tracked, the toast has to explain where the feature even lives: 'open a paper and use the bell icon to watch it' — the code confesses the bell is undiscoverable.

How discovered: Read app-shell.tsx:113-129 (poll on project change) and papers-list.tsx checkCitationAlerts message (the 'name the control' comment).

Why: Background jobs were put in the only always-running place available to a fully client-side app — the shell — and the tracking toggle was buried as an icon on the paper detail with no entry in the papers list or settings.

Fix: Move polling server-side (cron / scheduled function) so alerts arrive without a browser open. Surface 'Watch for citations' as a labelled action on paper rows and in the paper detail header, not only an unlabelled bell.

Evidence:

apps/web/src/app/app-shell.tsx:113-129
apps/web/src/features/papers/ui/papers-list.tsx (checkCitationAlerts)
WF-13 — Three search systems with separate indexes and ranking
Severity: Medium

Problem: There is the Ctrl-K jump palette (jump-to-palette.tsx), a per-screen rankedFilter + useSearchIndex pass on Papers/Lists/etc., and the full search documented in docs/using/search.md — three code paths that can rank the same query differently. Search history persists under the key 'thesis.search.history'.

How discovered: Read components/jump-to-palette.tsx, features/search/application/rank-filter.ts usage in papers-list.tsx:82-84, and docs/using/search.md.

Why: Each search grew where it was needed. Without one search service, every surface re-solved indexing and ranking, and users get different results for the same words depending on which box they typed into.

Fix: One search facade: the palette, the screen filters and the search page all query the same index with the same ranking; screen filters just pre-scope by kind. Migrate the localStorage keys off the dead 'thesis.' prefix while touching it.

Evidence:

apps/web/src/components/jump-to-palette.tsx:54
apps/web/src/features/papers/ui/papers-list.tsx:82-84
docs/using/search.md
Settings & theming
WF-05 — Settings is 14 tabs, including one named 'Paste'
Severity: High

Problem: settings-screen.tsx defines tabs: Account, Org, Appearance, Search, Paste, Editor, Ink, Folder, AI, Tokens, Integrations, Sync, Data, Updates — 14 sections rendered by one 591-line component over 18 panel files. 'Paste', 'Ink', 'Folder' and 'Sync' are meaningless labels until you already know the feature; the ui-spec's own designer checklist admits the area was never designed.

How discovered: Read apps/web/src/features/settings/ui/settings-screen.tsx lines 50–63 (tab list) and the ui directory (18 panel components). docs/internal/strategy/ui-spec.md §4 lists 14 unfinished cross-cutting design decisions.

Why: Every integration and toggle got its own top-level tab because adding a tab was the path of least resistance in a flat tab array. Settings became the junk drawer where each feature ships its config without an information architecture pass.

Fix: Regroup into 4–5 sections users can predict: Account (profile, tokens, data export, delete), Workspace (people/org, sharing), Appearance, Integrations (Zotero, Git, Overleaf, AI, Mattermost together), Advanced. Rename by user intent, not by feature codename — 'Paste' becomes a toggle inside the editor section.

Evidence:

apps/web/src/features/settings/ui/settings-screen.tsx:50-63
apps/web/src/features/settings/ui/ (18 panels)
docs/internal/strategy/ui-spec.md §4
WF-14 — 17 themes × 3 densities × 2 surface styles = 102 untested visual combinations
Severity: High

Problem: 16 theme CSS files ship (amoled, dracula, honey, latte, mocha, two confettis, two pastels, two vivids, contrast…); theme.ts registers 17 options plus Compact/Default/Comfortable control sizes plus Borderless/Bordered surfaces. The project's own ui-spec lists 'ensure the final design holds up across all light/dark variants' as an open designer task — i.e. the combinations are shipped but not verified.

How discovered: ls apps/web/src/app/themes (16 files) and read apps/web/src/lib/theme/theme.ts:42-95; docs/internal/strategy/ui-spec.md §4 item 14.

Why: Themes are fun to add and each one is one CSS file, so they accumulated. But every semantic colour decision now needs 17 answers, which is why status-pill colours drifted per feature (the ui-spec's item 2 asks to unify them).

Fix: Ship light + dark, designed and tested, with one accent variable users can pick. Keep a documented CSS-variable contract so the community can build themes out of tree. Delete density/surface toggles unless analytics prove use.

Evidence:

apps/web/src/app/themes/ (16 css files)
apps/web/src/lib/theme/theme.ts:42-95
docs/internal/strategy/ui-spec.md §4
WF-15 — 10,700 lines of CSS across 55 files with per-feature stylesheets
Severity: Medium

Problem: apps/web/src has 55 CSS files totalling ~10.7k lines: one per feature (papers.css, git.css, org-chart.css…) plus base layers plus 16 theme files. The ui-spec's checklist items — 'one card spec', 'one chip system', 'align three tree UIs' — are the direct symptom: parallel stylesheets meant parallel components.

How discovered: find + wc over apps/web/src/**/*.css (55 files, 10,722 lines); ui-spec §4 items 7, 8, 10 name the resulting divergences.

Why: Feature-modular CSS mirrored the feature-modular code, but styles are a shared vocabulary, not a feature concern. Without enforced primitives, each module restyled cards, chips and trees from scratch.

Fix: Extract the primitives the ui-spec already lists (card, pill, chip, tree, empty state) into one design-system layer; feature CSS may only compose them. Delete per-feature colour definitions in favour of the semantic ramp.

Evidence:

apps/web/src/app/styles/ (29 files)
apps/web/src/app/themes/ (16 files)
Architecture & code health
WF-16 — 165k lines of TypeScript and a five-layer indirection stack for a notes app
Severity: High

Problem: The web app is 133,890 lines of TS/TSX in 879 non-test source files, plus a 31,813-line framework-agnostic core package. A paper travels UI → facade (container/facades/papers.ts) → use-case class (LoadPapersScreenUseCase) → repository interface → Supabase adapter — five files to read a list. Custom architecture linters (check:solid, check:dry, check:boundaries, check:hygiene) exist to police the layering.

How discovered: LOC counts via find/wc on apps/web/src and packages/core/src; traced the papers read path from papers-list.tsx through container/facades/papers.ts into packages/core; package.json scripts list the four custom lint gates.

Why: TDD+SOLID was adopted as an identity (the README leads with it) rather than as a tool, so ceremony scaled with dogma instead of with need. The cost is real: contribution requires learning a bespoke architecture and passing bespoke linters before fixing a typo.

Fix: Collapse layers where there is exactly one implementation: screens call typed data functions directly; keep interfaces only at genuine seams (storage providers, integrations). Target: one file to read for one screen's data. Retire the custom linters that exist to defend the deleted layers.

Evidence:

apps/web/src/container/facades/ (23 facades)
packages/core/src/ (335 files)
package.json (check:solid, check:dry, check:hygiene)
WF-17 — A codegen script writes both the module registry and the Next.js page files
Severity: Medium

Problem: scripts/generate-deployment-registry.mjs emits generated-registry.ts AND stub page.tsx files ('AUTO-GENERATED — do not edit') that just re-export each feature's screen. Routing truth lives in three places: the module manifest, the generated registry, and the app/ directory Next actually reads — while NAV_GROUP_META and NAV_GROUP_ORDER are still hardcoded by hand in registry.ts anyway.

How discovered: Read apps/web/src/deployment/generated-registry.ts header, app/notes/page.tsx and app/wiki/page.tsx (identical generated stubs), and registry.ts:15-22 (hand-maintained group metadata beside the generated module list).

Why: The plugin architecture wanted routes declared in manifests, but Next requires files on disk, so a generator bridges the gap — buying indirection without removing any manual step (groups, icons and order are still edited by hand).

Fix: Let the app directory be the routing truth (it must exist anyway) and reduce the registry to what genuinely varies per deployment: nav labels/order and feature flags. Delete the generator and the do-not-edit stubs.

Evidence:

apps/web/src/deployment/generated-registry.ts
apps/web/src/app/notes/page.tsx
apps/web/src/registry.ts:15-22
WF-18 — A render-time global container guarded only by a comment
Severity: Medium

Problem: useModuleRegistry() calls getContainer() during render and documents its own safety condition: 'these components only mount inside AppShell, below PrivacyDisclaimerGate… Nothing that renders above that gate may call this hook.' Nothing enforces that; a future component mounted one level too high throws at runtime.

How discovered: Read apps/web/src/lib/hooks/use-nav-groups.ts:21-27 — the contract is stated in prose, with an empty-deps useMemo relying on the container being constructed exactly once.

Why: The DI container is initialised asynchronously by a gate component, so anything rendering earlier races it. The invariant lives in a comment because the architecture has no place to put it.

Fix: Provide the container through React context whose provider is the thing that awaited ensureContainer(); consumers get a type-safe hook that cannot exist outside the provider. The comment becomes a compile-time guarantee.

Evidence:

apps/web/src/lib/hooks/use-nav-groups.ts:21-27
apps/web/src/bootstrap.ts
WF-19 — Comments narrate the code's history instead of its behaviour
Severity: Medium

Problem: Across the shell and screens, long comments explain what the code used to do and which bug that caused: 'It used to: ten tables… ~30 requests' (app-shell), 'It used to be editorRoute || manual, which made the hamburger a dead button' (app-shell), 'Falling back to papers.find(...) handed it a projection with no metadata — the class of bug review-2 F6 is about' (papers-list). Migration 0123 contains a ~90-line essay about migrations 0037/0079/0081/0099.

How discovered: Read app-shell.tsx:88-112, papers-list.tsx:171-181, supabase/migrations/0123_function_execute_grants.sql. The pattern is codebase-wide.

Why: Fear of regression without regression tests at the right level: the history is kept in prose because deleting it feels like losing the lesson. But readers must now parse the past to find the present, and the comments go stale the moment the code moves again.

Fix: Move 'why it changed' into commit messages and ADR files; keep in-code comments about current behaviour only. Where a comment guards a regression, convert it into a test with the old bug as its name.

Evidence:

apps/web/src/app/app-shell.tsx:88-112
apps/web/src/features/papers/ui/papers-list.tsx:171-181
supabase/migrations/0123_function_execute_grants.sql
WF-20 — Dev/test routes ship inside the production route tree
Severity: Medium

Problem: src/app contains test/ (unit tests for shell utilities) and pitch/test/ inside the Next.js app directory. Route-adjacent test folders in app/ risk becoming reachable routes when a page file lands there, and they ship noise into the routing tree that every reader must mentally filter.

How discovered: Directory listing of apps/web/src/app shows test/ and pitch/test/ alongside real routes.

Why: Colocation convention ('tests live next to code') was applied inside a directory where the framework assigns meaning to file placement.

Fix: Keep tests colocated everywhere except app/: move these to a sibling __tests__ or the feature folder they exercise. Add a lint rule rejecting non-route files in app/ beyond Next's known set.

Evidence:

apps/web/src/app/test/
apps/web/src/app/pitch/test/
Data & migrations
WF-23 — The migration chain builds and then demolishes an entire E2EE feature
Severity: High

Problem: Migrations 0037–0041 and 0089–0095 create nine client-side E2EE tables (user_keys, project_keys, resource_keys, key_epochs, device wraps, transfer requests, recovery secrets); 0099 drops the whole schema; 0123 then removes get_public_keys(), a dead RPC that remained callable by authenticated users and returned 500s for two years of migrations. Every new deployment replays creation, hardening (0078–0088 RLS work partially over these tables) and demolition of a feature that no longer exists. The README even corrects its own earlier false claim about this ('this paragraph used to claim no migration did').

How discovered: Read supabase/migrations/0037-0041, 0089-0095, 0099_drop_e2ee_schema.sql, 0123_function_execute_grants.sql (which documents the dead-RPC window), and the README paragraph.

Why: Append-only migration discipline was kept absolute even after a feature was amputated. Correct for a live database with data; pointless for fresh installs, which are the self-hosting story the project sells.

Fix: Squash to a baseline schema (schema.sql) for new installs, keeping the historical chain only for pre-existing databases. CI should install from the baseline so drift is caught.

Evidence:

supabase/migrations/0099_drop_e2ee_schema.sql
supabase/migrations/0123_function_execute_grants.sql
supabase/migrations/README.md
WF-24 — Live tables no application code references
Severity: Medium

Problem: Cross-referencing the 54 CREATE TABLE statements against apps/ and packages/ source: paper_locus_anchors and share_link_rate_limits are created (0106, 0048-ish) and never read or written by any shipped code path (locus references exist only in pitch-site scenery and a reader link-builder that writes nothing). Dead tables still get RLS policies, indexes and hardening passes in later migrations.

How discovered: Scripted grep of each table name over apps/web/src and packages/core/src; verified the paper_locus_anchors hits are pitch/scene components and a link formatter only.

Why: Tables were added ahead of features (or survived feature removal) and nothing audits schema-to-code reachability.

Fix: Drop unreferenced tables in the next migration; add a CI script that greps every table name against src and fails on zero references.

Evidence:

supabase/migrations/0106_paper_locus_anchors.sql
supabase/migrations/0078_rate_limit_and_invite_table_hardening.sql
WF-25 — Two backend shapes, two-phase migrations, split auth — the self-host path is an expedition
Severity: High

Problem: Self-hosting requires: Postgres 16 + PostgREST + Realtime + MinIO behind Caddy via docker-compose, while auth stays on hosted Supabase with JWT public keys copied into JWT_KEYS; migrations must be applied from migrations-self-hosted-postgres/ FIRST, then the 132-file main chain in order; blob storage optionally becomes a 'tiered' R2-hot/MinIO-cold provider. Miss the ordering and the chain fails.

How discovered: README 'Database and auth' section, docs/running/backend.md, supabase/migrations/README.md, infra/oci/docker-compose.yml.

Why: The stack mirrors the author's own OCI migration journey rather than a designed self-host product. Auth remaining on supabase.co also means 'self-hosted' still has a hosted dependency — surprising for the privacy-positioned pitch.

Fix: Ship one docker-compose that brings up everything including auth (GoTrue or built-in email auth), applies a squashed baseline schema on first boot, and needs exactly two env values. Treat the OCI split as an advanced doc, not the default path.

Evidence:

infra/oci/docker-compose.yml
supabase/migrations-self-hosted-postgres/
docs/running/backend.md
Performance
WF-21 — groupForPath rebuilds the whole module registry as a default argument
Severity: Low

Problem: groupForPath(pathname, groups = buildModuleRegistry().navGroups) constructs the entire registry — module filtering, group assembly — on every call made without the second argument, at render frequency.

How discovered: Read apps/web/src/registry.ts:96-102.

Why: A convenience default hid a construction cost; callers cannot see they are paying it.

Fix: Remove the default; require callers to pass the memoised registry from useModuleRegistry().

Evidence:

apps/web/src/registry.ts:96-102
WF-22 — Fully client-rendered app compensating with a hand-rolled cache hierarchy
Severity: High

Problem: Every screen is a client component fetching from the browser; first paint requires downloading the container graph ('~17 JS chunks'), then auth, settings, org batch and screen data over the network. To make this bearable the app built three caching layers — in-memory screen cache, IndexedDB persistence, and hover-prefetch (prefetchScreenForPath) — plus single-flight dedup, all custom.

How discovered: Read startup-provider.tsx (chunk-count comment, the serial critical path analysis), lib/cache/* (screen cache, single-flight, prefetch-screen), and the app-shell comment about the removed 30-request blanket warm.

Why: Choosing Supabase-from-the-browser as the only data path ruled out server rendering, so every performance problem had to be solved with client caching — recreating what a server-rendered framework provides natively.

Fix: Move reads to the server (RSC/route handlers) so screens arrive rendered with data; keep client state only for interactivity and live collab. The three cache layers shrink to framework defaults.

Evidence:

apps/web/src/features/startup/startup-provider.tsx:120-150
apps/web/src/lib/cache/
apps/web/src/app/app-shell.tsx:104-112
Consistency & polish
WF-26 — The product's old name 'thesis' fossilised in user-facing storage keys
Severity: Low

Problem: Persisted browser state uses keys like thesis.papers.status, thesis.papers.view, thesis.search.history — the pre-rename product name. Any future cleanup either abandons users' saved filters/history or must ship a key-migration shim forever.

How discovered: grep for 'thesis.' in apps/web/src: papers-list.tsx:56-60, jump-to-palette.tsx:54, and others.

Why: A product rename that stopped at display strings; storage identifiers were never versioned or namespaced behind a constant.

Fix: Centralise storage keys in one module with a version prefix (wf.v1.*), read-migrate-delete old keys once. Cheap now, compounding later.

Evidence:

apps/web/src/features/papers/ui/papers-list.tsx:56-60
apps/web/src/components/jump-to-palette.tsx:54
WF-27 — Account controls remount as different components per breakpoint
Severity: Low

Problem: The org/project switchers and header actions render inside TabBar on desktop but inside a shell 'brand row' on mobile, chosen by a JS breakpoint hook — with comments in both files warning that the previous both-mounted-hide-one-with-CSS approach created duplicate switcher state. Crossing the breakpoint remounts the controls and drops any open menu state.

How discovered: Read app-shell.tsx:164-176 and tabbar.tsx:32-37 — the coordination is documented in mirrored comments on both sides.

Why: Layout variation was solved by conditional mounting of stateful components instead of by styling one instance, after the CSS approach was implemented incorrectly (two mounted copies) rather than fixed.

Fix: Render the switchers once in a layout slot; move them between visual positions with CSS grid/container queries. One instance, one state, no breakpoint hand-off.

Evidence:

apps/web/src/app/app-shell.tsx:164-176
apps/web/src/app/tabbar.tsx:32-37
WF-28 — Papers offers three layouts (cards/list/board) with unequal capabilities
Severity: Low

Problem: The papers screen persists a cards/list/board choice. The board is a kanban over reading status — a workflow board for a four-state label — and each layout renders through a different component (PaperCard, PapersTable, CardColumns) with drift risk for actions available per layout.

How discovered: Read papers-list.tsx:35,60 (PapersLayout type, persisted view) and the three render components it imports.

Why: View multiplicity was added as a feature checkbox; kanban-for-status looks powerful in screenshots but drag-to-change-status duplicates a one-click dropdown while tripling surface area to maintain.

Fix: Keep table + cards sharing one row-action set; drop the board unless usage data defends it. Fewer parallel renderings of the same data, fewer inconsistencies.

Evidence:

apps/web/src/features/papers/ui/papers-list.tsx:35
apps/web/src/features/papers/ui/papers-table.tsx
apps/web/src/components/card-columns.tsx
Closing note
The codebase is unusually disciplined — tests, boundary linters, exhaustive comments — and that discipline is aimed at the wrong target. The effort spent keeping five layers honest would, redirected, merge the four note systems, ship bulk import, and cut onboarding to one screen. The product's problem is not quality; it is that nobody is playing the role of the user who just wants to file a paper and write a paragraph.