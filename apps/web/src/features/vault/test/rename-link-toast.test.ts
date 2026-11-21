/**
 * A rename that could not rewrite every [[Old]] link says which notes still
 * hold one (F97 rename links): notes open in an editor, or that failed to save.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTestCore } from "@/lib/test/load-test-core";
import { toasts } from "@/lib/toast/parts";

import { toastLinkRewriteFailed } from "../ui/vault-screen/rename-link-toast";

before(loadTestCore);

const last = () => toasts.snapshot().at(-1)?.message;

test("a rename with notes left behind names them in a toast", () => {
  toastLinkRewriteFailed({ linkRewriteFailed: ["One", "Three"] });
  assert.equal(last(), "Renamed, but links in 2 notes still use the old title: One, Three");
});

test("one note left behind is said in the singular", () => {
  toastLinkRewriteFailed({ linkRewriteFailed: ["One"] });
  assert.equal(last(), "Renamed, but links in 1 note still use the old title: One");
});

test("a long list is cut after five names", () => {
  toastLinkRewriteFailed({ linkRewriteFailed: ["A", "B", "C", "D", "E", "F", "G"] });
  assert.equal(last(), "Renamed, but links in 7 notes still use the old title: A, B, C, D, E and 2 more");
});

test("a rename with every link rewritten shows no toast", () => {
  const before = toasts.snapshot();
  toastLinkRewriteFailed({});
  toastLinkRewriteFailed({ linkRewriteFailed: [] });
  assert.deepEqual(toasts.snapshot(), before);
});

test("both rename doors show the toast", () => {
  for (const rel of ["../ui/vault-screen/page-editor.tsx", "../../editor-workspace/ui/workspace-screen.tsx"]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.match(src, /toastLinkRewriteFailed\(await getContainer\(\)\.vault\.manageVaultPage\.update\([^)]*title/, rel);
  }
});
