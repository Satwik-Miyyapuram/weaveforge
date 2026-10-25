import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { renderDashboardCard, type CardRenderProps } from "../ui/cards/card-renderers";
import type { DashboardStats } from "../application/build-dashboard-stats";

/** The three progress cards share one renderer; each shows its own figure (35-21). */
const stats = {
  reading: { done: 1, total: 4, pct: 25 },
  report: { done: 2, total: 5, pct: 40 },
  plan: { done: 3, total: 3, pct: 100 },
} as DashboardStats;

function props(h: number): CardRenderProps {
  return { stats, supervision: null, item: { h } as CardRenderProps["item"], supervisees: [] };
}

for (const [type, href, pct] of [
  ["reading-progress", "/papers", "25%"],
  ["report-progress", "/report", "40%"],
  ["plan-progress", "/plan", "100%"],
] as const) {
  test(`${type} links to ${href} and shows ${pct}`, () => {
    const html = renderToStaticMarkup(<>{renderDashboardCard(type, props(2))}</>);
    assert.match(html, new RegExp(`href="${href}"`));
    assert.match(html, new RegExp(pct));
  });
}
