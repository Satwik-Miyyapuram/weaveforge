# Relations core module

The `relations` module holds the pure rules behind paper relations and the
graph view: which nodes a graph shows, how they are sized, coloured and laid out
on a timeline, what the graph settings mean, and how citation alerts are read. It
does no drawing and no network calls. The app builds the graph data, runs the
layout and draws the canvas.

## What lives in Rust

Each file under `crates/wf-core/src/relations/` covers one job:

- `mod.rs`: registers the submodules and states that the rules come from the TypeScript domain.
- `paper_relation.rs`: the id, input check and row mapping for a paper-to-paper relation.
- `relation_rows.rs`: dedupes relation rows by id, keeping first-seen order, for a paper's relations read from both sides.
- `citation_candidate.rs`: Semantic Scholar citation candidate assembly (one `/citations` page) and the `/paper/batch` reference alignment rule, with the HTTP calls and paging loop left in TS.
- `graph_build.rs`: builds the citation graph for one view from papers, notes, report sections and runs.
- `graph_topology.rs`: the key that tells the simulation when its layout inputs changed.
- `graph_settings.rs`: graph view settings, their defaults, and the per-project graph state.
- `graph_tags.rs`: tag names and related concepts for the graph.
- `graph_colour.rs`: the fixed palette, tag hues, and the graph-wide colour modes.
- `node_colouring.rs`: graph-wide node colours, including the ramps, year, degree and community colours.
- `graph_sizing.rs`: node and label sizes at a zoom, in graph units.
- `graph_timeline.rs`: timeline lanes, year spacing and the middle year.
- `local_graph.rs`: the nodes within a few hops of a seed, for the local graph view.
- `citation_alerts.rs`: how strongly a citing paper asks to be read.
- `citation_alert_track.rs`: maps citation-alert track rows.
- `semantic_scholar_citation.rs`: field rules for the Semantic Scholar citation source.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (for example `graph_build.rs`,
`graph_topology.rs`, `graph_settings.rs`, `graph_tags.rs`, `graph_colour.rs`,
`graph_sizing.rs`, `graph_timeline.rs`, `node_colouring.rs` and
`relations_local_graph.rs`). The TypeScript wrappers in `packages/wf-wasm/src`
import the raw names from `../pkg/wf_wasm.js` and re-export them. The main names are:

- Graph data: `buildGraphData`, `graphTopologyKey`.
- Tags and concepts: `graphTagNames`, `relatedConcepts`, `notesTagged`.
- Timeline: `yearSpacing`, `timelineMidYear`, `timelineLaneOffset`.
- Colour and size: `graphPalette`, `tagColor`, `recolourNodes`, `nodeSize`, `labelSize`, `rampColour`, `yearColours`, `degreeColours`, `communities`.
- Settings: `defaultGraphSettings`, `normalizeGraphViewSettings`, `effectiveRelationTypes`, `graphFilterCountFor`, `parseGraphPersistedState`, `mergeGraphPersistedState`, `showRelationEdges`, `showConceptEdges`.
- Relations and alerts: `paperRelationInputError`, `createPaperRelationWith`, `paperRelationFromRow`, `paperRelationToRow`, `citationAlertTrackFromRow`.
- Vault pages: `createVaultPageWith`, `buildPageTree`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after the
core has loaded.

## Constants and defaults

Rust is the only copy of the graph defaults (`default_graph_settings`,
`MAX_COLOR_GROUPS`, the persisted-state defaults). The TS files still declare
these as module-load values, so they are a second copy until the importers move:

- `RELATION_TYPES` (`domain/paper-relation.ts`), `NODE_COLOR_KEYS` and
  `DEFAULT_GRAPH_SETTINGS`, `MAX_COLOR_GROUPS` (`domain/graph-view-settings.ts`),
  `DEFAULT_GRAPH_PERSISTED_STATE` (`domain/graph-persisted-defaults.ts`).

They are still TS because they are public `@weaveforge/core` names read by
`apps/web` (`.tsx` under `ui/` and `.ts` tests) and `apps/shell/sidecar`. Rust has
no exported relation-type list or node-colour key list yet. Moving them needs
new wasm exports, then a call-time function, then the importers repointed.

## What stays in TypeScript, and why

- **Layout and drawing.** The force simulation, the canvas and the pointer
  handling stay in `apps/web`. Rust gives the simulation its inputs and tells it
  when they change (`graphTopologyKey`); it does not run the layout.
- **Network calls.** Fetching citations from Semantic Scholar and similar sources
  stays in TypeScript. Rust holds the field rules and the upstream target, not the
  request.
- **Storage.** Reading and writing relations, notes, settings and vault pages
  stays in `apps/web` infrastructure. Rust maps the rows.
- **Orchestration.** Deciding when to rebuild the graph, and when to save its
  settings, stays in TypeScript use cases.
- **Hooks and UI.** Panels, toolbars, the settings dialog and the graph
  component stay in `apps/web`.
- **Thin wrappers.** The files in `packages/wf-wasm/src` only forward to the raw
  exports, so they keep no rules of their own.

Source: `crates/wf-core/src/relations/`
