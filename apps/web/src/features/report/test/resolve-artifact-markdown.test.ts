import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Experiment } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";

before(async () => {
  await loadTestCore();
});

const NOW = Date.parse("2026-01-01T00:05:00.000Z");

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

function resolve(body: string, experiments: Experiment[]): string {
  return readyCore().resolveArtifactRefsMarkdown(body, experiments, NOW);
}

test("safeArtifactCaption collapses newlines so alts cannot inject markdown", () => {
  assert.equal(readyCore().safeArtifactCaption("before\nafter"), "before after");
  assert.equal(readyCore().safeArtifactCaption("a[b]c"), "abc");
  assert.equal(readyCore().safeArtifactCaption(undefined), "artifact");
});

test("safeArtifactCaption strips attribute breakout characters", () => {
  assert.equal(readyCore().safeArtifactCaption('x" onerror="alert(1)'), "x onerror=alert(1)");
});

test("safeImageDestination accepts http(s)/blob/vault and encodes spaces/parens", () => {
  assert.equal(readyCore().safeImageDestination("https://cdn.test/a.png"), "https://cdn.test/a.png");
  assert.equal(readyCore().safeImageDestination("https://cdn.test/a(1).png"), "https://cdn.test/a%281%29.png");
  assert.equal(readyCore().safeImageDestination("loss.png"), null);
  assert.equal(readyCore().safeImageDestination("javascript:alert(1)"), null);
});

test("safeImageDestination rejects quote breakouts", () => {
  assert.equal(readyCore().safeImageDestination('https://cdn.test/a.png" onerror="x'), null);
});

test("resolved ref emits an https figure with newlines collapsed from alt", () => {
  const out = resolve("![before\nafter](expartifact:e1/https%3A%2F%2Fcdn.test%2Fa.png)", [
    exp({ id: "e1", name: "Run", artifacts: ["https://cdn.test/a.png"] }),
  ]);
  assert.equal(out, "![before after](https://cdn.test/a.png)");
});

test("basename ref resolves to the live signed URL", () => {
  const out = resolve("![fig](expartifact:e1/loss.png)", [
    exp({ id: "e1", name: "Run", artifacts: ["https://cdn.test/loss.png?tok=1"] }),
  ]);
  assert.equal(out, "![fig](https://cdn.test/loss.png?tok=1)");
});

test("missing experiment shows the missing-experiment warning", () => {
  const out = resolve("![fig](expartifact:gone/https%3A%2F%2Fx.test%2Fa.png)", []);
  assert.equal(out, "> ⚠️ Missing experiment for artifact “fig”.");
});

test("missing artifact names the experiment in the warning", () => {
  const out = resolve("![fig](expartifact:e1/other.png)", [
    exp({ id: "e1", name: "Run", artifacts: ["loss.png"] }),
  ]);
  assert.equal(out, "> ⚠️ Artifact “fig” was not found on experiment Run.");
});

test("basename shared by two live URLs fails closed as not found", () => {
  const out = resolve("![fig](expartifact:e1/loss.png)", [
    exp({
      id: "e1",
      name: "Run",
      artifacts: ["https://cdn.test/a/loss.png?token=1", "https://cdn.test/b/loss.png?token=2"],
    }),
  ]);
  assert.match(out, /was not found on experiment Run\./);
});

test("running experiment with no recent heartbeat adds the stale note", () => {
  const out = resolve("![fig](expartifact:e1/loss.png)", [
    exp({
      id: "e1",
      name: "Run",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      artifacts: ["https://cdn.test/loss.png"],
    }),
  ]);
  assert.equal(
    out,
    "![fig](https://cdn.test/loss.png)\n> ⚠️ Experiment is running but stale — this figure may be out of date.",
  );
});

test("body without refs is returned unchanged", () => {
  const body = "Just [[Note]] and text.";
  assert.equal(resolve(body, []), body);
});
