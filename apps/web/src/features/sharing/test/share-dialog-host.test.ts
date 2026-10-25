import assert from "node:assert/strict";
import test from "node:test";

import { replaceRequest, type ShareDialogRequest } from "../ui/share-dialog-host";

const request = (onClose?: () => void): ShareDialogRequest => ({
  resourceType: "paper",
  resourceId: "p1",
  title: "A paper",
  onClose,
});

test("a second share request closes the first one, so its button resets (33-10)", () => {
  let closed = 0;
  const first = { token: 1, value: request(() => (closed += 1)) };
  const second = { token: 2, value: request() };
  assert.equal(replaceRequest(first, second), second);
  assert.equal(closed, 1);
});

test("the first request has nothing to close", () => {
  const next = { token: 1, value: request() };
  assert.equal(replaceRequest(null, next), next);
});

test("a replaced request without onClose is dropped quietly", () => {
  const next = { token: 2, value: request() };
  assert.doesNotThrow(() => replaceRequest({ token: 1, value: request() }, next));
});
