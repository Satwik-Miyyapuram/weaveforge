import assert from "node:assert/strict";
import { test } from "node:test";

import { wireFileBackend, type FileRepositories } from "../../backend/providers/files/wire-file-backend";
import { PERSONAL_REPOSITORY_KEYS, withFileRepositories } from "../with-file-repositories";

const parts = {
  fs: {} as never,
  settings: {} as never,
  secrets: {} as never,
};

test("the personal-key list names exactly the repositories wireFileBackend builds", () => {
  const built = Object.keys(wireFileBackend(parts)).sort();
  assert.deepEqual(Object.keys(PERSONAL_REPOSITORY_KEYS).sort(), built);
});

test("every personal key replaces its counterpart and org keys stay on PostgREST", () => {
  const files = wireFileBackend(parts);
  const wired: Record<string, { from: string; key: string }> = {
    ...Object.fromEntries(Object.keys(PERSONAL_REPOSITORY_KEYS).map((key) => [key, { from: "postgrest", key }])),
    shareRepository: { from: "postgrest", key: "shareRepository" },
    db: { from: "postgrest", key: "db" },
  };
  const out = withFileRepositories(wired, files);
  for (const key of Object.keys(PERSONAL_REPOSITORY_KEYS) as (keyof FileRepositories)[]) {
    assert.equal(out[key], files[key], `${key} must be the file repository`);
    assert.notEqual(out[key], wired[key], `${key} must not stay on PostgREST`);
  }
  assert.equal(out.shareRepository, wired.shareRepository);
  assert.equal(out.db, wired.db);
});
