# WeaveForge — UI Inventory & Design Spec

A complete inventory of every screen, control, form, filter, list item, and
state currently in the web app. Purpose: hand this to a designer to produce a
finalized, consistent design so we stop changing things ad-hoc.

- **Platform:** responsive web (PWA). Same code renders desktop (left side-nav)
  and mobile (bottom tab bar). Light + dark themes (several theme variants).
- **Backend:** Supabase; everything is per-user and row-level-security scoped,
  then optionally shared within a "lab" (org hierarchy).
- **Scope of this doc:** what exists today and how it behaves. A "🎨 Design
  notes" call-out at the end of each screen lists the rough edges worth deciding.

---

## 1. Global chrome (present on every signed-in screen)

### 1.1 Top bar (above the screen content)
- **Project switcher** (top-left): a pill showing the active project — a colored
  dot + project name + `▾`. Opens a menu to switch projects. The whole app is
  scoped to the selected project.
- **Theme toggle**: moon/sun icon; flips light/dark.
- **Header action icons** (top-right, icon + label, signed-in only):
  - **Supervise** (eye icon) — only if your role can supervise (not a Masters
    student). → Supervisor view.
  - **Shared** (share-nodes icon) → "Shared with me".
  - **Settings** (gear) → Settings (now also contains People/Org).
  - **Sign out** (logout icon; tooltip = your email).
  - *(The old standalone "People" icon was removed — People now lives in
    Settings.)*

### 1.2 Primary navigation (5 destinations)
Rendered from a module registry. Desktop = left nav; mobile = bottom tab bar.
- **Home** (house icon) → customizable dashboard (`/dashboard`)
- **Library** (book icon) → sub-tabs: **Papers · Notes · Graph · Lists**
- **Experiments** (flask icon) → sub-tabs: **Experiments · Git**
- **Plan** (flag icon) → sub-tabs: **Plan · Logbook**
- **Report** (doc icon) → single view (no sub-nav)

### 1.3 Sub-navigation
A segmented control (pill with a sliding indicator) at the top of grouped
sections, shown only when a group has >1 view. Swiping left/right on mobile also
moves between sub-tabs.

### 1.4 Shared UI primitives (reused everywhere)
- **Screen header** (`screen-head`): When a **SubNav** is present (Library /
  Experiments / Plan groups), the sub-tab label **is** the page identity — do
  **not** also render a duplicate `<h1>`. Standalone screens without SubNav
  (Home/Dashboard, Report, Settings) may show an `<h1>` / `screen-title`.
  Optional inline **`?` help** (`HeadingHelp`) is available but not required.
  Action cluster: prefer a **single primary** (`+ Paper`, `+ Note`, …) that
  opens a **choice dialog** for secondary actions (import/sync/export/share).
- **Buttons:** `btn-primary` (filled/accent, e.g. "+ Paper"), `btn-secondary`
  (outline), `link-btn` (text link, e.g. "edit", "delete",
  "Show more"), `danger` variant (red text, destructive).
- **Card** (`card`): rounded container used for list items and forms.
- **Modal** (`Modal`): centered dialog + dimmed backdrop; title + `✕`; closes on
  ✕, backdrop click, or ESC. **All "add/create" forms open in a modal.** Multi-
  action screens use an `org-choice-card` menu first.
- **Popover** (`Popover`): icon Filters control that opens an anchored panel;
  shows a **count badge** of active filters; closes on outside-click/ESC. **Used
  for per-page filters** so the page stays clean. Touch target ≥44×44 on mobile.
- **Select** (native styled dropdown) and **MultiSelect** (checkbox dropdown with
  an "All …" default) — used for statuses, lists, tags, etc.
- **Status pill / chips:** small rounded labels for statuses, tags (`#tag`),
  git info, metrics, dependencies, etc. Colors come from the shared `--st-*`
  semantic ramp in `themes.css` (do not invent one-off status hex).
- **Markdown**: summaries, log bodies, etc. render markdown.
- **Empty / Loading / Error** states: most screens show `Loading…`, an inline
  error string, and a friendly empty state with a hint pointing at the add button.

