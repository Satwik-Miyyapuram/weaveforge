import { strict as assert } from "node:assert";
import { test } from "node:test";

import { finishedLinks } from "@/components/markdown/markdown-editor-extensions";

test("a link the caret has left is finished; one it is still inside is not", () => {
  const doc = "see [[Alpha]] and [[Be]] here";
  const insideBe = doc.indexOf("Be") + 2;
  assert.deepEqual(finishedLinks(doc, insideBe), ["Alpha"]);
  assert.deepEqual(finishedLinks(doc, doc.length), ["Alpha", "Be"]);
  assert.deepEqual(finishedLinks(doc, -1), ["Alpha", "Be"]);
});

test("an alias or heading names its target", () => {
  assert.deepEqual(finishedLinks("[[Alpha|the first]] [[Beta#Intro]]", 0), ["Alpha", "Beta"]);
});
