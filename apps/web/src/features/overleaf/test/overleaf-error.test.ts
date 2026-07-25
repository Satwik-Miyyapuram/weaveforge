import test from "node:test";
import assert from "node:assert/strict";
import { safeOverleafError } from "../infrastructure/overleaf-error";

test("Overleaf errors redact tokens and credential-bearing URLs", () => {
  const token = "secret-overleaf-token";
  const message = `clone failed for https://git:${token}@git.overleaf.com/project/abc`;
  const safe = safeOverleafError(new Error(message), token);
  assert.ok(!safe.includes(token));
  assert.ok(!safe.includes("git:"));
  assert.ok(safe.includes("git.overleaf.com"));
});

test("Overleaf errors are bounded before persistence", () => {
  const safe = safeOverleafError("x".repeat(2_000));
  assert.equal(safe.length, 500);
});
