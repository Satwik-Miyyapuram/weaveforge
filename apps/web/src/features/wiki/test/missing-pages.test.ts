import assert from "node:assert/strict";
import test from "node:test";

import { LexicalConceptExtractor, planWikiPages } from "@weaveforge/core";

import { missingPagePlans, takenTitles } from "../application/build-wiki";

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

test("a scan never proposes a page whose title an ordinary note already has (E37)", async () => {
  // "Notation" is a plain note, not a wiki page. A wiki page of the same name
  // would make every [[Notation]] ambiguous.
  const pages = [
    { id: "n1", title: "Notation", body: "Symbols.", parentId: null },
    { id: "root", title: "Wiki", body: "", parentId: null },
    { id: "w1", title: "GAN", body: "", parentId: "root" },
  ];
  const taken = takenTitles(pages);
  assert.deepEqual([...taken].sort(), ["GAN", "Notation", "Wiki"]);

  const documents = [
    { id: "a", title: "A", text: "See [[Notation]] for Notation and the VAE." },
    { id: "b", title: "B", text: "Notation again, and the VAE again." },
  ];
  const extraction = await new LexicalConceptExtractor().extract({ documents, existingConcepts: [] });
  const plans = planWikiPages({ extraction, existingTitles: taken });
  assert.ok(!plans.some((plan) => plan.title.toLowerCase() === "notation"), JSON.stringify(plans.map((p) => p.title)));
});
