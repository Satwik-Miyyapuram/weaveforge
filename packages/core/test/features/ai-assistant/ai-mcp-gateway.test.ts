import assert from "node:assert/strict";
import test from "node:test";
import { AI_TOOL_NAMES, AiBrowserPairingRequiredError, aiMcpToolManifest } from "../../../src/index.js";

test("MCP manifest declares every tool as browser-paired and proposals as confirmation-gated", () => {
  const manifest = aiMcpToolManifest();
  assert.deepEqual(manifest.map((tool) => tool.name), AI_TOOL_NAMES);
  assert.ok(manifest.every((tool) => tool.requiresBrowserPairing));
  assert.ok(manifest.filter((tool) => tool.name.startsWith("propose_")).every((tool) => tool.requiresUserConfirmation));
});

test("gateway pairing failure is explicit and fail-closed", () => {
  const error = new AiBrowserPairingRequiredError();
  assert.equal(error.code, "browser_pairing_required");
  assert.match(error.message, /unlock encryption/i);
});
