import { test } from "node:test";
import assert from "node:assert/strict";

import { goToRoute } from "../parts";

function run(route: string, pathname: string) {
  const pushed: string[] = [];
  const location = { pathname, hash: "" };
  goToRoute(route, (to) => pushed.push(to), location);
  return { pushed, hash: location.hash };
}

test("goToRoute: a plain route is pushed", () => {
  assert.deepEqual(run("/papers", "/settings"), { pushed: ["/papers"], hash: "" });
});

test("goToRoute: a hash route on another page is pushed whole", () => {
  assert.deepEqual(run("/settings#settings-calendar", "/papers"), { pushed: ["/settings#settings-calendar"], hash: "" });
});

test("goToRoute: a hash route on the open page only sets the hash, trailing slash or not", () => {
  assert.deepEqual(run("/settings#settings-calendar", "/settings"), { pushed: [], hash: "settings-calendar" });
  assert.deepEqual(run("/settings#settings-editor", "/settings/"), { pushed: [], hash: "settings-editor" });
});
