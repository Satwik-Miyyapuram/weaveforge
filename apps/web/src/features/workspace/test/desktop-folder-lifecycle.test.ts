import assert from "node:assert/strict";
import { before, test } from "node:test";

import {
  chooseDesktopFolder,
  closeFolder,
  disconnectFolder,
  folderSession,
  missingDesktopFolder,
} from "../application/workspace-folder";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

/** A shell with a remembered folder that may be missing, and a log of what it was asked. */
function fakeShell(answers: { missing?: string | null; retry?: { path: string; warnings?: string[] } | null; forget?: string[] }) {
  const asked: string[] = [];
  const prefs: [string, unknown][] = [];
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    vaultRoot: () => Promise.resolve({ path: "/vault" }),
    chooseVaultRoot: () => Promise.resolve({ path: "/picked", warnings: ["The folder history could not be started."] }),
    writePreference: (key: string, value: unknown) => {
      prefs.push([key, value]);
      return Promise.resolve();
    },
    onVaultChange: () => () => {},
    missingVaultRoot: () => {
      asked.push("missing");
      return Promise.resolve(answers.missing ?? null);
    },
    retryVaultRoot: () => {
      asked.push("retry");
      return Promise.resolve(answers.retry ?? null);
    },
    forgetVaultRoot: () => {
      asked.push("forget");
      return Promise.resolve(answers.forget ?? []);
    },
  };
  (globalThis as { window?: unknown }).window = { weaveforge: bridge };
  return { asked, prefs };
}

test("a missing remembered folder is named, and a failed retry connects nothing", async (t) => {
  t.after(closeFolder);
  const shell = fakeShell({ missing: "E:/thesis", retry: null });
  assert.equal(await missingDesktopFolder(), "E:/thesis");
  assert.equal(await chooseDesktopFolder({ git: false, retry: true }), false);
  assert.equal(folderSession(), null);
  assert.deepEqual(shell.asked, ["missing", "retry"]);
});

test("a retry that finds the folder connects it with its warnings, and leaves the git choice alone", async (t) => {
  t.after(closeFolder);
  const shell = fakeShell({ retry: { path: "E:/thesis", warnings: ["late"] } });
  assert.deepEqual(await chooseDesktopFolder({ git: false, retry: true }), { warnings: ["late"] });
  assert.equal(folderSession()?.kind, "desktop");
  assert.deepEqual(shell.prefs, []);
});

test("a fresh pick carries the shell's warnings and records the git choice", async (t) => {
  t.after(closeFolder);
  const shell = fakeShell({});
  assert.deepEqual(await chooseDesktopFolder({ git: true }), { warnings: ["The folder history could not be started."] });
  assert.deepEqual(shell.prefs, [["vault-git", true]]);
});

test("disconnecting a desktop folder makes the shell forget it, and passes its warnings on", async (t) => {
  t.after(closeFolder);
  const shell = fakeShell({ forget: ["could not be forgotten"] });
  await chooseDesktopFolder({ git: false, reuse: true });
  assert.deepEqual(await disconnectFolder(), ["could not be forgotten"]);
  assert.equal(folderSession(), null);
  assert.deepEqual(shell.asked, ["forget"]);
});

test("disconnecting with no folder connected asks the shell nothing", async () => {
  const shell = fakeShell({});
  assert.deepEqual(await disconnectFolder(), []);
  assert.deepEqual(shell.asked, []);
});
