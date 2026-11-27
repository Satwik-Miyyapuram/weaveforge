import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  activeWorkspaceFs,
  chooseFolder,
  closeFolder,
  folderSession,
  onFolderConnected,
  openBrowserStorageFolder,
  syncToFolder,
} from "../application/workspace-folder";

before(loadTestCore);

/**
 * The two browser ways to take up a folder share one adopt sequence (29-18):
 * set the folder and its git, start following edits, sync, announce.
 */

/** An empty folder: every named file or folder is missing, as the browser reports it (NotFoundError). */
const missingEntry = (name: string) => Object.assign(new Error(`${name} not found`), { name: "NotFoundError" });
const dir = {
  kind: "directory",
  name: "root",
  async *entries() {},
  async getFileHandle(name: string) {
    throw missingEntry(name);
  },
  async getDirectoryHandle(name: string) {
    throw missingEntry(name);
  },
};

function stubBrowser(picker: (() => Promise<unknown>) | undefined): void {
  Object.defineProperty(globalThis, "showDirectoryPicker", { configurable: true, value: picker });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory: () => Promise.resolve(dir) } },
  });
}

afterEach(() => {
  closeFolder();
  Reflect.deleteProperty(globalThis, "showDirectoryPicker");
});

for (const git of [true, false]) {
  test(`a picked folder is adopted and announced (git ${git})`, async () => {
    stubBrowser(() => Promise.resolve(dir));
    let heard = 0;
    const off = onFolderConnected(() => heard++);
    assert.equal(await chooseFolder({ git }), true);
    off();
    assert.ok(activeWorkspaceFs());
    assert.equal(folderSession()?.git, git ? "isomorphic" : "none");
    assert.equal(heard, 1);
  });

  test(`browser storage is adopted and announced (git ${git})`, async () => {
    stubBrowser(undefined);
    let heard = 0;
    const off = onFolderConnected(() => heard++);
    await openBrowserStorageFolder({ git });
    off();
    assert.ok(activeWorkspaceFs());
    assert.equal(folderSession()?.git, git ? "isomorphic" : "none");
    assert.equal(heard, 1);
  });
}

test("F97-P2-19: adopting folder B tears folder A down first", async () => {
  stubBrowser(() => Promise.resolve(dir));
  assert.equal(await chooseFolder({ git: false }), true);
  const first = activeWorkspaceFs();
  assert.equal(await chooseFolder({ git: false }), true);
  assert.notEqual(activeWorkspaceFs(), first);
});

test("a dismissed picker adopts nothing and announces nothing", async () => {
  stubBrowser(() => Promise.reject(new Error("AbortError")));
  let heard = 0;
  const off = onFolderConnected(() => heard++);
  assert.equal(await chooseFolder({ git: true }), false);
  off();
  assert.equal(activeWorkspaceFs(), null);
  assert.equal(heard, 0);
});

test("no picker at all adopts nothing", async () => {
  stubBrowser(undefined);
  assert.equal(await chooseFolder({ git: false }), false);
  assert.equal(activeWorkspaceFs(), null);
});

// xlog-07: a listener failing does not undo the connection, and it is logged.
test("a connected listener that throws is logged, and the folder is still adopted", async (t) => {
  stubBrowser(() => Promise.resolve(dir));
  const warn = t.mock.method(console, "warn", () => undefined);
  const boom = new Error("listener exploded");
  let heard = 0;
  const offBad = onFolderConnected(() => {
    throw boom;
  });
  const off = onFolderConnected(() => heard++);
  assert.equal(await chooseFolder({ git: false }), true);
  offBad();
  off();
  assert.ok(activeWorkspaceFs());
  assert.equal(heard, 1);
  const failed = warn.mock.calls.filter((call) => call.arguments[0] === "[folder-connected] a listener failed:");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.arguments[1], boom);
});
