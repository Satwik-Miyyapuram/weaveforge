// Input re-render budget from .agents/ui-layers.md: work done per keystroke and per pen move. Pure; scripts/perf/input-budget.mjs feeds it live Dev numbers.

export const INPUT_BUDGET = {
  key: { outsideMutations: 0, layouts: 2, styleRecalcs: 3, scriptMs: 8 },
  pen: { outsideMutations: 0, layouts: 1, styleRecalcs: 2, scriptMs: 4 },
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Per-event averages from two `Performance.getMetrics` snapshots (as {name: value}) and the
 * DOM mutations seen outside the edited element. ScriptDuration is in seconds; scriptMs is ms.
 */
export function perEvent(before, after, outsideMutations, events) {
  if (!(events > 0)) throw new RangeError(`events must be > 0, got ${events}`);
  const delta = (name) => (after[name] ?? 0) - (before[name] ?? 0);
  return {
    outsideMutations: round2(outsideMutations / events),
    layouts: round2(delta("LayoutCount") / events),
    styleRecalcs: round2(delta("RecalcStyleCount") / events),
    scriptMs: round2((delta("ScriptDuration") * 1000) / events),
  };
}

/** Every budget `measured` breaks for `kind` ("key" | "pen"), one line each; [] when all hold. */
export function checkInputBudget(kind, measured) {
  const budget = INPUT_BUDGET[kind];
  if (!budget) throw new RangeError(`unknown input kind ${kind}`);
  return Object.entries(budget)
    .filter(([name, max]) => measured[name] > max)
    .map(([name, max]) => `${kind} ${name} ${measured[name]} > ${max} per event`);
}
