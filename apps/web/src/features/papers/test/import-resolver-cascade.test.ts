// Adding a paper by DOI or arXiv id must not stop at the first source that
// says no: Crossref 404s DataCite DOIs and the arXiv relay can be down, while
// Semantic Scholar still knows the paper. The import resolver cascades.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const container = readFileSync(new URL("../../../create-app-container.ts", import.meta.url), "utf8");

test("the import resolver tries the next source when one fails", () => {
  const importResolver = /const resolver = new MetadataResolver\(\s*\[[^;]*\]\s*(?:,\s*(\w+))?\s*\);/.exec(container);
  assert.ok(importResolver, "import resolver not found");
  assert.equal(importResolver[1], "true");
});
