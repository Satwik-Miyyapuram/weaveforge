import assert from "node:assert/strict";
import test from "node:test";
import type { Experiment } from "@weaveforge/core";
import {
  resolveArtifactRefsMarkdown,
  safeArtifactCaption,
  safeImageDestination,
} from "../application/resolve-artifact-markdown.js";

function exp(partial: Partial<Experiment> & Pick<Experiment, "id" | "name">): Experiment {
  return {
    status: "done",
    config: {},
    metrics: {},
    artifacts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("safeArtifactCaption collapses newlines so alts cannot inject markdown", () => {
  assert.equal(safeArtifactCaption("before\nafter"), "before after");
  assert.equal(safeArtifactCaption("a[b]c"), "abc");
});

test("safeImageDestination accepts http(s)/blob/vault and encodes spaces/parens", () => {
  assert.equal(safeImageDestination("https://cdn.test/a.png"), "https://cdn.test/a.png");
  assert.equal(safeImageDestination("https://cdn.test/a(1).png"), "https://cdn.test/a%281%29.png");
  assert.equal(safeImageDestination("loss.png"), null);
  assert.equal(safeImageDestination("javascript:alert(1)"), null);
});

test("resolveArtifactRefsMarkdown emits https figures and escapes alt newlines", () => {
  const clean = "![before\nafter](expartifact:e1/https%3A%2F%2Fcdn.test%2Fa.png)";
  const out = resolveArtifactRefsMarkdown(clean, [
    exp({ id: "e1", name: "Run", artifacts: ["https://cdn.test/a.png"] }),
  ]);
  assert.match(out, /!\[before after\]\(https:\/\/cdn\.test\/a\.png\)/);
});

test("resolveArtifactRefsMarkdown resolves basename refs to the live https URL", () => {
  const out = resolveArtifactRefsMarkdown("![fig](expartifact:e1/loss.png)", [
    exp({ id: "e1", name: "Run", artifacts: ["https://cdn.test/loss.png?tok=1"] }),
  ]);
  assert.match(out, /!\[fig\]\(https:\/\/cdn\.test\/loss\.png\?tok=1\)/);
});

test("safeArtifactCaption strips attribute breakout characters", () => {
  assert.equal(safeArtifactCaption('x" onerror="alert(1)'), "x onerror=alert(1)");
});

test("safeImageDestination rejects quote breakouts", () => {
  assert.equal(safeImageDestination('https://cdn.test/a.png" onerror="x'), null);
});

test("resolveArtifactRefsMarkdown surfaces missing experiments after a real load", () => {
  const out = resolveArtifactRefsMarkdown("![fig](expartifact:gone/https%3A%2F%2Fx.test%2Fa.png)", []);
  assert.match(out, /Missing experiment/);
});
