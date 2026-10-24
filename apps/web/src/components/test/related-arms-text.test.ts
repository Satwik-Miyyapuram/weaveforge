import { test } from "node:test";
import assert from "node:assert/strict";

import { armsText } from "../related-panel";

test("armsText joins the labelled methods and skips unlabelled ones (13-17)", () => {
  assert.equal(armsText(["graph", "none", "tags"]), "linked + shared tags");
  assert.equal(armsText(["semantic"]), "similar meaning");
  assert.equal(armsText(["none"]), "");
  assert.equal(armsText([]), "");
});
