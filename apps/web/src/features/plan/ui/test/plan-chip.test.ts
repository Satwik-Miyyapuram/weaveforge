import { test } from "node:test";
import assert from "node:assert/strict";

import { planChipTarget } from "../plan-chip";

const experimentHref = (id: string) => `/experiments/${id}`;

const known = new Set(["p1", "e1", "m1"]);
const milestones = [{ id: "m1", title: "Pilot study" }];

test("paper and experiment chips link to their pages", () => {
  assert.deepEqual(planChipTarget({ kind: "paper", refId: "p1" }, known, milestones, experimentHref), {
    kind: "link",
    href: "/papers?paper=p1",
    external: false,
  });
  const exp = planChipTarget({ kind: "experiment", refId: "e1" }, known, milestones, experimentHref);
  assert.equal(exp.kind, "link");
  assert.match((exp as { href: string }).href, /^\/experiments\/.*e1/);
});

test("milestone chips jump, by id or by title", () => {
  assert.deepEqual(planChipTarget({ kind: "milestone", refId: "m1" }, known, milestones, experimentHref), { kind: "jump", milestoneId: "m1" });
  assert.deepEqual(planChipTarget({ kind: "milestone", label: "Pilot study" }, known, milestones, experimentHref), { kind: "jump", milestoneId: "m1" });
});

test("a deleted target is missing", () => {
  for (const kind of ["paper", "experiment", "milestone"] as const) {
    assert.deepEqual(planChipTarget({ kind, refId: "gone" }, known, milestones, experimentHref), { kind: "missing" });
  }
});

test("external chips link only when they hold a URL", () => {
  assert.deepEqual(planChipTarget({ kind: "external", label: "https://hpc.example.org/apply" }, known, milestones, experimentHref), {
    kind: "link",
    href: "https://hpc.example.org/apply",
    external: true,
  });
  assert.deepEqual(planChipTarget({ kind: "external", label: "Supervisor sign-off" }, known, milestones, experimentHref), { kind: "plain" });
});
