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

test("every read-only repository passes exactly its allowlisted reads and refuses every other method", async () => {
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
        await assert.rejects(async () => fn(), { message: READ_ONLY_MESSAGE }, `${key}.${name} must refuse`);
      }
    }
  }
  assert.ok(checked > 100, `expected many repository methods, saw ${checked}`);
});

test("a read reaches the original repository, a write never does", async () => {
  const calls: string[] = [];
  const repo = {
    list: () => (calls.push("list"), ["a"]),
    save: () => (calls.push("save"), "saved"),
  };
  const wrapped = readOnlyRepositories({ paperRepository: repo }).paperRepository;
  assert.deepEqual(wrapped.list(), ["a"]);
  await assert.rejects(async () => wrapped.save(), { message: READ_ONLY_MESSAGE });
  assert.deepEqual(calls, ["list"]);
});

test("a method outside the allowlist is refused even when its name is not a write verb", async () => {
  const calls: string[] = [];
  const repo = {
    getById: () => (calls.push("getById"), "one"),
    frobnicate: () => (calls.push("frobnicate"), "ran"),
  };
  const wrapped = readOnlyRepository(repo, ["getById"]);
  assert.equal(wrapped.getById(), "one");
  await assert.rejects(async () => wrapped.frobnicate(), { message: READ_ONLY_MESSAGE });
  assert.deepEqual(calls, ["getById"]);
});

test("tag, paper-tag, experiment and cache writes that no verb name catches are refused", async () => {
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
  await assert.rejects(async () => out.tagRepository.mergeTags(), { message: READ_ONLY_MESSAGE });
  await assert.rejects(async () => out.tagRepository.reconcileSources(), { message: READ_ONLY_MESSAGE });
  await assert.rejects(async () => out.tagRepository.mergeConcepts(), { message: READ_ONLY_MESSAGE });
  await assert.rejects(async () => out.tagRepository.refreshPaperCache(), { message: READ_ONLY_MESSAGE });
  await assert.rejects(async () => out.paperTagRepository.reconcile(), { message: READ_ONLY_MESSAGE });
  await assert.rejects(async () => out.experimentRepository.patch(), { message: READ_ONLY_MESSAGE });
  assert.equal(out.tagRepository.listForPaper(), "done");
  assert.equal(out.experimentRepository.getById(), "done");
  assert.deepEqual(calls, ["listForPaper", "getById"], "no refused write reached its repository");
});

test("a refused repository call rejects instead of throwing, so an awaited caller catches it", async () => {
  const wrapped = readOnlyRepository({ save: () => "saved" }, []);
  // A synchronous throw would escape here and fail the test; the refusal must come back as a promise.
  const refusal = wrapped.save() as unknown as Promise<unknown>;
  assert.ok(typeof refusal?.then === "function", "the refusal must be a promise");
  await assert.rejects(refusal, { message: READ_ONLY_MESSAGE });
});

test("the release-notice unseen read reaches the repository in read-only mode", () => {
  const out = readOnlyBackend({ releaseNotices: { unseen: () => "notices" } });
  assert.equal(out.releaseNotices.unseen(), "notices");
});