🎨 **Design notes (global):** Mobile chrome = brand row + SubNav + one primary
action + floating bottom nav. Prefer collapsing secondary actions into the
primary dialog. Safe-area insets require `viewport-fit=cover`.

---

## 2. Controlled vocabularies (used across screens)

| Concept | Values (internal → label) |
|---|---|
| **Paper status** | `to_read` · `reading` · `read` · `skimmed` |
| **Experiment status** | `planned` · `running` · `done` · `failed` · `abandoned` |
| **Milestone status** | `planned` · `in_progress` · `done` · `blocked` |
| **Report section status** | `not_started` · `drafting` · `review` · `done` |
| **Log kind** | `daily` · `weekly` |
| **Org role** | `professor` → "Professor" · `phd` → "PhD supervisor" · `masters` → "Masters student" · `standalone` → no lab |
| **Graph relation** | `cites` · `extends` · `contradicts` · `similar` · `builds_on` · `uses_method` |
| **Milestone dependency kind** | `milestone` · `experiment` · `paper` · `external` |
| **Shareable types** | `milestone` · `experiment` · `report_section` · `reading_list` · `paper` · `vault_page` |
| **Share access** | `view` · `comment` · `edit` (co-editing where CRDT applies) |

---

## 3. Screens

### 3.0 Home — Dashboard  *(Home → `/dashboard`)*
- **Header:** project name as `<h1>` (no separate "Home" title); action cluster via
  **Customize** / **Done** edit bar (right).
- **Grid:** responsive **react-grid-layout** — 12 columns on desktop (`lg`), 4 on
  mobile (`sm`). Cards drag/resize in edit mode; layout persists per project in
  Supabase (`project_dashboard_layout`).
- **Load animation:** measure layout → show card shells at final positions → fade
  in stat/progress content after stats load (avoids layout jump).
- **Edit mode:** **Customize** enables drag/resize + per-card **remove**; **+ Add
  card** opens a bottom sheet grouped by Progress / Activity / Library / Team;
  **Reset layout** restores role defaults; **Done** compacts and saves (debounced).
- **Student cards (default):** reading / report / plan / experiments progress rings;
  needs-attention list; recent log; library snapshot; optional top-tags.
- **Supervisor cards** (PhD+ with supervisees): team roster, team attention,
  supervisee snapshot (pick supervisee per snapshot card). Missing supervisor
  cards are merged into saved layouts without wiping user edits.
- **States:** loading layout; inline layout/stats errors; empty ("No cards yet…").
- 🎨 Card chrome, stat rings, and edit affordances need a final pass; desktop
  max-width matches the rest of the app (~760px).

### 3.1 Auth — Sign in / Sign up
- **Title:** "Sign in" / "Sign up" (toggles), subtitle "Track your thesis — …".
- **Controls:** "Continue with Google" button; "or" divider; **Email** +
  **Password** inputs; primary submit ("Sign In" / "Sign Up"); text toggle
  between sign-in and sign-up.
- **States:** busy ("Signing in…"); after sign-up → "check your email to confirm"
  panel with "Back to sign in"; inline error.
- 🎨 The only screen that intentionally keeps a subtitle (no `?` icon).

### 3.2 Projects (project picker — shown when no project is selected)
- **Header:** "Projects" + `?`; action **`+ New project`** (right).
- **Add (modal "New project"):** **Name** (text) → creates and selects it.
- **List:** project cards, each = color dot + name; click a card to enter it.
- **States:** loading; empty ("No projects yet. Use 'New project'…").
- 🎨 No color picker / rename / delete / archive yet; projects have a color field
  but it isn't user-settable in the UI.

### 3.3 Papers  *(Library → Papers)*
- **Header:** "Papers" + `?`; actions: **`⇅ Sync Zotero`** (secondary, left) and
  **`+ Add paper`** (primary, right).
- **Add (modal "Add a paper"):** **Title** (text); **reference kind** select
  (URL / arXiv id / DOI / Zotero key) with a matching **reference value** input
  (placeholder changes per kind); **Status** select (default `to_read`). Import
  resolves metadata (authors, year) from the chosen source.
