import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { folderChangedMessage, noteFolderChanges } from "../ui/folder-change-note";

test("an auto-apply is said as a toast with the file count, until stopped", () => {
  let heard: ((count: number) => void) | null = null;
  const shown: string[] = [];
  const stop = noteFolderChanges(
    (listener) => {
      heard = listener;
      return () => {
        heard = null;
      };
    },
    (message) => shown.push(message),
  );
  heard!(3);
  heard!(1);
  assert.deepEqual(shown, ["Folder changed: 3 files reloaded.", "Folder changed: 1 file reloaded."]);
  stop();
  assert.equal(heard, null);
  assert.equal(folderChangedMessage(2), "Folder changed: 2 files reloaded.");
});

test("the app shell mounts the note on every screen", () => {
  const shell = readFileSync(new URL("../../../app/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<FolderChangeNote \/>/);
});
