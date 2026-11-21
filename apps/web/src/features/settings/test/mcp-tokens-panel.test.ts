/**
 * Revoking an older MCP token hid the token just created, before the user had
 * copied it, and it is shown only once (P2-236).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { freshAfterRevoke } from "../ui/mcp-tokens-panel";

const fresh = { id: "new", plaintext: "wfm_secret" };

test("revoking another token keeps the new token on screen (P2-236)", () => {
  assert.deepEqual(freshAfterRevoke(fresh, "old"), fresh);
});

test("revoking the new token itself clears it", () => {
  assert.equal(freshAfterRevoke(fresh, "new"), null);
  assert.equal(freshAfterRevoke(null, "old"), null);
});
