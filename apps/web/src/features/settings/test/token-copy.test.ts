/**
 * Access tokens spoke the builder's words ("Obsidian-style Notes REST routes",
 * "MCP clients", "only its hash is kept"), left "1/5 tokens" unexplained, and
 * served the local API from a checkbox where every other on/off in the app is a
 * switch (design D21, DA-135, D-10).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const panel = read("features/settings/ui/local-api-panel.tsx");
const tokens = read("components/local-api-tokens.tsx");
const clients = read("features/settings/ui/mcp-clients.tsx");

test("the tokens page says what a token is for in plain words", () => {
  for (const jargon of ["Obsidian-style", "MCP clients", "only its hash", "over HTTP"]) {
    assert.ok(!panel.includes(jargon), `"${jargon}" is gone from the panel`);
    assert.ok(!tokens.includes(jargon), `"${jargon}" is gone from the form`);
  }
  // What the Experiments modal used to say travels with the token it made.
  assert.match(panel, /<code>pip install weaveforge<\/code>/);
  assert.match(panel, /<code>WEAVEFORGE_PROJECT<\/code>/);
});

test("serving the local API is a switch, like every other on/off", () => {
  assert.doesNotMatch(panel, /type="checkbox"/);
  assert.match(panel, /<Switch\s[^>]*checked=\{state\.enabled\}/);
  // Nothing tells the reader to tick a box that is no longer there.
  assert.doesNotMatch(clients, /Tick Serve MCP/);
  assert.match(clients, /Turn on Serve MCP above\./);
  const shell = read("../../desktop/src/main-local-api.ts");
  assert.doesNotMatch(shell, /tick Serve MCP/);
});

test("the token count says why there is a limit", () => {
  assert.doesNotMatch(tokens, /\{count\}\/\{MAX_TOKENS\} tokens\./);
  assert.match(tokens, /\{count\} of \{MAX_TOKENS\} tokens in use\. This computer keeps five at most; revoke one to make another\./);
  // The limit note sits on the tokens page itself, so it does not send the reader there.
  assert.doesNotMatch(tokens, /Revoke one in Settings → Access tokens/);
});
