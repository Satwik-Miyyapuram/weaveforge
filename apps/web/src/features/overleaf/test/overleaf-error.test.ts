import test, { before } from "node:test";
import assert from "node:assert/strict";
import { loadTestCore } from "@/lib/test/load-test-core";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";

before(async () => {
  await loadTestCore();
});

test("Overleaf errors redact tokens and credential-bearing URLs", () => {
  const token = "secret-overleaf-token";
  const message = `clone failed for https://git:${token}@git.overleaf.com/project/abc`;
  const safe = readyCore().redactOverleafErrorText(formatError(new Error(message)), token);
  assert.ok(!safe.includes(token));
  assert.ok(!safe.includes("git:"));
  assert.ok(safe.includes("git.overleaf.com"));
});

test("Overleaf errors are bounded before persistence", () => {
  const safe = readyCore().redactOverleafErrorText(formatError("x".repeat(2_000)), undefined);
  assert.equal(safe.length, 500);
});
