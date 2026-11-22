import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";

// wirePostgrestBackend builds the storage layer, which needs the Rust core loaded.
before(loadTestCore);
import type { BackendConfig } from "../../backend/parts";
import {
  READ_ONLY_KEYS,
  READ_ONLY_MESSAGE,
  READ_ONLY_METHODS,
  readOnlyBackend,
  readOnlyRepository,
  readOnlyRepositories,
  repositoryMethods,
} from "../read-only-repositories";

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "anon",
} as unknown as BackendConfig;

test("every read-only repository passes exactly its allowlisted reads and refuses every other method", () => {
  const backend = wirePostgrestBackend(config, { projectId: null }, () => null) as unknown as Record<string, unknown>;
  let checked = 0;
  for (const key of READ_ONLY_KEYS) {
    const value = backend[key];
    if (!value || typeof value !== "object") continue;
    const allowed = READ_ONLY_METHODS[key] ?? [];
    const methods = repositoryMethods(value);
    for (const name of allowed) assert.ok(methods.includes(name), `${key}.${name} must be a method of the repository`);
    const wrapped = readOnlyRepository(value, allowed) as Record<string, unknown>;
    for (const name of methods) {
      checked += 1;
      const fn = wrapped[name] as (...args: unknown[]) => unknown;
      if (allowed.includes(name)) {
        assert.equal(typeof fn, "function", `${key}.${name} must pass through`);
      } else {
        assert.throws(() => fn(), { message: READ_ONLY_MESSAGE }, `${key}.${name} must refuse`);
      }
    }
  }
  assert.ok(checked > 100, `expected many repository methods, saw ${checked}`);
});

test("a read reaches the original repository, a write never does", () => {
  const calls: string[] = [];
  const repo = {
    list: () => (calls.push("list"), ["a"]),
    save: () => (calls.push("save"), "saved"),
  };
  const wrapped = readOnlyRepositories({ paperRepository: repo }).paperRepository;
  assert.deepEqual(wrapped.list(), ["a"]);
  assert.throws(() => wrapped.save(), { message: READ_ONLY_MESSAGE });
  assert.deepEqual(calls, ["list"]);
});

test("a method outside the allowlist is refused even when its name is not a write verb", () => {
  const calls: string[] = [];
  const repo = {
    getById: () => (calls.push("getById"), "one"),
    frobnicate: () => (calls.push("frobnicate"), "ran"),
  };
  const wrapped = readOnlyRepository(repo, ["getById"]) as Record<string, () => unknown>;
  assert.equal(wrapped.getById(), "one");
  assert.throws(() => wrapped.frobnicate(), { message: READ_ONLY_MESSAGE });
  assert.deepEqual(calls, ["getById"]);
});

test("tag, paper-tag, experiment and cache writes that no verb name catches are refused", () => {
  const calls: string[] = [];
  const spy = (name: string) => () => (calls.push(name), "done");
  const out = readOnlyBackend({
    tagRepository: {
      listForPaper: spy("listForPaper"),
      mergeTags: spy("mergeTags"),
      reconcileSources: spy("reconcileSources"),
      mergeConcepts: spy("mergeConcepts"),
      refreshPaperCache: spy("refreshPaperCache"),
    },
    paperTagRepository: { listForPaper: spy("listForPaper"), reconcile: spy("reconcile") },
    experimentRepository: { getById: spy("getById"), patch: spy("patch") },
  });
  assert.throws(() => out.tagRepository.mergeTags(), { message: READ_ONLY_MESSAGE });
  assert.throws(() => out.tagRepository.reconcileSources(), { message: READ_ONLY_MESSAGE });
  assert.throws(() => out.tagRepository.mergeConcepts(), { message: READ_ONLY_MESSAGE });
  assert.throws(() => out.tagRepository.refreshPaperCache(), { message: READ_ONLY_MESSAGE });
  assert.throws(() => out.paperTagRepository.reconcile(), { message: READ_ONLY_MESSAGE });
  assert.throws(() => out.experimentRepository.patch(), { message: READ_ONLY_MESSAGE });
  assert.equal(out.tagRepository.listForPaper(), "done");
  assert.equal(out.experimentRepository.getById(), "done");
  assert.deepEqual(calls, ["listForPaper", "getById"], "no refused write reached its repository");
});
