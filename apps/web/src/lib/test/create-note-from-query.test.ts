/**
 * Creating a note from the palette's empty search (12-03).
 *
 * The create was awaited bare under a `void` call site, so a failed add was an
 * unhandled rejection and the palette showed nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createNoteFromQuery } from "@/lib/create-note-from-query";

type Log = { level: string; source: string; message: string; detail?: string };

function withLogs<T>(body: () => Promise<T>): Promise<{ out: T; logs: Log[] }> {
  const logs: Log[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  return body()
    .then((out) => ({ out, logs }))
    .finally(() => {
      g.window = saved;
    });
}

test("a rejected add returns the error and logs it, never throws", async () => {
  const { out, logs } = await withLogs(() =>
    createNoteFromQuery("  Ideas ", async () => {
      throw new Error("offline");
    }),
  );
  assert.deepEqual(out, { ok: false, error: "Could not create the note: offline" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.match(logs[0]!.detail ?? "", /offline/);
});

test("a successful add returns the page, title trimmed", async () => {
  const seen: string[] = [];
  const out = await createNoteFromQuery("  Ideas ", async ({ title }) => {
    seen.push(title);
    return { id: "p1" };
  });
  assert.deepEqual(out, { ok: true, page: { id: "p1" } });
  assert.deepEqual(seen, ["Ideas"]);
});

test("a blank query creates nothing", async () => {
  let called = false;
  const out = await createNoteFromQuery("   ", async () => {
    called = true;
    return { id: "x" };
  });
  assert.equal(out, null);
  assert.equal(called, false);
});
