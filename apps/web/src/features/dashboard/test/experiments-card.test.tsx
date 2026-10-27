/**
 * The Experiments card read "1 running · 8 total" over a big "3" captioned
 * "experiments done", while every other progress card reads "x / y" and a
 * percentage, so the reader could not tell what 3 meant (design D22, DA-127).
 * It now says "3 of 8 done · 1 running" with the same bar as the others.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { renderDashboardCard, type CardRenderProps } from "../ui/cards/card-renderers";
import { buildDashboardStats } from "../application/build-dashboard-stats";
import type { DashboardStats } from "../application/build-dashboard-stats";

const stats = { experiments: { done: 3, total: 8, pct: 38, running: 1 } } as DashboardStats;
const html = (h: number) =>
  renderToStaticMarkup(
    <>{renderDashboardCard("experiments-summary", { stats, supervision: null, item: { h } as CardRenderProps["item"], supervisees: [] })}</>,
  );

test("the card names what its number counts and shows a bar like the other progress cards", () => {
  const tall = html(2);
  assert.match(tall, /href="\/experiments"/);
  assert.match(tall, /3 of 8 done · 1 running/);
  assert.match(tall, /38%/);
  assert.match(tall, /class="progress-bar dashboard-stat-bar"/);
  assert.doesNotMatch(tall, /experiments? done|8 total/);
});

test("a one-row card keeps the words and drops only the bar", () => {
  const short = html(1);
  assert.match(short, /3 of 8 done · 1 running/);
  assert.doesNotMatch(short, /progress-bar/);
});

test("the stats carry the done share of experiments", () => {
  const exp = (status: string) => ({ id: status + Math.random(), name: "x", status, createdAt: "" });
  const built = buildDashboardStats({
    papers: [], sections: [], milestones: [], logEntries: [], relations: [], listCount: 0, tags: [],
    experiments: [exp("done"), exp("running"), exp("planned")],
  } as never);
  assert.deepEqual(built.experiments, { done: 1, total: 3, pct: 33, running: 1 });
});
