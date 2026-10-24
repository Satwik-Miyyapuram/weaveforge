import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * B69 moved pieces out of large files. Each new module must load on its own
 * and export what its old home now imports from it. Modules that pull in
 * uPlot's stylesheet (the experiment card, compare view and chart) cannot
 * load under node; the typecheck covers them.
 */
const MOVED: Record<string, string[]> = {
  "../features/plan/ui/milestone-card": ["MilestoneCard"],
  "../features/settings/ui/library-pdf-indexing": ["LibraryPdfIndexing"],
  "../features/settings/ui/appearance-panel": ["AppearancePanel"],
  "../features/overleaf/application/bibtex-export": ["buildCiteByTitle", "collectCitedKeys", "paperToBibtex"],
  "../features/dashboard/application/dashboard-layout-packing": [
    "compactLayoutVertical",
    "layoutFloors",
    "normalizeLayoutItem",
    "normalizeSmLayout",
    "packSmLayout",
    "closeLayoutGaps",
  ],
  "../features/auth/domain/auth-transition": ["nextAuthStep"],
  "../features/experiments/ui/metric-chart-data": ["alignSeries", "emaSmooth", "readPrefs", "writePrefs"],
  "../features/experiments/ui/add-experiment-form": ["AddExperimentForm"],
  "../features/report/ui/section-card": ["SectionCard"],
  "../features/report/ui/report-section-tree": ["progressOf", "collectSectionIds", "patchSectionInTree"],
  "../features/report/ui/overleaf-section-tree": ["SectionTree"],
  "../features/report/ui/overleaf-report-forms": ["EditOverleafReportForm", "LinkOverleafForm"],
  "../features/relations/application/graph-timeline": ["timelineLaneX", "graphTopologyKey"],
  "../features/relations/ui/use-graph-canvas-size": ["useGraphCanvasSize"],
  "../features/relations/ui/use-graph-hover": ["useGraphHover"],
};

for (const [path, names] of Object.entries(MOVED)) {
  test(`${path.split("/").pop()} loads and exports its moved names (B69)`, async () => {
    const mod = (await import(path)) as Record<string, unknown>;
    for (const name of names) assert.equal(typeof mod[name], "function", name);
  });
}

test("the old homes still load after the moves (B69)", async () => {
  for (const path of [
    "../features/plan/ui/plan-screen",
    "../features/settings/ui/settings-screen",
    "../features/overleaf/application/build-overleaf-export",
    "../features/dashboard/application/dashboard-layout",
    "../features/auth/ui/auth-provider",
    "../features/report/ui/report-screen",
    "../features/report/ui/linked-overleaf-reports",
    "../features/relations/ui/graph-canvas",
    "../features/editor-workspace/ui/explorer-panel",
    "../features/workspace/application/workspace-folder",
  ]) {
    await import(path);
  }
});
