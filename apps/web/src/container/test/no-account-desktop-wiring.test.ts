/**
 * B red test (0.9.8): the no-account desktop container wires the File*
 * repositories and never reaches LocalRunner.
 *
 * Expected red until the 0.9.7 wiring merges: today `wireBackend` returns
 * `localBackendParts()`, which is the LocalRunner-backed path. Once the File*
 * wiring lands this test turns green without edits.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "@/lib/rust-core";
import { setLocalMode } from "@/features/auth/infrastructure/no-account-mode";
import { LocalRunner } from "@/backend/providers/local/parts";
import { wireBackend } from "@/container/parts";

const host = globalThis as { localStorage?: Storage };
const previous = host.localStorage;
const data = new Map<string, string>();
const memory = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, String(v)),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
  key: () => null,
  get length() {
    return data.size;
  },
} as unknown as Storage;

const containerSource = readFileSync(new URL("../parts.ts", import.meta.url), "utf8");

before(async () => {
  host.localStorage = memory;
  await loadCore();
});

after(() => {
  host.localStorage = previous;
});

test("no-account desktop container wires the File* repos and never calls LocalRunner [expected-red until 0.9.7 wiring]", () => {
  // Static half: the no-account branch of wireBackend must name a File* wiring.
  const branch = containerSource.slice(containerSource.indexOf("export function wireBackend"));
  assert.match(branch.slice(0, 1200), /File[A-Za-z]+(Repo|Repository)/, "no-account branch must wire File* repos");

  // Runtime half: wiring in no-account mode never runs a LocalRunner query.
  setLocalMode(true);
  const calls: string[] = [];
  const original = LocalRunner.prototype.query;
  LocalRunner.prototype.query = async function (sql: string) {
    calls.push(sql);
    throw new Error("LocalRunner.query must not run in 0.9.8");
  } as typeof original;
  try {
    wireBackend({ provider: "postgrest", supabaseUrl: "", supabaseAnonKey: "", dataUrl: "" } as never, { projectId: null }, () => null);
    assert.deepEqual(calls, []);
  } finally {
    LocalRunner.prototype.query = original;
    setLocalMode(false);
  }
});
