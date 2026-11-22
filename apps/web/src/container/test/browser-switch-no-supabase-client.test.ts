import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Item 2. The browser switch reads the signed-in user through the app's shared data client
 * (getDataClient). It must not build a second Supabase client of its own.
 */

const source = readFileSync(fileURLToPath(new URL("../browser-switch-wiring.ts", import.meta.url)), "utf8");

test("(item2) the switch wiring does not import the Supabase client library", () => {
  assert.doesNotMatch(source, /@supabase\/supabase-js/);
});

test("(item2) the switch wiring does not construct a client with createClient", () => {
  assert.doesNotMatch(source, /\bcreateClient\s*\(/);
});

test("(item2) the switch wiring reads the session through getDataClient", () => {
  assert.match(source, /import \{[^}]*\bgetDataClient\b[^}]*\} from "@\/lib\/parts"/);
  assert.match(source, /getDataClient\(\)\.auth\.getSession\(\)/);
});
