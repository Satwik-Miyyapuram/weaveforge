/**
 * No-account (0.9.8): the container wires the File* repositories over the open
 * folder, never the local database (the no-local-db-imports ratchet guards the imports).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "@/lib/rust-core";
import { setLocalMode } from "@/backend/providers/files/no-account-mode";
import { wireBackend } from "@/container/parts";
import { NoAccountWorkspaceFs } from "@/backend/providers/files/no-account-fs";

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

before(async () => {
  host.localStorage = memory;
  await loadCore();
});

after(() => {
  host.localStorage = previous;
});

const config = { provider: "postgrest", supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "test-anon", dataUrl: "http://127.0.0.1:9" } as never;

function wireNoAccount() {
  setLocalMode(true);
  try {
    return wireBackend(config, { projectId: null }, () => null);
  } finally {
    setLocalMode(false);
  }
}

test("no-account container wires File* repositories for each personal kind", () => {
  const wired = wireNoAccount() as unknown as Record<string, { constructor: { name: string } }>;
  for (const key of ["projectRepository", "paperRepository", "experimentRepository", "logEntryRepository"]) {
    const repo = wired[key];
    assert.ok(repo, key);
    assert.match(repo.constructor.name, /^File/, `${key} must be a File* repository`);
  }
  assert.equal((wired as unknown as { filesMode?: boolean }).filesMode, true);
});

test("no-account files refuse while no folder is open", async () => {
  await assert.rejects(() => new NoAccountWorkspaceFs().readText("paper.json"), /Open a folder/);
});