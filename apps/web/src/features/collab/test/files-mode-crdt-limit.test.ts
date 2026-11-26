import assert from "node:assert/strict";
import { test } from "node:test";

import type { CrdtUpdateRecord, ICrdtUpdateStore } from "@weaveforge/core";

import {
  FILES_MODE_CRDT_MESSAGE,
  FILES_MODE_CRDT_TYPES,
  limitCrdtSnapshotStore,
  limitCrdtUpdateStore,
  transportBanner,
} from "../infrastructure/files-mode-crdt-limit";

// In files mode the CRDT log lives on the server, so only the two resource types
// that are not personal documents may be written there. Personal types must not
// reach the server log: writes are refused and reads see an empty log.

function record(id: number, resourceType: string): CrdtUpdateRecord {
  return {
    id,
    resourceType,
    resourceId: "r-1",
    projectId: null,
    epoch: 1,
    payload: new Uint8Array([1]),
    authorId: null,
    createdAt: "2026-11-22T00:00:00.000Z",
  };
}

function spyStore(): { store: ICrdtUpdateStore; calls: string[] } {
  const calls: string[] = [];
  const store: ICrdtUpdateStore = {
    append: async (input) => {
      calls.push(`append:${input.resourceType}`);
      return record(1, input.resourceType);
    },
    listAfter: async (type) => {
      calls.push(`listAfter:${type}`);
      return [record(2, type)];
    },
    deleteUpTo: async (type) => {
      calls.push(`deleteUpTo:${type}`);
    },
    countAfter: async (type) => {
      calls.push(`countAfter:${type}`);
      return 3;
    },
    compact: async (input) => {
      calls.push(`compact:${input.resourceType}`);
      return { status: "no-op", reason: "nothing-to-do" };
    },
  };
  return { store, calls };
}

const appendInput = (resourceType: string) => ({
  resourceType,
  resourceId: "r-1",
  projectId: null,
  epoch: 1,
  payload: new Uint8Array([1]),
  authorId: "u-1",
});

test("files mode allows only experiment and lab_snapshot in the CRDT log", () => {
  assert.deepEqual([...FILES_MODE_CRDT_TYPES].sort(), ["experiment", "lab_snapshot"]);
});

test("files mode refuses to append a personal update and never reaches the server log", async () => {
  const { store, calls } = spyStore();
  const limited = limitCrdtUpdateStore(store, FILES_MODE_CRDT_TYPES);
  await assert.rejects(() => limited.append(appendInput("paper")), new Error(FILES_MODE_CRDT_MESSAGE));
  assert.deepEqual(calls, []);
});

test("files mode still appends the allowed resource types", async () => {
  const { store, calls } = spyStore();
  const limited = limitCrdtUpdateStore(store, FILES_MODE_CRDT_TYPES);
  assert.equal((await limited.append(appendInput("experiment"))).resourceType, "experiment");
  assert.equal((await limited.append(appendInput("lab_snapshot"))).resourceType, "lab_snapshot");
  assert.deepEqual(calls, ["append:experiment", "append:lab_snapshot"]);
});

test("files mode refuses personal deletes and compaction, and reads an empty log for personal types", async () => {
  const { store, calls } = spyStore();
  const limited = limitCrdtUpdateStore(store, FILES_MODE_CRDT_TYPES);
  await assert.rejects(() => limited.deleteUpTo("paper", "r-1", 5), new Error(FILES_MODE_CRDT_MESSAGE));
  await assert.rejects(
    () => limited.compact({ resourceType: "paper", resourceId: "r-1", uptoId: 5 }),
    new Error(FILES_MODE_CRDT_MESSAGE),
  );
  assert.deepEqual(await limited.listAfter("paper", "r-1"), []);
  assert.equal(await limited.countAfter("paper", "r-1"), 0);
  assert.deepEqual(calls, []);
});

test("files mode reads the allowed types through", async () => {
  const { store } = spyStore();
  const limited = limitCrdtUpdateStore(store, FILES_MODE_CRDT_TYPES);
  assert.equal((await limited.listAfter("experiment", "r-1")).length, 1);
  assert.equal(await limited.countAfter("lab_snapshot", "r-1"), 3);
});

test("files mode reports a zero watermark for personal types without asking the server", async () => {
  const seen: string[] = [];
  const snapshot = {
    getSnapshotUpto: async (type: string) => {
      seen.push(type);
      return 9;
    },
  };
  const limited = limitCrdtSnapshotStore(snapshot, FILES_MODE_CRDT_TYPES);
  assert.equal(await limited.getSnapshotUpto("paper", "r-1"), 0);
  assert.equal(await limited.getSnapshotUpto("experiment", "r-1"), 9);
  assert.deepEqual(seen, ["experiment"]);
});

// The folder is the truth in files mode: the log refusing a personal note is expected, so no banner says sync failed.
test("transportBanner hides the files-mode refusal and keeps other errors", () => {
  assert.equal(transportBanner("persist", FILES_MODE_CRDT_MESSAGE), null);
  assert.equal(transportBanner("persist", `Error: ${FILES_MODE_CRDT_MESSAGE}`), null);
  assert.equal(transportBanner("connect", "socket closed"), "connect: socket closed");
});
