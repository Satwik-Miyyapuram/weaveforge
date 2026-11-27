// UI memory budget from .agents/ui-layers.md: composited layers, renderer tile memory, GPU shared images and idle private bytes. Pure; scripts/perf/budget.mjs feeds it live Dev numbers.

export const UI_BUDGET = { readerLayers: 6, otherLayers: 8, tileMB: 30, gpuMB: 50, idlePrivateMB: 220 };

const round1 = (n) => Math.round(n * 10) / 10;

/** Every budget the numbers break, as one line each; [] when all hold. */
export function checkUiBudget({ path, layerCount, report, idle = false }) {
  const failures = [];
  const maxLayers = path.startsWith("/reader") ? UI_BUDGET.readerLayers : UI_BUDGET.otherLayers;
  if (layerCount > maxLayers) failures.push(`layers ${layerCount} > ${maxLayers} on ${path}`);

  if (!report.allocators) {
    failures.push("no allocator dump (run memory.mjs with --dump)");
  } else {
    const tile = round1(
      report.allocators
        .filter((a) => /renderer/i.test(a.process))
        .reduce((sum, a) => sum + (a.allocatorsMB["cc/tile_memory"] ?? 0), 0),
    );
    if (tile >= UI_BUDGET.tileMB) failures.push(`cc/tile_memory ${tile} MB >= ${UI_BUDGET.tileMB} MB`);

    const gpu = round1(
      report.allocators
        .filter((a) => /gpu/i.test(a.process))
        .reduce((sum, a) => sum + (a.allocatorsMB["gpu/shared_images"] ?? 0), 0),
    );
    if (gpu >= UI_BUDGET.gpuMB) failures.push(`gpu/shared_images ${gpu} MB >= ${UI_BUDGET.gpuMB} MB`);
  }

  if (idle) {
    const priv = round1(
      Object.entries(report.processes ?? {})
        .filter(([name]) => name !== "postgres")
        .reduce((sum, [, p]) => sum + p.privateMB, 0),
    );
    if (priv >= UI_BUDGET.idlePrivateMB) failures.push(`idle private ${priv} MB >= ${UI_BUDGET.idlePrivateMB} MB`);
  }
  return failures;
}
