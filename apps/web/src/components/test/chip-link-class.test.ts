/**
 * A clickable chip is a chip, not a text link. states.css underlines every
 * `.link`, so a chip that carried that class drew a split underline under its
 * kind and its label. Chips mark themselves clickable with `is-link`.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(root + rel, "utf8");

test("no chip carries the text-link class", () => {
  for (const rel of ["features/plan/ui/milestone-card.tsx", "features/experiments/ui/experiment-panels.tsx"]) {
    assert.doesNotMatch(read(rel), /className=\{?[`"][^`"]*chip[^`"]*\slink[`"]/, rel);
  }
  for (const f of readdirSync(root + "app/styles")) {
    if (!f.endsWith(".css")) continue;
    assert.doesNotMatch(read(`app/styles/${f}`), /chip\.link\b/, f);
  }
});
