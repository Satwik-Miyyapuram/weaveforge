import assert from "node:assert/strict";
import test from "node:test";
import type { Experiment } from "@weaveforge/core";
import {
  parseArtifactRefs,
  resolveArtifactRef,
  serialiseArtifactRef,
  type ArtifactLookup,
} from "../application/artifact-refs";

function exp(partial: Partial<Experiment> & Pick<Experiment, "id">): Experiment {
  return {
    id: partial.id,
    name: partial.name ?? "run",
    status: partial.status ?? "done",
    config: partial.config ?? {},
    metrics: partial.metrics ?? {},
    artifacts: partial.artifacts ?? ["loss.png"],
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    startedAt: partial.startedAt,
    finishedAt: partial.finishedAt,
  };
}

test("parseArtifactRefs finds a single ref", () => {
  const md = "See ![loss](expartifact:exp1/loss.png) above.";
  const refs = parseArtifactRefs(md);
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], {
    experimentId: "exp1",
    artifactName: "loss.png",
    alt: "loss",
    start: 4,
    end: 38,
    raw: "![loss](expartifact:exp1/loss.png)",
  });
  assert.equal(md.slice(refs[0]!.start, refs[0]!.end), refs[0]!.raw);
});

test("parseArtifactRefs finds multiple refs among normal markdown", () => {
  const md = [
    "# Results",
    "",
    "Compare [[Related Paper]] and a normal ![photo](https://example/a.png).",
    "",
    "![a](expartifact:e1/a.png) then ![b](expartifact:e2/subdir/b.webp)",
    "",
    "Also ![fig](reportimg:uid/sid/f.webp) stays untouched.",
  ].join("\n");
  const refs = parseArtifactRefs(md);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.experimentId, "e1");
  assert.equal(refs[0]!.artifactName, "a.png");
  assert.equal(refs[1]!.experimentId, "e2");
  assert.equal(refs[1]!.artifactName, "subdir/b.webp");
});

test("parseArtifactRefs returns empty when there are no refs", () => {
  assert.deepEqual(parseArtifactRefs("Just [[Note]] and text."), []);
  assert.deepEqual(parseArtifactRefs(""), []);
});

test("serialiseArtifactRef round-trips with parse", () => {
  const raw = serialiseArtifactRef({
    experimentId: "exp-9",
    artifactName: "plots/acc.png",
    alt: "Accuracy",
  });
  assert.equal(raw, "![Accuracy](expartifact:exp-9/plots%2Facc.png)");
  const [parsed] = parseArtifactRefs(`Intro ${raw} outro`);
  assert.equal(parsed!.experimentId, "exp-9");
  assert.equal(parsed!.artifactName, "plots/acc.png");
  assert.equal(parsed!.alt, "Accuracy");
  assert.equal(serialiseArtifactRef(parsed!), raw);
});

test("serialiseArtifactRef encodes whitespace and closing parentheses", () => {
  const raw = serialiseArtifactRef({
    experimentId: "exp 9",
    artifactName: "plots/loss (1).png",
    alt: "Loss",
  });
  assert.equal(
    raw,
    "![Loss](expartifact:exp%209/plots%2Floss%20%281%29.png)",
  );
  const [parsed] = parseArtifactRefs(raw);
  assert.deepEqual(
    {
      experimentId: parsed!.experimentId,
      artifactName: parsed!.artifactName,
    },
    {
      experimentId: "exp 9",
      artifactName: "plots/loss (1).png",
    },
  );
  assert.equal(serialiseArtifactRef(parsed!), raw);
});

test("serialiseArtifactRef strips brackets from alt so parse round-trips", () => {
  const raw = serialiseArtifactRef({
    experimentId: "e1",
    artifactName: "a.png",
    alt: "Fig [1]",
  });
  assert.equal(raw, "![Fig 1](expartifact:e1/a.png)");
  const [parsed] = parseArtifactRefs(raw);
  assert.equal(parsed!.alt, "Fig 1");
  assert.equal(serialiseArtifactRef(parsed!), raw);
});

