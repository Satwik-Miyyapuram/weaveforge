/**
 * The ink save-status tracker: pending count and failure flag, with a
 * snapshot that only changes when the status does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  beginInkSave,
  getInkSaveStatus,
  subscribeInkSaveStatus,
} from "../application/parts";

test("initial status is idle and not failed", () => {
  assert.deepEqual(getInkSaveStatus(), { pending: 0, failed: false });
});

test("begin marks one pending save and notifies once", () => {
  let calls = 0;
  const unsubscribe = subscribeInkSaveStatus(() => {
    calls++;
  });
  const done = beginInkSave();
  try {
    assert.equal(getInkSaveStatus().pending, 1);
    assert.equal(getInkSaveStatus().failed, false);
    assert.equal(calls, 1);
  } finally {
    done(true);
    unsubscribe();
  }
});

test("successful settle clears pending and notifies", () => {
  let calls = 0;
  const unsubscribe = subscribeInkSaveStatus(() => {
    calls++;
  });
  const done = beginInkSave();
  const before = calls;
  done(true);
  unsubscribe();
  assert.deepEqual(getInkSaveStatus(), { pending: 0, failed: false });
  assert.ok(calls > before);
});

test("failed settle clears pending and sets failed", () => {
  const done = beginInkSave();
  done(false);
  assert.deepEqual(getInkSaveStatus(), { pending: 0, failed: true });
});

test("a later successful save clears the failed flag", () => {
  const failed = beginInkSave();
  failed(false);
  assert.equal(getInkSaveStatus().failed, true);

  const done = beginInkSave();
  done(true);
  assert.equal(getInkSaveStatus().pending, 0);
  assert.equal(getInkSaveStatus().failed, false);
});

test("overlapping saves count down independently", () => {
  const first = beginInkSave();
  const second = beginInkSave();
  assert.equal(getInkSaveStatus().pending, 2);

  first(true);
  assert.equal(getInkSaveStatus().pending, 1);

  second(true);
  assert.equal(getInkSaveStatus().pending, 0);
});

test("settling the same save twice is ignored", () => {
  const done = beginInkSave();
  done(true);
  assert.equal(getInkSaveStatus().pending, 0);

  let calls = 0;
  const unsubscribe = subscribeInkSaveStatus(() => {
    calls++;
  });
  try {
    done(true);
    assert.equal(getInkSaveStatus().pending, 0);
    assert.equal(calls, 0);
  } finally {
    unsubscribe();
  }
});

test("unsubscribed listeners are not called", () => {
  let calls = 0;
  const unsubscribe = subscribeInkSaveStatus(() => {
    calls++;
  });
  unsubscribe();

  const done = beginInkSave();
  done(true);
  assert.equal(calls, 0);
});

test("status snapshot is reused while nothing changes", () => {
  const first = getInkSaveStatus();
  const second = getInkSaveStatus();
  assert.equal(first, second);
});
