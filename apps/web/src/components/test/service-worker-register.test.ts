/**
 * The desktop build has no web server, so it must not register /sw.js, which
 * would add a second cache beside the desktop's own (next.config disables the
 * worker in that build, and this keeps the runtime in step with it).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { shouldRegisterOfflineWorker } from "../service-worker-register";

test("the web build registers the offline worker", () => {
  assert.equal(shouldRegisterOfflineWorker(false), true);
});

test("the desktop build does not register the offline worker", () => {
  assert.equal(shouldRegisterOfflineWorker(true), false);
});