test("parseArtifactRefs skips malformed and invalid encoded paths", () => {
  assert.deepEqual(
    parseArtifactRefs(
      [
        "![a](expartifact:noslash)",
        "![b](expartifact:/a.png)",
        "![c](expartifact:e1/)",
        "![e](expartifact:%20/a.png)",
        "![f](expartifact:%20exp/a.png)",
        "![g](expartifact:e1/loss(1).png)",
      ].join(" "),
    ),
    [],
  );
});

test("parseArtifactRefs keeps bare percent signs in legacy paths", () => {
  const refs = parseArtifactRefs(
    "![a](expartifact:e1/100%done.png) ![b](expartifact:e1/%ZZ)",
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.artifactName, "100%done.png");
  assert.equal(refs[1]!.artifactName, "%ZZ");
});

test("serialiseArtifactRef preserves an explicit empty alt", () => {
  const raw = serialiseArtifactRef({
    experimentId: "e1",
    artifactName: "a.png",
    alt: "",
  });
  assert.equal(raw, "![](expartifact:e1/a.png)");
  const [parsed] = parseArtifactRefs(raw);
  assert.equal(parsed!.alt, "");
  assert.equal(serialiseArtifactRef(parsed!), raw);
});

test("parseArtifactRefs reports distinct offsets for duplicate refs", () => {
  const raw = "![a](expartifact:e1/a.png)";
  const markdown = `${raw} then ${raw}`;
  const refs = parseArtifactRefs(markdown);
  assert.equal(refs.length, 2);
  assert.notEqual(refs[0]!.start, refs[1]!.start);
  for (const ref of refs) {
    assert.equal(markdown.slice(ref.start, ref.end), raw);
  }
});

test("resolveArtifactRef covers resolved, missing experiment, missing artifact, stale", () => {
  const running = exp({
    id: "exp-run",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    artifacts: ["loss.png"],
  });
  const done = exp({ id: "exp-done", status: "done", artifacts: ["loss.png"] });

  const lookup: ArtifactLookup = {
    getExperiment: (id) => {
      if (id === "exp-run") return running;
      if (id === "exp-done") return done;
      return null;
    },
    nowMs: Date.parse("2026-01-01T00:05:00.000Z"),
  };

  assert.equal(
    resolveArtifactRef({ experimentId: "exp-done", artifactName: "loss.png" }, lookup).status,
    "resolved",
  );
  assert.equal(
    resolveArtifactRef({ experimentId: "missing", artifactName: "loss.png" }, lookup).status,
    "experiment_not_found",
  );
  assert.equal(
    resolveArtifactRef({ experimentId: "exp-done", artifactName: "other.png" }, lookup).status,
    "artifact_not_found",
  );
  assert.equal(
    resolveArtifactRef({ experimentId: "exp-run", artifactName: "loss.png" }, lookup).status,
    "experiment_stale",
  );
  assert.equal(
    resolveArtifactRef({ experimentId: "exp-run", artifactName: "missing.png" }, lookup).status,
    "artifact_not_found",
  );
});

test("resolveArtifactRef accepts a recent metric heartbeat", () => {
  const running = exp({
    id: "exp-run",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    artifacts: ["loss.png"],
  });
  const result = resolveArtifactRef(
    { experimentId: "exp-run", artifactName: "loss.png" },
    {
      getExperiment: () => running,
      nowMs: Date.parse("2026-01-01T00:05:00.000Z"),
      lastMetricAtMs: () => Date.parse("2026-01-01T00:04:30.000Z"),
    },
  );
  assert.equal(result.status, "resolved");
});

test("resolveArtifactRef matches basename against a signed URL and returns the live URL", () => {
  const signed = "https://cdn.test/plots/loss.png?token=abc";
  const done = exp({ id: "exp-done", status: "done", artifacts: [signed] });
  const result = resolveArtifactRef(
    { experimentId: "exp-done", artifactName: "loss.png" },
    { getExperiment: () => done },
  );
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.artifactName, signed);
  }
});

test("resolveArtifactRef fails closed on basename collisions", () => {
  const done = exp({
    id: "exp-done",
    status: "done",
    artifacts: [
      "https://cdn.test/a/loss.png?token=1",
      "https://cdn.test/b/loss.png?token=2",
    ],
  });
  const result = resolveArtifactRef(
    { experimentId: "exp-done", artifactName: "loss.png" },
    { getExperiment: () => done },
  );
  assert.equal(result.status, "artifact_not_found");
});
