/**
 * 0.9.8 has no local database to rewire, so signing out clears the session in place.
 * The provider reloads only when another account's copy is found on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../ui/auth-provider.tsx", import.meta.url)), "utf8");
const signOutBody = source.slice(source.indexOf("const signOut = useCallback("), source.indexOf("const updatePassword = useCallback("));

test("auth-provider no longer imports the local-first marker", () => {
  assert.doesNotMatch(source, /local-first-marker/);
  assert.doesNotMatch(source, /setLocalFirstAccount|localFirstActive/);
});

test("signing out does not reload the window", () => {
  assert.ok(signOutBody.includes("auth.signOut()"), "the sign-out body was found");
  assert.doesNotMatch(signOutBody, /window\.location\.reload/);
});

test("another account's copy on disk still reloads the window", () => {
  assert.match(source, /"otherAccountOnDisk":\s*\n\s*clearSessionCaches\(\);\s*\n\s*window\.location\.reload\(\);/);
});
