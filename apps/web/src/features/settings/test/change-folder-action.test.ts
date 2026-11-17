import assert from "node:assert/strict";
import { before, test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTestCore } from "@/lib/test/load-test-core";
import { closeFolder } from "@/features/workspace/application/workspace-folder";
import { CHANGE_FOLDER_NOTE, ChangeFolderAction, changeFolderWork } from "../ui/change-folder-action";

before(async () => {
  await loadTestCore();
});

/** A shell whose folder dialog answers `root` (null = the reader cancelled). */
function fakeShell(root: { path: string; warnings?: string[] } | null) {
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve(null),
      vaultRoot: () => Promise.resolve(null),
      chooseVaultRoot: () => Promise.resolve(root),
      writePreference: () => Promise.resolve(),
      onVaultChange: () => () => {},
    },
  };
}

test("Change folder says what moves and what stays, and is disabled while another job runs", () => {
  const idle = renderToStaticMarkup(
    createElement(ChangeFolderAction, { busy: null, run: async () => {}, onChanged: () => {} }),
  );
  assert.equal(CHANGE_FOLDER_NOTE, "Moves where your files are mirrored; nothing is deleted.");
  assert.match(idle, /Moves where your files are mirrored; nothing is deleted\./);
  assert.match(idle, /<button(?![^>]*disabled)[^>]*>Change folder…<\/button>/);

  const other = renderToStaticMarkup(
    createElement(ChangeFolderAction, { busy: "disconnect", run: async () => {}, onChanged: () => {} }),
  );
  assert.match(other, /<button[^>]*disabled[^>]*>Change folder…<\/button>/);

  const picking = renderToStaticMarkup(
    createElement(ChangeFolderAction, { busy: "change", run: async () => {}, onChanged: () => {} }),
  );
  assert.match(picking, /<button[^>]*disabled[^>]*>Choosing…<\/button>/);
});

test("Change folder hands the shell's warnings on, and a cancelled dialog hands nothing", async (t) => {
  t.after(closeFolder);
  fakeShell({ path: "/picked", warnings: ["The folder is not watched for changes."] });
  let seen: readonly string[] | null = null;
  await changeFolderWork((warnings) => {
    seen = warnings;
  })();
  assert.deepEqual(seen, ["The folder is not watched for changes."]);

  fakeShell(null);
  let calledAgain = false;
  await changeFolderWork(() => {
    calledAgain = true;
  })();
  assert.equal(calledAgain, false);
});
