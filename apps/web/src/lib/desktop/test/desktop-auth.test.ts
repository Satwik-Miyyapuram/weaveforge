import assert from "node:assert/strict";
import { test } from "node:test";

import { AUTH_LINK_URL, AUTH_LOOPBACK_URL, authRedirectTo } from "../desktop-auth";

function withWindow(weaveforge: unknown, run: () => void): void {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = { location: { origin: "https://app.localhost" }, weaveforge };
  try {
    run();
  } finally {
    g.window = before;
  }
}
const shell = (platform: string) => ({ platform, fetchTitle: () => Promise.resolve(null) });

test("a browser returns to its own origin", () => {
  withWindow(undefined, () => {
    assert.equal(authRedirectTo(), "https://app.localhost");
  });
});

test("desktops return to the loopback listener", () => {
  for (const p of ["win32", "darwin", "linux"]) {
    withWindow(shell(p), () => {
      assert.equal(authRedirectTo(), AUTH_LOOPBACK_URL);
    });
  }
});

test("phones return to the app link", () => {
  for (const p of ["android", "ios"]) {
    withWindow(shell(p), () => {
      assert.equal(authRedirectTo(), AUTH_LINK_URL);
    });
  }
});

test("the app link is https on the app host", () => {
  const u = new URL(AUTH_LINK_URL);
  assert.equal(u.protocol, "https:");
  assert.equal(u.host, "app.weaveforge.org");
  assert.equal(u.pathname, "/auth/app-callback");
});

test("a half-built bridge reads as a browser", () => {
  withWindow({ platform: "android" }, () => {
    assert.equal(authRedirectTo(), "https://app.localhost");
  });
});

test("no window, no redirect", () => {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  delete g.window;
  try {
    assert.equal(authRedirectTo(), undefined);
  } finally {
    g.window = before;
  }
});
