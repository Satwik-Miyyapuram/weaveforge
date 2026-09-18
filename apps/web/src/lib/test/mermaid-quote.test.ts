import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteAwkwardLabels } from "../mermaid-render";

test("labels with parens or pipes are quoted", () => {
  const out = quoteAwkwardLabels("flowchart LR\n  X[image] --> Q[q(z|x)]\n  G --> P[GIN prior p(z|G)]");
  assert.equal(out, 'flowchart LR\n  X[image] --> Q["q(z|x)"]\n  G --> P["GIN prior p(z|G)"]');
});

test("quoted labels, plain labels and shaped brackets are untouched", () => {
  const src = 'A["q(z|x)"] --> B[(db)] --> C[[sub]] --> D[/par/] --> E{KL} -->|edge (x)| F';
  assert.equal(quoteAwkwardLabels(src), src);
});