- **Progress card:** "X / Y papers read" + percentage bar.
- **Controls row:** **Search** input (title/author) + **`Filters ▾`** popover
  containing **Status**, **List**, **Tags** multi-selects + "Clear filters"
  (badge shows active-filter count).
- **List item (paper card), collapsed:** title; **status** select (top-right);
  authors line (up to 4, "et al.", year); `#tag` chips. Foot: **delete** (left),
  **Share**, **Show more**.
- **Expanded ("Show more"):** summary rendered as markdown (or "No summary yet");
  **tag editor** (add/remove `#tags`); **Zotero annotations** (read-only,
  color-swatched); **images** (matplotlib/figure thumbnails). Actions: **Edit
  summary / Add summary** → textarea editor with live **word count (max 250)** +
  cancel/save.
- **Sync Zotero:** two-way sync (push/pull) + pulls PDF annotations → tags; shows
  a result message ("Synced — pushed N, pulled N…").
- 🎨 Two header buttons stack awkwardly on very narrow screens (mitigated).
  Deciding: card density, where status lives, tag affordance, thumbnail sizing.

### 3.4 Reading Lists  *(Library → Lists)*
- **Header:** "Lists" + `?`; action **`+ New list`**.
- **Add (modal "New reading list"):** **Name**; **Parent list** select (optional,
  to nest as a sublist).
- **Content:** a **tree of lists**. Each list node = name + "N papers" + **Share**;
  expands to its member papers (each with **remove**) and an **"Add a paper…"**
  select + **Add** button. Sublists nest beneath.
- **States:** loading; empty ("No lists yet…").
- 🎨 No drag-reorder, no rename/delete of a list in the UI yet; nesting depth is
  effectively unbounded visually.

### 3.4a Notes *(Library → Notes / vault)*
- **Header:** "Notes" + `?`; action **`+ New note`**.
- **Content:** list/tree of wiki-style pages; each opens a **collaborative markdown editor** when shared with `edit` access.
- **Share:** same ShareDialog as other types (`vault_page`); supports view / comment / edit and external view links.
- **States:** loading; empty.
- 🎨 Editor chrome, attachment uploads, and co-editor presence strip need design polish.

### 3.5 Graph (relations)  *(Library → Graph)*
- **Header:** "Graph" + `?`; action **`⛶ Focus`** (full-bleed mode — see note).
- **Controls card (one consolidated box):**
  - **Edges** segmented: Cites / Tags / Both.
  - **Color by** segmented: Status / Tag.
  - **Filters:** **Lists** multi-select, **Tags** multi-select.
  - **Add relation:** **From** select / **Relation** select (all 6 relation
    types) / **To** select + **Add edge** button.
  - **Auto-link citations** button (+ result message).
- **Canvas:** force-directed graph of papers (nodes) and their relations
  (edges); **fits-to-view on load** so the whole graph is visible; legend of
  relation colors + "#tag node".
- **Focus mode** *(currently on a separate experimental branch):* graph fills the
  whole content area; a floating toolbar with **Hide/Show controls** and **Exit
  focus ✕**; the controls box becomes a hideable overlay.
- 🎨 Decide whether Focus mode ships to the default. Node styling, edge legends,
  labels, and mobile interaction all need a design pass.

### 3.6 Experiments  *(Experiments → Experiments)*
- **Header:** "Experiments" + a **`● live`** indicator when a run is in progress
  (auto-refreshes) + `?`; actions: **`⇅ share all`** and **`+ Log run`**.
- **Add (modal "Log an experiment"):** **Name**, **Branch**, **Commit**,
  **Status** select, **Repo URL**, **Config (JSON)** textarea.
- **Controls row:** **List / Compare** segmented toggle (left) + **`Filters ▾`**
  popover with a **Progress** multi-select (right).
- **List item (experiment card):** name; **status** select; hypothesis (muted);
  **git chips** (branch, commit ↗ links to the commit, repo ↗); **related paper**
  chip; **metric chips** (summary key→value); **artifacts** (image thumbnails +
  link chips for wandb/etc.); **result note**. Foot: **curves** toggle (expands
  an inline metric-curve chart), **Share**, **Comments**, **delete**.
