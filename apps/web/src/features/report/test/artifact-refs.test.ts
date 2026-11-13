import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";

before(async () => {
  await loadTestCore();
});

test("parseArtifactRefs finds a single ref", () => {
  const md = "See ![loss](expartifact:exp1/loss.png) above.";
  const refs = readyCore().parseArtifactRefs(md);
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

test("parseArtifactRefs uses UTF-16 offsets after non-ASCII text", () => {
  const md = "é 😀 ![a](expartifact:e1/a.png)";
  const [ref] = readyCore().parseArtifactRefs(md);
  assert.equal(ref!.start, 5);
  assert.equal(md.slice(ref!.start, ref!.end), ref!.raw);
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
  const refs = readyCore().parseArtifactRefs(md);
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.experimentId, "e1");
  assert.equal(refs[0]!.artifactName, "a.png");
  assert.equal(refs[1]!.experimentId, "e2");
  assert.equal(refs[1]!.artifactName, "subdir/b.webp");
});

test("parseArtifactRefs returns empty when there are no refs", () => {
  assert.deepEqual(readyCore().parseArtifactRefs("Just [[Note]] and text."), []);
  assert.deepEqual(readyCore().parseArtifactRefs(""), []);
});

test("serialiseArtifactRef round-trips with parse", () => {
  const raw = readyCore().serialiseArtifactRef({
    experimentId: "exp-9",
    artifactName: "plots/acc.png",
    alt: "Accuracy",
  });
  assert.equal(raw, "![Accuracy](expartifact:exp-9/plots%2Facc.png)");
  const [parsed] = readyCore().parseArtifactRefs(`Intro ${raw} outro`);
  assert.equal(parsed!.experimentId, "exp-9");
  assert.equal(parsed!.artifactName, "plots/acc.png");
  assert.equal(parsed!.alt, "Accuracy");
  assert.equal(readyCore().serialiseArtifactRef(parsed!), raw);
});

test("serialiseArtifactRef encodes whitespace and closing parentheses", () => {
  const raw = readyCore().serialiseArtifactRef({
    experimentId: "exp 9",
    artifactName: "plots/loss (1).png",
    alt: "Loss",
  });
  assert.equal(raw, "![Loss](expartifact:exp%209/plots%2Floss%20%281%29.png)");
  const [parsed] = readyCore().parseArtifactRefs(raw);
  assert.deepEqual(
    { experimentId: parsed!.experimentId, artifactName: parsed!.artifactName },
    { experimentId: "exp 9", artifactName: "plots/loss (1).png" },
  );
  assert.equal(readyCore().serialiseArtifactRef(parsed!), raw);
});

test("serialiseArtifactRef strips brackets from alt so parse round-trips", () => {
  const raw = readyCore().serialiseArtifactRef({
    experimentId: "e1",
    artifactName: "a.png",
    alt: "Fig [1]",
  });
  assert.equal(raw, "![Fig 1](expartifact:e1/a.png)");
  const [parsed] = readyCore().parseArtifactRefs(raw);
  assert.equal(parsed!.alt, "Fig 1");
  assert.equal(readyCore().serialiseArtifactRef(parsed!), raw);
});

test("serialiseArtifactRef preserves an explicit empty alt", () => {
  const raw = readyCore().serialiseArtifactRef({
    experimentId: "e1",
    artifactName: "a.png",
    alt: "",
  });
  assert.equal(raw, "![](expartifact:e1/a.png)");
  const [parsed] = readyCore().parseArtifactRefs(raw);
  assert.equal(parsed!.alt, "");
  assert.equal(readyCore().serialiseArtifactRef(parsed!), raw);
});

test("parseArtifactRefs skips malformed and invalid encoded paths", () => {
  assert.deepEqual(
    readyCore().parseArtifactRefs(
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
  const refs = readyCore().parseArtifactRefs(
    "![a](expartifact:e1/100%done.png) ![b](expartifact:e1/%ZZ)",
  );
  assert.equal(refs.length, 2);
  assert.equal(refs[0]!.artifactName, "100%done.png");
  assert.equal(refs[1]!.artifactName, "%ZZ");
});

test("parseArtifactRefs reports distinct offsets for duplicate refs", () => {
  const raw = "![a](expartifact:e1/a.png)";
  const markdown = `${raw} then ${raw}`;
  const refs = readyCore().parseArtifactRefs(markdown);
  assert.equal(refs.length, 2);
  assert.notEqual(refs[0]!.start, refs[1]!.start);
  for (const ref of refs) {
    assert.equal(markdown.slice(ref.start, ref.end), raw);
  }
});

test("artifactBasename strips query strings, directories and URL escapes", () => {
  assert.equal(readyCore().artifactBasename("https://cdn.test/plots/loss.png?token=abc"), "loss.png");
  assert.equal(readyCore().artifactBasename("https://cdn.test/my%20plot.png"), "my plot.png");
  assert.equal(readyCore().artifactBasename("loss.png"), "loss.png");
  assert.equal(readyCore().artifactBasename("runs\\loss.png"), "loss.png");
  assert.equal(readyCore().artifactBasename("   "), "");
});
