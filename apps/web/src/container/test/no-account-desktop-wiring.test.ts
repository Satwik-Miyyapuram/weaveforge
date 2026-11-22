/**
 * B red test (0.9.8): the no-account desktop container wires the File*
 * repositories, not the local-database backend.
 *
 * Expected red until the 0.9.7 wiring merges: today `wireBackend` in no-account
 * mode returns the local-database backend, whose project repository is not a
 * File* class. Once the File* wiring lands this test turns green without edits.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "@/lib/rust-core";
import { setLocalMode } from "@/features/auth/infrastructure/no-account-mode";
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

before(async () => {
  host.localStorage = memory;
  await loadCore();
});

after(() => {
  host.localStorage = previous;
});

test("no-account container wires a File* project repository [expected-red until 0.9.7 wiring]", () => {
  setLocalMode(true);
  try {
    const wired = wireBackend(
      { provider: "postgrest", supabaseUrl: "", supabaseAnonKey: "", dataUrl: "" } as never,
      { projectId: null },
      () => null,
    );
    assert.match(
      wired.projectRepository.constructor.name,
      /^File[A-Za-z]*(Repo|Repository|Store)$/,
      "no-account mode must wire the File* repositories",
    );
  } finally {
    setLocalMode(false);
  }
});