- **Compare view:** a **sortable runs table** (metric columns, click a header to
  sort) with **checkboxes** to select runs, plus **overlaid metric curves** for
  the selected runs. Empty if selected runs have no logged curves.
- 🎨 Curve chart styling (axes, tooltips, smoothing, log scale), artifact grid,
  and the compare table all need design. Config JSON is raw text today.

### 3.7 Git  *(Experiments → Git)*
- **Header:** "Git" + `?`.
- **If no repo connected:** empty state → "Enable GitHub or GitLab in Settings →
  Sync".
- **Branch bar:** **Branch** select + **"Track branch as experiment"** button.
- **Commit list:** each = short SHA (↗ link), message, author · date, and a
  **"track as experiment"** link.
- 🎨 Purely functional/list styling today; ripe for a cleaner "repo activity" look.

### 3.8 Plan  *(Plan → Plan)*
- **Header:** "Plan" + `?`; actions: **`⇅ share plan`** (blanket-share all
  milestones) and **`+ Add milestone`**.
- **Add (modal "Add a milestone"):** **Milestone** (title); **Details**
  (textarea — "what does done look like?"); **Target date**; **Status** select;
  **Dependencies** (repeatable rows: kind select [milestone / experiment / paper
  / external]; then either a reference select of that entity, or free text for
  "external"; + remove); **Compute needs** (repeatable rows).
- **Progress card:** "X / Y milestones done" + bar.
- **List item (milestone card):** title; **status** select; **due date** +
  **days-until** countdown (unless done); **dependency chips** (kind + resolved
  label); **compute chips**. Foot: **delete**, **Share**, **Comments**, **edit**
  (inline edit reuses the same form).
- 🎨 Dependencies/compute are the richest form in the app; needs a clear repeatable
  -row pattern. No timeline/Gantt view yet (natural future view).

### 3.9 Logbook  *(Plan → Logbook)*
- **Header:** "Log" + `?`; action **`+ Add entry`**.
- **Add (modal "Add a log entry"):** **Date**; **Kind** (daily / weekly);
  **Body** (markdown textarea).
- **List item (log entry):** date + kind pill; body (markdown). Actions: **edit**
  (inline form), **delete**. Deletes also best-effort sync to the connected git
  repo.
- 🎨 No date filter / kind filter today; long logs could use grouping by week.

### 3.10 Report  *(Report)*
- **Header:** "Report" + `?`; action **`+ Add section`**.
- **Add (modal "Add a section"):** **Title**; **Parent chapter** select
  (top-level only → 2-level outline); **Status**; **Target words**; **Deadline**.
- **Progress card:** "X / Y sections done" + bar.
- **Content:** a **tree/outline** of sections. Each row = title; **status**
  select; meta "N / M words" (or "N words") · "due <date>". Foot: **delete**,
  **Share**, **Comments**. Subsections nest.
- 🎨 No word-count source (manual target), no per-chapter progress roll-up styling.

