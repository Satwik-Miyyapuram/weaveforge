/**
 * Sign-out runs every reset, even when one of them throws (B56).
 *
 * The hooks ran in a bare loop, so one throwing hook skipped every hook after
 * it and left that state for the next user. Each one is now isolated and its
 * failure logged. The module caches that outlived an account (mermaid, the
 * graph state) are on the list too (xstate-16).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { clearSessionCaches, registerSessionReset } from "@/lib/cache/clear-session-caches";
import { clearMermaidCache, mermaidCacheSize, renderMermaidBlock, setMermaidLoaderForTests, type MermaidModule } from "@/lib/mermaid-render";

type Log = { level: string; source: string; message: string; detail?: string };

/** An empty Storage: methods on the prototype, so `Object.keys` lists none. */
function emptyStorage(): Storage {
  return Object.create({ getItem: () => null, setItem: () => {}, removeItem: () => {} }) as Storage;
}

/** Run `body` with a desktop log bridge and empty browser storage; returns the logs. */
function withBrowser(body: () => void): Log[] {
  const logs: Log[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, localStorage: g.localStorage, sessionStorage: g.sessionStorage };
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  g.localStorage = emptyStorage();
  g.sessionStorage = emptyStorage();
  try {
    body();
  } finally {
    Object.assign(g, saved);
  }
  return logs;
}

test("a throwing reset does not stop the ones after it, and is logged", () => {
  const ran: string[] = [];
  const offs = [
    registerSessionReset(() => void ran.push("a")),
    registerSessionReset(() => {
      throw new Error("reset blew up");
    }),
    registerSessionReset(() => void ran.push("c")),
  ];
  try {
    const logs = withBrowser(() => clearSessionCaches());
    assert.deepEqual(ran, ["a", "c"]);
    const failed = logs.filter((l) => l.source === "session");
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.level, "warn");
    assert.match(failed[0]!.detail ?? "", /reset blew up/);
  } finally {
    for (const off of offs) off();
  }
});

test("every registered reset runs once per sign-out", () => {
  let count = 0;
  const offs = [1, 2, 3].map(() => registerSessionReset(() => void count++));
  try {
    clearSessionCaches();
    assert.equal(count, 3);
  } finally {
    for (const off of offs) off();
  }
});

test("sign-out empties the rendered mermaid cache", async () => {
  const renderer = { renderAsync: async () => ({ svg: "<svg></svg>" }) } as unknown as MermaidModule;
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  g.document = {};
  setMermaidLoaderForTests(() => Promise.resolve(renderer));
  try {
    await renderMermaidBlock("graph TD; A-->B");
    assert.equal(mermaidCacheSize(), 1);
    clearSessionCaches();
    assert.equal(mermaidCacheSize(), 0);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});
