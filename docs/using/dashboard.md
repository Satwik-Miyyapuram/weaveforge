# The dashboard

The dashboard is the front page of a project. It shows your reading progress,
report and plan progress, experiments, what needs attention, recent log entries
and a snapshot of your library. Each part is a card you can move and resize.

## How to

1. Open the dashboard. Each card shows its numbers and links to the page behind it.
2. Choose **Customize dashboard**. Drag a card to move it, drag its corner to
   resize it, or remove it with ✕.
3. Choose **+ Add card** to open the **Add card** list, grouped as Progress,
   Activity, Library and Team. Pick a card to add it.
4. Choose **Done** to save the layout to the project. **Reset layout** puts the
   default cards back at once, without asking.
5. The Team cards (`team-roster`, `team-attention`, `supervisee-snapshot`) are
   listed only for PhD and professor roles. A supervisor with at least one supervisee
   also gets them in the default layout.
6. If a saved card type is no longer known to this version, only that card is
   dropped. The rest of your layout still loads.

## Reference

The dashboard has eleven card types:

| Card id | What it shows |
| --- | --- |
| `reading-progress` | Papers read against the total |
| `report-progress` | Report sections done against the total |
| `plan-progress` | Milestones done against the total |
| `experiments-summary` | Experiments done and running |
| `needs-attention` | Unread papers, milestones due soon or overdue, running experiments |
| `recent-log` | The latest log entries |
| `library-snapshot` | Paper, relation and list counts |
| `top-tags` | The most used tags |
| `team-roster` | Supervisees and their milestone status |
| `team-attention` | Supervisee milestones that are blocked or overdue |
| `supervisee-snapshot` | One supervisee's summary |

A saved layout has two breakpoints: `lg` for wide screens and `sm` for narrow
ones. Each card has an id, a type, and numeric `x`, `y`, `w` and `h` values.
A layout with no `lg` or `sm` list is treated as no saved layout.

## How it works

The check that reads a saved layout is a pure function in Rust. It keeps every
valid card unchanged, drops each card that is malformed or has an unknown type,
and returns null only when `lg` or `sm` is not an array. The web app calls it
through the WebAssembly build. Packing, height fitting and the stat builders still
run in TypeScript, because they depend on the card catalogue and on the workspace
types that have no Rust twin yet.

Source: `crates/wf-core/src/dashboard/`

## Related

- [Projects](projects.md) — the project the dashboard belongs to
- [Search](search.md) — finding the papers and notes behind the cards
- [Getting started](getting-started.md) — first steps in a new project