### 3.11 Shared with me
- **Header:** "Shared with me" + `?`.
- **Content:** items other lab members shared with you, **grouped by owner**
  (person's name). Each item card = title + a **type** chip + **status** chip +
  **Add to library** (pin into your project) + **Comments** toggle where allowed.
- **States:** empty ("Nothing shared with you yet.").
- 🎨 Could group by type as well; comment thread styling needs design.

### 3.11a External share link *(route `/link?t=…`)*
- **Purpose:** redeem a view-only link from outside the lab (no account required for resolve; unlock/sign-in required to decrypt).
- **Flow:** paste or follow token URL → rate-limited resolve → sign in / unlock → content preview.
- 🎨 Landing state, expiry messaging, and error states (revoked / expired / rate limited).

### 3.12 Supervisor view  *(top-bar "Supervise"; roles above Masters only)*
- **Header:** "Supervisor view" + `?`.
- **Picker:** a **file-tree dropdown** of the people you supervise (navigate the
  hierarchy, pick one).
- **Panels (read-only):** **Milestones** (title, status, target date,
  description) and **Logbook** (date, kind, body) of the selected person.
- **States:** "You don't supervise anyone." / "Nobody assigned under you yet."
- 🎨 Only Plan + Logbook are surfaced up the hierarchy; decide if experiments/
  papers should be too.

### 3.13 Settings  *(top-bar gear)*
Sections, top to bottom:
1. **Account** — email, sign-in method, org/lab context.
2. **People / Organization** (`OrgPanel`):
   - Heading "People" + `?`; lab create/join or **standalone** gate on first sign-in.
   - **`+ Create account`** (if your role can provision one level down).
   - **Create (modal):** **Role** select; **Supervisor** select (professors only); **Full name**; **Email**; **Temporary password**.
   - **Org chart:** top-down tree — member nodes (name + role), "you" highlighted.
3. **Appearance:** light/dark theme selects (Catppuccin, Amoled, Dracula, …).
4. **Python SDK access tokens:** generate/revoke `tt_…` tokens; one-time reveal on create.
5. **Integrations** (descriptor-driven): Zotero, Semantic Scholar, etc. — tap to open credential modal; per-project bibliography collection when Zotero is connected.
6. **Sync** (`SyncSettings`): GitHub / GitLab / Mattermost per-project connectors.
7. **Privacy & account:** disclaimer version, GitHub repo link, **Delete account**.
- 🎨 Settings is long — candidate for tabs. Org chart needs the most visual polish.

---

## 4. Cross-cutting patterns to finalize (designer checklist)

1. **Top bar / navigation:** unify the project switcher, theme toggle, header
   icons, and per-screen action buttons into one coherent, responsive bar.
2. **Status system:** one shared color/pill treatment for all status vocabularies
   (paper/experiment/milestone/report), instead of per-feature ad-hoc colors.
3. **Buttons:** finalize the hierarchy — primary vs secondary vs link vs danger —
   and their mobile sizing (headers with two actions).
4. **Add/Create pattern:** every add flow is now a **header button → modal**.
   Confirm modal size, field layout, validation, and error display.
5. **Filters pattern:** every multi-filter page uses a **`Filters ▾` popover with
   a count badge**; search stays inline. Confirm this everywhere.
6. **Help pattern:** every heading has a **`?`** hover/tap tooltip. Confirm copy.
7. **Cards & lists:** one card spec (title, status, meta chips, expand, foot
   actions) reused across papers/experiments/milestones/report/shared.
8. **Chips:** tags, git info, metrics, dependencies, type/status — one chip system.
9. **Empty / loading / error states:** one consistent treatment + illustration.
10. **Trees:** three tree UIs exist (reading lists, report outline, org chart) —
    align their look (indent, connectors, expand/collapse).
11. **Graph / Focus mode:** decide whether the full-screen graph ships by default
    and design its overlay controls.
12. **Data viz:** metric curves + compare table need a real chart design
    (axes, tooltips, smoothing, log scale, colors, legends).
13. **Sharing/comments:** design the share dialog (member picker with search +
    role filter + access selector) and the comment thread.
14. **Themes:** ensure the final design holds up across all light/dark variants.

---

## 5. Notes for whoever designs this
- Nothing here is load-bearing on exact pixels; treat statuses/roles/relations in
  §2 as fixed vocabulary (they're enforced in the backend), but everything visual
  is open.
- The app is **feature-modular**: each screen is an independent module, so the
  design can be rolled out screen-by-screen without a big-bang rewrite.
- The known "floating circle" seen on the deployed preview is the **Vercel
  Toolbar**, not part of the app — ignore it for design.

---

## Appendix A — Design language reference

Canonical typography in the shipped app is **IBM Plex** (Sans, Serif, Mono), not Inter.

| Token | Value |
|-------|-------|
| Card radius | 12–16px |
| Input radius | 10px |
| Pill / badge radius | 999px |
| Motion | 120–340ms ease; gentle, no bounce |
| Shadow | soft — `0 1px 2px rgba(44,42,38,.04), 0 8px 24px rgba(44,42,38,.06)` |

Light theme variants: Paper (`light`), Latte, Honey. Dark variants: Slate (`dark`), Mocha, Dracula, Amoled, High Contrast.
