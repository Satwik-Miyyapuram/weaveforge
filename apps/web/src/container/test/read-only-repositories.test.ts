import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";

// wirePostgrestBackend builds the storage layer, which needs the Rust core loaded.
before(loadTestCore);
import type { BackendConfig } from "../../backend/parts";
import {
  READ_ONLY_MESSAGE,
  isWriteMethod,
  readOnlyRepositories,
  repositoryMethods,
} from "../read-only-repositories";

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "anon",
} as unknown as BackendConfig;

test("every repository method of the old backend is either a read or a refused write", () => {
  const backend = wirePostgrestBackend(config, { projectId: null }, () => null);
  const seen: string[] = [];
  for (const [key, value] of Object.entries(backend)) {
    if (!value || typeof value !== "object" || !key.endsWith("Repository")) continue;
    const wrapped = readOnlyRepositories({ [key]: value })[key] as Record<string, unknown>;
    for (const name of repositoryMethods(value)) {
      seen.push(`${key}.${name}`);
      const fn = wrapped[name] as (...args: unknown[]) => unknown;
      if (isWriteMethod(name)) {
        assert.throws(() => fn(), { message: READ_ONLY_MESSAGE }, `${key}.${name} must refuse`);
      } else {
        assert.equal(typeof fn, "function", `${key}.${name} must pass through`);
      }
    }
  }
  assert.ok(seen.length > 100, `expected many repository methods, saw ${seen.length}`);
});

test("a read reaches the original repository, a write never does", () => {
  const calls: string[] = [];
  const repo = {
    list: () => (calls.push("list"), ["a"]),
    save: () => (calls.push("save"), "saved"),
  };
  const wrapped = readOnlyRepositories({ noteRepository: repo }).noteRepository;
  assert.deepEqual(wrapped.list(), ["a"]);
  assert.throws(() => wrapped.save(), { message: READ_ONLY_MESSAGE });
  assert.deepEqual(calls, ["list"]);
});
