import test from "node:test";
import assert from "node:assert/strict";
import {
  isTauriShell,
  viewableArtifactUrl,
} from "../infrastructure/experiment-artifact-store";

test("inside the Tauri shell a desktop-local upload renders on the page origin", () => {
  assert.equal(
    viewableArtifactUrl("app://artifacts/exp1/0a1b-uuid/loss.png", true),
    "/artifacts/exp1/0a1b-uuid/loss.png",
  );
});

test("outside the shell the recorded URL is unchanged", () => {
  assert.equal(
    viewableArtifactUrl("app://artifacts/exp1/0a1b-uuid/loss.png", false),
    "app://artifacts/exp1/0a1b-uuid/loss.png",
  );
});

test("absolute web links are unchanged inside the shell", () => {
  assert.equal(
    viewableArtifactUrl("https://wandb.ai/run/1", true),
    "https://wandb.ai/run/1",
  );
});

test("only the exact app://artifacts/ prefix is rewritten", () => {
  assert.equal(
    viewableArtifactUrl("app://artifactsX/a", true),
    "app://artifactsX/a",
  );
});

test("storage paths are unchanged inside the shell", () => {
  assert.equal(
    viewableArtifactUrl("user/exp/uuid/name.png", true),
    "user/exp/uuid/name.png",
  );
});

for (const crafted of [
  "app://artifacts/../api/x",
  "app://artifacts/%2e%2e/api/x",
  "app://artifacts/a/b/../../x",
  "app://artifacts/a/./b",
  "app://artifacts/a/b",
  "app://artifacts/a/b/c/d",
  "app://artifacts/a//b",
  "app://artifacts/a/b/c%2Fd",
  "app://artifacts/a\\b/c/d",
]) {
  test(`inside the shell a crafted entry renders nothing: ${crafted}`, () => {
    assert.equal(viewableArtifactUrl(crafted, true), null);
  });
}

test("a crafted entry outside the shell is left to the app:// host", () => {
  assert.equal(viewableArtifactUrl("app://artifacts/../x", false), "app://artifacts/../x");
});

test("the shell is detected by the Tauri internals global", () => {
  assert.equal(isTauriShell({}), false);
  assert.equal(isTauriShell({ __TAURI_INTERNALS__: {} }), true);
});
