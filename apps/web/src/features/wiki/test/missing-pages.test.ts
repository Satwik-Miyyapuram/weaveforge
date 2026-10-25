import assert from "node:assert/strict";
import test from "node:test";

import { missingPagePlans } from "../application/build-wiki";

test("each dead-link target becomes one placeholder page", () => {
  const plans = missingPagePlans(["Diffusion Model", "VAE"]);
  assert.deepEqual(
    plans.map((plan) => plan.title),
    ["Diffusion Model", "VAE"],
  );
  assert.equal(plans[0]!.body, "# Diffusion Model\n\n_Not written yet._\n");
  assert.equal(plans[0]!.mentions, 1);
  assert.deepEqual(plans[0]!.sourceDocumentIds, []);
});

test("blank targets are dropped and repeats are one page", () => {
  const plans = missingPagePlans(["  GAN ", "GAN", "", "   "]);
  assert.deepEqual(
    plans.map((plan) => plan.title),
    ["GAN"],
  );
});

test("no targets, no plans", () => {
  assert.deepEqual(missingPagePlans([]), []);
});
