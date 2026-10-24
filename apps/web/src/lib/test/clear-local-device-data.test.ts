/**
 * What a sign-out leaves behind in this browser.
 *
 * The wipe removed `tt:` and `thesis.` keys only, so the open tabs, explorer
 * state and per-project choices under `weaveforge.` and `wf.` stayed, and the
 * downloaded PDFs and saved paper HTML stayed in their own IndexedDB databases
 * for whoever used the device next. Pure device preferences (pen, ink, reader
 * look) and the local-mode choice are kept: they say nothing about the account.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLocalDeviceData } from "@/lib/desktop/clear-local-device-data";
import { PAPER_HTML_DB_NAME, PDF_CACHE_DB_NAME } from "@/features/reader/infrastructure/local-cache-names";

/** A Storage whose items are own enumerable properties, as in a browser. */
class FakeStorage {
  [key: string]: unknown;
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this, key) ? String(this[key]) : null;
  }
  setItem(key: string, value: string): void {
    this[key] = value;
  }
  removeItem(key: string): void {
    delete this[key];
  }
}

/** Every open fails (nothing to clear), every delete succeeds and is recorded. */
function fakeIndexedDb(deleted: string[]) {
  return {
    open() {
      const req: { error?: Error; onerror?: () => void } = {};
      queueMicrotask(() => {
        req.error = new Error("no database in this test");
        req.onerror?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      deleted.push(name);
      const req: { onsuccess?: () => void } = {};
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

const CLEARED = [
  "tt:session",
  "thesis.startup.org",
  "weaveforge.editor.layout",
  "weaveforge.explorer.expanded",
  "weaveforge.explorer.sections",
  "weaveforge.explorer.roots-migrated",
  "wf.tags.deferredReconcile",
  "wf.mm-signin.project-of-another-org",
  "weaveforge.some-future-key",
];

const KEPT = [
  "weaveforge.local-mode",
  "weaveforge.local-first",
  "weaveforge.ink.penOnly",
  "weaveforge.ink.quick-colours",
  "weaveforge.ink.palette-dock",
  "weaveforge.reader.pen",
  "weaveforge.reader.linkCitations",
  "weaveforge.md.preview",
  "wf.ink.pageGap",
  "wf.reader.sideCollapsed",
  "another-app.setting",
];

async function wipe() {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, localStorage: g.localStorage, sessionStorage: g.sessionStorage, indexedDB: g.indexedDB };
  const deleted: string[] = [];
  const local = new FakeStorage();
  const session = new FakeStorage();
  for (const key of [...CLEARED, ...KEPT]) {
    local.setItem(key, "1");
    session.setItem(key, "1");
  }
  g.window = g;
  g.localStorage = local;
  g.sessionStorage = session;
  g.indexedDB = fakeIndexedDb(deleted);
  try {
    await clearLocalDeviceData();
  } finally {
    Object.assign(g, saved);
  }
  return { local, session, deleted };
}

test("device wipe: account data under weaveforge. and wf. is removed, device preferences stay", async () => {
  const { local, session } = await wipe();
  for (const store of [local, session]) {
    for (const key of CLEARED) assert.equal(store.getItem(key), null, `${key} should be gone`);
    for (const key of KEPT) assert.equal(store.getItem(key), "1", `${key} should stay`);
  }
});

test("device wipe: the PDF and paper HTML databases are deleted", async () => {
  const { deleted } = await wipe();
  assert.ok(deleted.includes(PDF_CACHE_DB_NAME), "PDF bytes");
  assert.ok(deleted.includes(PAPER_HTML_DB_NAME), "paper HTML");
});
