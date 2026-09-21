# design_audit_1.md — verification and conflicts

Same treatment as `audit_2.md`: this file is **two models' output concatenated**,
so it repeats itself and argues with itself. Every claim below was re-checked
against the tree at the branch point. The decision mock that goes with this is
`docs/plans/current/design_decisions.html`.

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
| "No shared card primitive" (F13, F20) | `apps/web/src/components/entity-card.tsx` exists, documents its own layout, and is used in **8 files** | **stale** — the primitive exists. The real gap is that its footer puts delete on the *left*, which is the opposite of what F13 asks for |
| "Empty states are per-screen strings" (D-08, F15, F21) | `components/empty-state.tsx` exists and is used in **13 files** | **partly stale** — one component, widely used; what is missing is the loading/error half |
| "No `StatusPill`" | `StatusPill` **does** exist — in `apps/pitch/src` (`chrome.tsx`, `page.tsx`, `reader-scene.tsx`, `story.tsx`), not in the product | **new finding**: the canonical primitive was written for the marketing site and never moved into the app |
| "Three tree UIs" (D-02, F12, F18) | Four, in fact: reading lists, report outline, org chart, **and the vault note tree** — which is the one that computes `ownedIds` for the whole screen. Only `explorer-panel.tsx` carries `role="tree"` | **understated** by model 1, and F12 says four while calling it "three tree UIs" |
| "Focus mode is on another branch" (D-14, F34) | `features/relations/ui/graph-screen.tsx` **ships focus mode**: `const [focus, setFocus] = useState(false)`, a `graph-focus-btn`, a `.graph-focus-bar`, a full-bleed `GraphCanvas fill` | **stale** — this is the biggest single correction. Both models and the ui-spec (`§3.5`) are describing a branch that has since landed |
| "No reduced-motion story" (D-17) | `prefers-reduced-motion` appears in **9 stylesheets** including `motion.css` and `base.css` | **partly stale** — the media query exists; the `auto/on/off` three-state setting in the fix is genuinely absent |
| "No contrast assertion across themes" (D-06) | `npm run check:contrast` exists and **passes today** ("0 normal-text pair(s) below AA") | **stale** — the gate the fix asks for is already built and green |
| "Settings is long — candidate for tabs" (D-11, F06, F24) | `ui-spec.md:292` still says so; seven sections in one scroll | **real** — and the two models disagree about the tab set, which is decision A below |
| "Filters on two screens out of five lists" (D-10, F14) | Consistent between the models | **real**, triage only |
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
things* and the choice is yours. The mock is
`docs/plans/current/design_decisions.html` — open it in a browser.

### A · Settings: how many tabs, and what are they? (D-11 vs F06 / F24 / F-06)

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Count | **Six** | **Seven**, with a left rail **and a search field**, each pane deep-linkable (`#/settings/integrations`) |
| Set | Account · People · Appearance · Tokens · Integrations · Privacy | Workspace · Account · Appearance · Integrations · SDK & Tokens · Data · Privacy |
| Where "Delete account" goes | Privacy, alone, behind a type-the-name confirm | Privacy |
| Where the org chart goes | People (its own tab) | Workspace (folded in with members and codes) |
| Which tab holds sync connectors | Integrations | none named — sync is inside Integrations |
| Extras | Tabs are a real tablist (arrow keys, `aria-selected`), selection in the URL | A setup-status header (`Zotero ● Git ○`) |

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

| | A — Model 1 | B — Model 2 |
| --- | --- | --- |
| Control | A 44×44 **icon** button with an `aria-label` naming the object ("Delete log entry for 12 Feb"), separated from the other foot actions by a rule and 16px | Delete **moves into an overflow menu** (`⋯`) with a confirm, so it is never a sibling of edit |
| Signal | Icon **plus** colour **plus** the confirm naming the consequence | The overflow itself is the distance; confirm on top |
| What it fixes | The mis-tap: it is no longer one link away from `edit` | The visual noise: five foot actions become three |

**The disagreement:** Model 1 keeps delete *visible* and makes it safe; Model 2
makes it *absent* until you open a menu.

**My recommendation: B for the foot, A's label rule taken as well.** The overflow
is the smaller change and it is what the card primitive's own header comment
already implies ("delete ……… status · actions · open" puts delete first, which is
the current wrong state). But an icon-only delete inside a menu still needs a name
that says *what* it deletes — that is an accessibility requirement, not a style
preference, so take Model 1's `aria-label` rule and the "This also removes it from
2 lists" confirm regardless of which layout you pick.

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

| Decision | Take | Why |
| --- | --- | --- |
| A · Settings tabs | **B's tab set, no search field**, plus Model 1's aria + URL rules | The set matches the user's model; a search inside settings is a symptom |
| B · Destructive | **B's overflow**, plus Model 1's naming + consequence confirm | Both the distance and the name are needed; neither alone is |
| C · Metric curve | **A's defaults**, B's palette, **no smoothing slider** | The query layer already refuses to average; a UI slider would undo that |
| D · Navigation | **A's breadcrumbs and `h1`s now; the destination set deferred** | All three proposals disagree, and the accessible half is not a preference |
| E · Cards | **A — two densities** | The hidden-summary argument is the strongest screen-level finding in the file |
| F · People | **Model 2's Home card first, then a tab** | Lab formation is the acquisition loop and has no home today |
