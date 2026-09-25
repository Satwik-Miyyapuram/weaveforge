import assert from "node:assert/strict";
import test from "node:test";

import { closeAppDb, openAppDb, SCREEN_STORE } from "@/lib/cache/app-idb";
import { createFakeIndexedDb, type FakeIndexedDb } from "@/lib/test/fake-indexeddb.js";

/**
 * One connection, kept, and dropped when it stops being usable.
 *
 * The module used to open the database per operation — five modules, sixteen
 * call sites, so a screen load with a cache miss and a search warm-up opened it
 * a dozen times. Memoising that is only safe with the two handlers below: the
 * browser closes this handle when another tab upgrades the database, and without
 * noticing, the module would keep handing out a dead connection while every
 * caller swallowed the failure.
 */

/** The fake resolves `indexedDB.open` only when drained, so drain before awaiting. */
async function openSettled(idb: FakeIndexedDb) {
  const opened = openAppDb();
  await idb.settle(async () => {});
  return opened;
}

test("the database is opened once and shared", async () => {
  const idb = createFakeIndexedDb();
  idb.install();
  try {
    const first = openAppDb();
    const second = openAppDb();
    await idb.settle(async () => {});

    assert.equal(idb.opens, 1, "five stores share one connection");
    assert.equal(await first, await second);
    closeAppDb();
  } finally {
    idb.uninstall();
  }
});

test("a version change closes the handle and the next call reopens", async () => {
  const idb = createFakeIndexedDb();
  idb.install();
  try {
    await openSettled(idb);

    // Another tab opens a newer version: this connection is finished.
    idb.versionChange();
    assert.equal(idb.closes, 1, "the stale handle is closed rather than handed out again");

    await openSettled(idb);
    assert.equal(idb.opens, 2, "and the next call opens a fresh one");
    closeAppDb();
  } finally {
    idb.uninstall();
  }
});

test("closing lets the next call open again", async () => {
  const idb = createFakeIndexedDb();
  idb.install();
  try {
    await openSettled(idb);
    closeAppDb();

    await openSettled(idb);
    assert.equal(idb.opens, 2);
    closeAppDb();
  } finally {
    idb.uninstall();
  }
});

test("closing with nothing open is not an error", () => {
  closeAppDb();
  closeAppDb();
  assert.ok(true, "a device wipe may run before anything used the database");
});

test("the upgrade declares every store the caches use", async () => {
  const idb = createFakeIndexedDb();
  idb.install();
  try {
    // A fresh profile: the upgrade handler is the only thing that creates
    // stores, so one it forgets is a store that fails on its first write.
    const db = await openSettled(idb);
    assert.equal(db.objectStoreNames.contains(SCREEN_STORE), true);
    closeAppDb();
  } finally {
    idb.uninstall();
  }
});
