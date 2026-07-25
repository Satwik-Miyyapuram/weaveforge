import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldMountShellChildren,
  shouldShowWorkspaceLoader,
} from "../ui/privacy-disclaimer-readiness";

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
