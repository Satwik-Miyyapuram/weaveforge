import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { DesktopOverleafSync, DesktopOverleafSyncRequest } from "@/lib/desktop/desktop-bridge";
import { loadTestCore } from "@/lib/test/load-test-core";

import {
  describeOverleafSync,
  overleafSync,
  overleafSyncAvailable,
  saveOverleafToken,
} from "../application/overleaf-folder-sync";

function fakeShell() {
  const calls: unknown[][] = [];
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    overleafSync: (request: DesktopOverleafSyncRequest): Promise<DesktopOverleafSync> => {
      calls.push(["sync", request]);
      return Promise.resolve({ links: [], hasToken: false });
    },
    writeSecret: (name: string, value: string) => {
      calls.push(["secret", name, value]);
      return Promise.resolve();
    },
  };
  (globalThis as { window?: unknown }).window = { weaveforge: bridge };
  return calls;
}

test("not available in a browser, or on a shell without Overleaf sync", async () => {
  delete (globalThis as { window?: unknown }).window;
  assert.equal(overleafSyncAvailable(), false);
  await assert.rejects(overleafSync({ action: "list" }), /desktop app/);
  (globalThis as { window?: unknown }).window = { weaveforge: { fetchTitle: () => Promise.resolve(null) } };
  assert.equal(overleafSyncAvailable(), false);
  fakeShell();
  assert.equal(overleafSyncAvailable(), true);
});

test("requests go to the shell as typed; the token is trimmed and an empty one refused", async () => {
  const calls = fakeShell();
  await overleafSync({ action: "link", projectId: "abc", folder: "Overleaf/a" });
  await assert.rejects(saveOverleafToken("   "), /token/);
  await saveOverleafToken("  olp_x \n");
  assert.deepEqual(calls, [
    ["sync", { action: "link", projectId: "abc", folder: "Overleaf/a" }],
    ["secret", "overleaf-token", "olp_x"],
  ]);
});

before(async () => {
  await loadTestCore();
});

test("one line per reply", async () => {
  const base = { links: [], hasToken: true };
  assert.equal(await describeOverleafSync({ ...base, pull: { kind: "up-to-date" } }), "Already up to date.");
  assert.equal(await describeOverleafSync({ ...base, push: { kind: "pushed" } }), "Pushed.");
  assert.equal(await describeOverleafSync({ ...base, status: { url: null, branch: "master", ahead: 0, behind: 0 } }), "Not pulled yet.");
  assert.equal(await describeOverleafSync({ ...base, status: { url: "u", branch: "master", ahead: 0, behind: 0 } }), "In step with Overleaf.");
  assert.equal(await describeOverleafSync({ ...base, status: { url: "u", branch: "master", ahead: 1, behind: 2 } }), "1 commit to push, 2 to pull.");
  assert.equal(await describeOverleafSync(base), "");
});
