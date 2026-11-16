import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

function shouldMountShellChildren(input: {
  loading: boolean;
  needsPrivacyAccept: boolean;
  containerReady: boolean;
}): boolean {
  return readyCore().shouldMountShellChildren(input.loading, input.needsPrivacyAccept, input.containerReady);
}

function shouldShowWorkspaceLoader(input: {
  loading: boolean;
  needsPrivacyAccept: boolean;
  containerReady: boolean;
  error: string | null;
}): boolean {
  return readyCore().shouldShowWorkspaceLoader(
    input.loading,
    input.needsPrivacyAccept,
    input.containerReady,
    input.error ?? undefined,
  );
}

test("cached disclaimer acceptance still waits for ensureContainer on reopen", () => {
  assert.equal(
    shouldMountShellChildren({
      loading: false,
      needsPrivacyAccept: false,
      containerReady: false,
    }),
    false,
  );
  assert.equal(
    shouldShowWorkspaceLoader({
      loading: false,
      needsPrivacyAccept: false,
      containerReady: false,
      error: null,
    }),
    true,
  );
});

test("shell mounts only after container is ready", () => {
  assert.equal(
    shouldMountShellChildren({
      loading: false,
      needsPrivacyAccept: false,
      containerReady: true,
    }),
    true,
  );
  assert.equal(
    shouldShowWorkspaceLoader({
      loading: false,
      needsPrivacyAccept: false,
      containerReady: true,
      error: null,
    }),
    false,
  );
});

test("disclaimer modal path does not pretends the shell is ready", () => {
  assert.equal(
    shouldMountShellChildren({
      loading: false,
      needsPrivacyAccept: true,
      containerReady: false,
    }),
    false,
  );
});
