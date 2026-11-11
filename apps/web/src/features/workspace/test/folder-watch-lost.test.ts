import assert from "node:assert/strict";
import { test } from "node:test";

import { folderWatchLost, onFolderWatchLost, watchForLoss } from "../application/parts";

/** A shell whose watch can be made to say it lost the folder. */
function fakeShell() {
  let say: ((reason: string) => void) | null = null;
  let stopped = 0;
  return {
    bridge: {
      onVaultWatchLost(cb: (reason: string) => void) {
        say = cb;
        return () => {
          stopped += 1;
          say = null;
        };
      },
    },
    lose: (reason: string) => say?.(reason),
    stopped: () => stopped,
  };
}

test("a lost watch is said to listeners with the shell's reason", () => {
  const shell = fakeShell();
  const heard: (string | null)[] = [];
  const unlisten = onFolderWatchLost((r) => heard.push(r));
  const stop = watchForLoss(shell.bridge);
  shell.lose("The workspace folder is gone.");
  assert.equal(folderWatchLost(), "The workspace folder is gone.");
  assert.deepEqual(heard, ["The workspace folder is gone."]);
  stop();
  unlisten();
});

test("stopping the watch stops hearing the shell and forgets the reason", () => {
  const shell = fakeShell();
  const stop = watchForLoss(shell.bridge);
  shell.lose("gone");
  stop();
  assert.equal(shell.stopped(), 1);
  assert.equal(folderWatchLost(), null);
  shell.lose("gone again");
  assert.equal(folderWatchLost(), null);
});

test("the same reason twice is said once", () => {
  const shell = fakeShell();
  const heard: (string | null)[] = [];
  const stop = watchForLoss(shell.bridge);
  const unlisten = onFolderWatchLost((r) => heard.push(r));
  shell.lose("gone");
  shell.lose("gone");
  assert.deepEqual(heard, ["gone"]);
  unlisten();
  stop();
});

test("a shell without the lost signal is a quiet no-op", () => {
  const stop = watchForLoss({});
  assert.equal(folderWatchLost(), null);
  stop();
  assert.equal(folderWatchLost(), null);
});
