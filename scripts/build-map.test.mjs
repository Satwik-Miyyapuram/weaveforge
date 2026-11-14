import { test } from "node:test";
import assert from "node:assert/strict";

import { build, headingExists, resolveLine, validate } from "./build-map.mjs";

const files = {
  "src/a.tsx": "const x = 1;\nfunction onSave() {}\n",
  "src/s.ts": "export function save() {}\n",
  "docs/h.md": "# Home\n## Add a paper\n",
  "docs/a.md": "",
};
const labels = ["Save", "Open"];

const fakes = {
  readFile: (file) => files[file] ?? null,
  exists: (file) => file in files,
  labelExists: (label) => labels.includes(label),
};

function fixture() {
  return [
    {
      id: "a",
      name: "Area",
      blurb: "blurb",
      docs: [{ path: "docs/a.md", title: "A" }],
      stages: [{ name: "Stage", journeys: ["j"] }],
      journeys: [
        {
          id: "j",
          name: "Journey",
          blurb: "blurb",
          help: { path: "docs/h.md", heading: "Add a paper" },
          steps: [
            { title: "one", text: "t", ui: { verb: "Click", label: "Save" }, hops: [1] },
            { title: "two", text: "t", ui: "Open", hops: [2] },
          ],
          chain: [
            { n: 1, layer: "ui", fn: "onSave", path: "src/a.tsx", sym: "onSave" },
            { n: 2, by: 1, layer: "service", fn: "save", path: "src/s.ts", sym: "export function save" },
          ],
          debug: [{ see: "x", check: 2 }],
        },
      ],
    },
  ];
}

function withJourney(mutate) {
  const areas = fixture();
  mutate(areas[0].journeys[0], areas[0]);
  return areas;
}

test("resolveLine finds, misses and prefers the match nearest the hint", () => {
  const text = "foo\nbar\nfoo\n\n\n\n\nfoo\n\n\n\n\n\n\n\n\n\n\n\nfoo";
  assert.equal(resolveLine(text, "bar", undefined), 2);
  assert.equal(resolveLine(text, "nope", undefined), null);
  assert.equal(resolveLine(text, "foo", undefined), 1);
  assert.equal(resolveLine(text, "foo", 9), 8);
  assert.equal(resolveLine(text, "foo", 18), 20);
});

test("headingExists matches the exact heading text only", () => {
  const md = "# Home\n## Add a paper\n";
  assert.equal(headingExists(md, "Add a paper"), true);
  assert.equal(headingExists(md, "Add"), false);
  assert.equal(headingExists("Add a paper", "Add a paper"), false);
});

test("validate returns no errors for a valid fixture", () => {
  assert.deepEqual(validate(fixture(), fakes), []);
});

test("validate catches a bad layer", () => {
  const areas = withJourney((j) => {
    j.chain[0].layer = "gui";
  });
  assert.deepEqual(validate(areas, fakes), ["j hop 1: bad layer \"gui\""]);
});

test("validate catches a by reference to a missing n", () => {
  const areas = withJourney((j) => {
    j.chain[1].by = 9;
  });
  assert.deepEqual(validate(areas, fakes), ["j hop 2: by 9 not in chain"]);
});

test("validate catches a step hop that is missing", () => {
  const areas = withJourney((j) => {
    j.steps[0].hops = [7];
  });
  assert.deepEqual(validate(areas, fakes), ["j step 1: hop 7 not in chain"]);
});

test("validate catches a debug check that is missing", () => {
  const areas = withJourney((j) => {
    j.debug[0].check = 5;
  });
  assert.deepEqual(validate(areas, fakes), ["j debug: check 5 not in chain"]);
});

test("validate catches a sym not found in its file", () => {
  const areas = withJourney((j) => {
    j.chain[0].sym = "nope";
  });
  assert.deepEqual(validate(areas, fakes), ['j hop 1: "nope" not found in src/a.tsx']);
});

test("validate catches a help heading that is missing", () => {
  const areas = withJourney((j) => {
    j.help.heading = "Remove a paper";
  });
  assert.deepEqual(validate(areas, fakes), ['j help: heading "Remove a paper" not found in docs/h.md']);
});

test("validate catches an unknown UI label", () => {
  const areas = withJourney((j) => {
    j.steps[0].ui = { verb: "Click", label: "Delete" };
  });
  assert.deepEqual(validate(areas, fakes), ['j step 1: UI label "Delete" not found in apps/web/src']);
});

test("validate catches a journey that is in no stage", () => {
  const areas = withJourney((_j, area) => {
    area.stages = [{ name: "Stage", journeys: [] }];
  });
  assert.deepEqual(validate(areas, fakes), ["j: in 0 stages, expected exactly one"]);
});

test("build sets line, drops sym and sets checked", () => {
  const map = build(fixture(), { ...fakes, ref: "abc1234", repo: "https://github.com/o/r" });
  assert.equal(map.repo, "https://github.com/o/r");
  assert.equal(map.ref, "abc1234");
  assert.equal("localRoot" in map, false);
  const journey = map.areas[0].journeys[0];
  assert.equal(journey.checked, "abc1234");
  assert.deepEqual(journey.chain[0], { n: 1, layer: "ui", fn: "onSave", path: "src/a.tsx", line: 2 });
  assert.equal(journey.chain[1].line, 1);
  assert.equal("sym" in journey.chain[1], false);
});
