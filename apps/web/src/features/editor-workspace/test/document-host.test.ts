import { test } from "node:test";
import assert from "node:assert/strict";

import { tabForHref } from "../ui/document-host";

test("a resolver href reads back as the tab it names", () => {
  assert.deepEqual(tabForHref("/notes?page=n1"), { kind: "vault_page", id: "n1" });
  assert.deepEqual(tabForHref("/papers?paper=p1"), { kind: "paper", id: "p1" });
  assert.deepEqual(tabForHref("/report?section=s1"), { kind: "report_section", id: "s1" });
});

test("anything else is not a tab", () => {
  assert.equal(tabForHref(null), null);
  assert.equal(tabForHref("/notes"), null);
  assert.equal(tabForHref("https://example.com/notes?page=n1"), null);
});
