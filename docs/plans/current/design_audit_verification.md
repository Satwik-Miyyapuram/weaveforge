# design_audit_1.md — verification and conflicts

Same treatment as `audit_2.md`: this file is **two models' output concatenated**,
so it repeats itself and argues with itself. Every claim below was re-checked
against the tree at the branch point.

Two artifacts go with this document, and they answer different questions:

* `design_decisions.html` — **the A/B card mock**. Six conflicts, drawn in the
  app's palette, for picking between the two models' answers.
* `design_current_and_fixes.html` — **the current design, with the fixes**. Built
  after reading the real components, it shows each surface as it ships today beside
  the proposed change and flags where the audit described an older app. Read this
  one first: several "conflicts" changed shape once the real screen was in front of
  me, and it reduces six decisions to five.

## Correction to this document's first draft

The first version repeated the audit's framing that Settings is "one seven-section
scroll". It is not, and that reframing moves the decision.

`settings-screen.tsx:49-64` declares **fourteen** tabs — Account, Org, Appearance,
Search, Paste, Editor, Ink, Folder, AI, Tokens, Integrations, Sync, Data, Updates —
rendered at `:318` as `<div className="seg settings-tabs" role="tablist">` with
`role="tab"` / `aria-controls` and `role="tabpanel"` / `aria-labelledby` per pane.

So `D-11` / `F06` / `F24` ("make Settings tabbed") is **already implemented, and
exceeded**: there is a `Folder` tab, which closes `F31` / `F-31` ("the
workspace-folder mirror is only in docs"), and a `Data` tab, which is where Model 2
wanted one. What is actually wrong is that fourteen items sit in a
horizontally-scrolling strip whose scrollbar is hidden, and that `Delete account`
is in the *first* tab. The decision is the **grouping**, not the existence, of tabs.

## Shape of the file

| Block | What it is |
| --- | --- |
| `D-01`…`D-18` | Model 1, structured objects, 18 findings |
| `F01`…`F34` | Model 2, prose sections, 34 findings |
| `F-01`…`F-40` | Model 2 again, a *different* numbering scheme, structured objects, 40 findings |

So `F01` and `F-01` are different findings, from the same model, written twice.
`F11`/`F-19` and `D-01` are the same finding three times. That is the source of
most of the apparent volume: **92 items, roughly 45 distinct**.

## Verified against the tree

| Claim | Where | Verdict |
| --- | --- | --- |
| "Eleven hand-written theme blocks" (D-06), "7 themes" (F23) | `lib/theme/theme.ts:12-31` has **6 light + 8 dark = 14** registered ids, and there are 14 theme stylesheets | **both wrong** — Vivid and Pastel (light and dark) are not mentioned in either audit |
| "`--st-*` ramp exists, nothing makes screens use it" (D-01, F11, F19) | `themes/common.css` maps the whole `--st-*` family onto `--s-*`; the ramp is centralised already | **partly stale** — the ramp exists and is aliased; what is missing is a component and a gate, which is what the fix asks for |
| "Delete is a red 14px text link beside edit" (D-05, F13, F-20) | `entity-card.tsx:114-124` renders `entity-icon-btn danger card-del` — an **icon button** with `aria-label={deleteAriaLabel}` and `title`, `flex: none`, pinned left, with status and actions grouped in `.card-foot-right` | **wrong** — the described text link does not exist. The verified residue is footer *order* (delete first, on the left) and that no screen passes a real `deleteAriaLabel` |
| "No shared card primitive" (F13, F20) | `apps/web/src/components/entity-card.tsx` exists, documents its own layout, and is used in **8 files** | **stale** — the primitive exists |
| "Empty states are per-screen strings" (D-08, F15, F21) | `components/empty-state.tsx` exists with two variants (`first-run`, `no-results`) plus `ClearFiltersButton`, used in **13 files** | **partly stale** — one component, widely used; what is missing is the loading/error half |
| "No `StatusPill`" | `StatusPill` **does** exist — in `apps/pitch/src` (`chrome.tsx`, `page.tsx`, `reader-scene.tsx`, `story.tsx`), not in the product | **new finding**: the canonical primitive was written for the marketing site and never moved into the app |
| "Three tree UIs" (D-02, F12, F18) | Four, in fact: reading lists, report outline, org chart, **and the vault note tree** — which is the one that computes `ownedIds` for the whole screen. Only `explorer-panel.tsx` carries `role="tree"` | **understated** by model 1, and F12 says four while calling it "three tree UIs" |
| "Focus mode is on another branch" (D-14, F34) | `features/relations/ui/graph-screen.tsx` **ships focus mode**: `const [focus, setFocus] = useState(false)` (:68), a `graph-focus-btn` (:301), a `.graph-focus-bar` (:400), `GraphCanvas fill` (:234) | **stale** — the largest single correction. Both models and the ui-spec (`§3.5`) describe a branch that has landed |
| "No reduced-motion story" (D-17) | `prefers-reduced-motion` appears in **9 stylesheets** including `motion.css` and `base.css` | **partly stale** — the media query exists; the `auto/on/off` three-state setting is genuinely absent |
| "No contrast assertion across themes" (D-06) | `npm run check:contrast` exists and **passes today** ("0 normal-text pair(s) below AA") | **stale** — the gate is already built and green |
| "Settings is long — candidate for tabs" (D-11, F06, F24) | `settings-screen.tsx:49-64` — **already 14 tabs** with full ARIA wiring | **wrong**, and the fix was already built. The decision is the grouping |
| "No date / kind filter on the Logbook" (D-10, F14) | Consistent between the models | **real**, triage only |
| "760px applied to prose, a runs table and a force graph" (D-03) | `ui-spec.md:115` states the rule; the graph now has a full-bleed focus mode, which softens the graph half | **real** for the table and dashboard, **partly stale** for the graph |
| "Four status vocabularies with per-feature pills" (D-01, F11, F19) | Vocabulary split is real and consistent across all three write-ups | **real** |

## What the two models agree on (same finding, written twice)

Nothing here needs a decision — it needs the **duplicate deleted**. These are the
items where three of the write-ups say the same thing, so the count of "92
findings" overstates the work considerably:

| Topic | Model 1 | Model 2 (prose) | Model 2 (objects) |
| --- | --- | --- | --- |
| Status vocabulary / shared ramp | D-01 | F11 | F-19 |
| Trees not aligned | D-02 | F12 | F-18 |
| Card anatomy drift | — | F13 | F-20 |
| Filters in a popover only | D-10 | F14 | — |
| Empty/loading/error states | D-08 | F15 | F-21 |
| Theme fragility, no gate | D-06 | F16 | — |
| Modal for everything | — | F18 | F-25 |
| Settings too long | D-11 | F06 | F-24 |
| People buried in Settings | F02 / F09 | F09 | — |
| Heading help `?` | D-09 | F10 | F-26 |
| Graph focus mode on a branch | D-14 | — | F-34 |
| Meta curve chart undesigned | D-04 | F22 | F-21 (F-22) |
| Zotero sync with no preview | — | F22 | — |
| Co-editing contract inconsistent | — | F24 | F-24 |
| Search undiscoverable | — | F26 | F-32 |

## Where they contradict each other — the A/B decisions

These are the ones that get a mock, because the two write-ups want *different
things* and the choice is yours. The interactive A/B mock is
`docs/plans/current/design_decisions.html`; `design_current_and_fixes.html` shows
each of these as it ships today beside the proposed change.

**Two of the six changed shape once the real screens were read**, so this section
records the conflict as written *and* what it actually reduces to:

| As written | What it reduces to |
| --- | --- |
| **A ·** how many settings tabs | The screen already has 14. Not "should it be tabbed" but "how should 14 be grouped" |
| **B ·** destroy: icon or overflow | Delete is *already* a named icon button, not a text link. The open half is footer order and no screen passing a real `deleteAriaLabel` |

### A · Settings: how many tabs, and what are they? (D-11 vs F06 / F24 / F-06)

**Corrected:** both models are arguing about a screen that no longer exists. See
"Correction to this document's first draft" above — there are 14 tabs today. The
comparison below is therefore *not* "add tabs"; it is which of the two proposed
groupings should replace the fourteen-item strip.

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Count | **Six** | **Seven**, with a left rail **and a search field**, each pane deep-linkable (`#/settings/integrations`) |
| Set | Account · People · Appearance · Tokens · Integrations · Privacy | Workspace · Account · Appearance · Integrations · SDK & Tokens · Data · Privacy |
| Where "Delete account" goes | Privacy, alone, behind a type-the-name confirm | Privacy |
| Where the org chart goes | People (its own tab) | Workspace (folded in with members and codes) |
| Which tab holds sync connectors | Integrations | none named — sync is inside Integrations |
| Extras | Tabs are a real tablist (arrow keys, `aria-selected`), selection in the URL | A setup-status header (`Zotero ● Git ○`) |

Neither count is right for a 14-item inventory: Model 1's six would hold
`Editor`, `Paste`, `Ink`, `Search` and `AI` nowhere, and Model 2's seven would drop
`Updates`. The grouping in `design_current_and_fixes.html` maps all fourteen onto
six — **Account** (Account, Updates) · **Workspace** (Org, Folder, Data) ·
**Writing** (Editor, Paste, Ink, Search) · **Appearance** · **Integrations** (AI,
Tokens, Integrations, Sync) · **Privacy** — which is Model 2's shape with the
coverage Model 1 implies.

**The disagreement that matters:** whether the *lab/workspace* is one tab
("Workspace": project, members, invite codes) or two ("People" separate from the
project controls). Model 1 also names a Tokens tab that Model 2 calls "SDK &
Tokens", and Model 2 adds a Data tab (export ZIP, folder, backups) that Model 1
does not have at all.

**My recommendation: B, minus the search field.** Seven tabs is over the
seven-plus-or-minus-two line, and a settings search that has to jump between
panes is a symptom of too many panes — but the *set* is better: folding
members/invites into Workspace matches the mental model ("my project and who is
in it"), and the Data tab is where the folder mirror belongs, which is a real
feature (F31/F-31) currently buried in docs. Model 1's `aria`/URL requirements
should be taken either way; they are not alternatives.

### B · Destructive actions: icon-only, or icon plus label? (D-05 vs F13 / F-20)

**Corrected:** the premise is wrong. `entity-card.tsx` **already** renders a
`entity-icon-btn danger card-del` — an icon button, `aria-label`-named, with a
`danger` class — not "red 14px text beside edit". The audit is describing the
card as it was before the shared primitive landed.

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Control | A 44×44 **icon** button with an `aria-label` naming the object ("Delete log entry for 12 Feb"), separated from the other foot actions by a rule and 16px | Delete **moves into an overflow menu** (`⋯`) with a confirm, so it is never a sibling of edit |
| Signal | Icon **plus** colour **plus** the confirm naming the consequence | The overflow itself is the distance; confirm on top |
| What it fixes | The mis-tap: it is no longer one link away from `edit` | The visual noise: five foot actions become three |
| **Already true?** | **Yes, mostly** — the button exists, is named, and is `flex: none` at the far left | No — there is no overflow today |

So this is no longer a conflict between two proposals; it is one shipped decision
(A) versus one refinement (B). What is genuinely open:

1. **Footer order.** The primitive's own header comment documents the layout as
   `delete ……… status · actions · open` — delete is the *first* thing in the row,
   which is the wrong end for a destructive control.
2. **No screen passes a real label.** `deleteAriaLabel` defaults to `"Delete"`, and
   the call sites use the default, so a screen reader hears "Delete" with no object.

**My recommendation: take both.** Move delete into the overflow (B) *and* keep
A's rule that the control names what it destroys and the confirm names the
consequence. Those are accessibility requirements rather than layout preferences,
so they hold whichever placement you pick.

### C · The metric curve: how much smoothing, and are scales shared? (D-04 vs F22 / F-21)

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Smoothing | **None by default**; never a moving average wider than 5 points, and if it ships it must be labelled on the axis | A **smoothing slider**, and a log toggle |
| Overlaid runs | One shared y-domain across runs, with an explicit "free scale" opt-out | Legend with toggleable runs; no scale rule stated |
| Palette | An 8-colour categorical ramp verified at 3:1 against both `--surface` and `--surface2` | Okabe-Ito or ColorBrewer Set2 |

**The disagreement:** a *slider*. A smoothing control invites a researcher to
smooth away the divergence they are looking for, and Model 1's argument is the
strong one — the metric-chunking work in the code audit chose a stride over an
average for exactly this reason, so a smoothing slider in the UI would
reintroduce at the chart what the query layer was careful to avoid.

**My recommendation: A's defaults with B's palette options, and no slider.** Ship
the log toggle and the shared y-domain; if smoothing is ever needed, make it a
named preset ("light") rather than a continuous control, and label the axis.

### D · Navigation grouping: how many destinations, and grouped by what? (F05 vs F04 vs F-04)

| | A — Model 2 (F05) | B — Model 2 (F-04) — same file, different answer | C — Model 1 |
| --- | --- | --- | --- |
| Mobile bar | Keep four destinations, restore a real `h1` per view and add breadcrumbs | **Five task groups**: Capture · Read · Run · Write · Share | Keep `Library`/`Experiments`/`Plan`/`Report`, split Library into Library + Notes, make Graph full-bleed |
| Grouping idea | positional (current) | by what you *do* | by what the thing *is* |
| Git / Log | stay as sub-tabs | folded into Run / Capture | — |

This is the sharpest self-contradiction in the file: `F05` says the grouping is
wrong and `F-04` proposes a different wrong-to-right direction, while Model 1
wants a third shape. All three agree the current mobile nav is poor; none agrees
on the target.

**My recommendation: a separate spike, not a decision now.** This is the item
where a mock cannot settle it, because the trade is information architecture and
it needs a real screen to evaluate. My own read: **A's breadcrumbs and real `h1`s
are unconditional** (they are correctness for screen readers, not preference), and
the destination set should follow from a card-sort rather than from any of the
three proposals. Where the three collide, do the part all three agree on and
defer the rest.

### E · Cards: one shape, or two densities? (D-07 vs F13 / F-20)

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Shape | **Two**: `Row` (experiments, milestones, report, shared — meta-first) and `Entry` (papers, notes, logbook — text-first, 3-line excerpt, status as a margin pill) | **One** `EntityCard` for everything, with a codified field order and an overflow for delete |
| Status control on a paper | A pill in the margin rail, not a select | A status select in the header, per the existing card spec |

**The disagreement:** whether the canonical card should be *split*. Note the
primitive already exists (`entity-card.tsx`) and is used in 8 files, so Model 2's
"enforce one shape" is largely already true — the drift is in what each screen
fills it with.

**My recommendation: A.** The observation that a reading list's job is deciding
what to read, and that the shared card spec hides the summary behind "Show more"
on exactly the screen where the summary is the content, is the strongest
screen-level argument in the whole audit. It is also additive rather than a
rewrite: `Entry` can be a variant of the existing primitive.

### F · People: where do invites live? (F02 / F09 vs D-11 / A)

Model 2 wants a **Lab card on Home** with members, pending codes and `+ Invite`,
plus a first-run nudge, plus a member strip in the nav footer. Model 1 wants
People as its own Settings tab with the org chart. These are compatible
(surface it in both places) but they imply different priorities: Model 2 treats
lab formation as the primary acquisition loop; Model 1 treats it as settings.

**My recommendation: both, with Model 2's Home card first.** The audit is right
that "professor creates lab, shares three codes, student joins" is the loop the
product is sold on, and it currently has no home. That is a bigger problem than
tab taxonomy.

## Conflicts inside the code audit that land on design

These are already recorded in `audit_2_verification.md`; listing them here because
they change design work:

* **ACC-01 vs WF-X01** — one half of `audit_2.md` claims this app holds
  accessibility/device-admin permissions and breaks payment apps; the other half
  (correctly) says it holds none. No design work should be planned against
  `ACC-01`.
* **STATUS: the contrast half of D-06 is already done.** `check:contrast` passes.
  What remains from D-06 is the alias-override rule and the CodeMirror factory
  exhaustiveness — both are gate-shaped, not design-shaped.

## Recommendation summary

**Six conflicts as written, five decisions to make.** Two of the six collapsed once
the real components were read: the settings question is not whether to add tabs
(they exist), and the destructive-action question is not text-link versus icon
(the icon button is shipped) but footer order and a missing label. The navigation
question stayed a conflict but split into one part that is unconditional and one
that needs a spike.

| Decision | Take | Why |
| --- | --- | --- |
| 1 · Settings grouping | **Six groups over the existing 14 tabs**: Account · Workspace · Writing · Appearance · Integrations · Privacy | A 14-item strip with a hidden scrollbar is the same discovery problem the tabs were meant to solve. Both models' counts leave real tabs homeless |
| 2 · Card density | **Two densities** — `Row` for meta-first, `Entry` for papers/notes/logbook | The hidden-summary argument is the strongest screen-level finding in the file, and it is additive: a variant of the primitive that already exists |
| 3 · Metric curve | **No smoothing, one shared y-domain**; B's palette names verified at 3:1 | The query layer refuses to average; a slider would undo that at the chart |
| 4 · Mobile destinations | **Breadcrumbs and a real `h1` now**; the destination set after a card sort | All three proposals disagree, and the accessible half is not a preference |
| 5 · Lab formation | **A Lab card on Home first, then the `Org` tab** | It is the acquisition loop, and `Org` already exists as a tab nothing surfaces |

Taken regardless of which way the five go, because they are correctness rather
than taste: a real `h1` per view, breadcrumbs, `deleteAriaLabel` naming the object,
and the status glyph alongside the colour so it is not the only signal.
