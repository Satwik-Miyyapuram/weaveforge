/**
 * 0.9.8 step 3: "work on this computer" (no account) runs on the files backend.
 * Nothing on the runtime path selects the removed local database or its identity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { IAuthService } from "@weaveforge/core";
import { NoAccountAuthService } from "../providers/files/no-account-auth";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("no-account auth reports the local user and refuses every sign-in", async () => {
  const auth: IAuthService = new NoAccountAuthService();
  const user = await auth.getUser();
  assert.ok(user && user.id, "the no-account user exists");
  assert.equal(await auth.getAccessToken(), null);
  await assert.rejects(auth.signInWithPassword("a@b.c", "x"), /no account/);
  await assert.rejects(auth.signUpWithPassword("a@b.c", "x"), /no account/);
  await assert.rejects(auth.signInWithGoogle(), /no account/);
});

test("no-account auth answers onChange once with the local user", async () => {
  const auth = new NoAccountAuthService();
  const seen = await new Promise((resolve) => {
    auth.onChange((u) => resolve(u));
  });
  assert.ok(seen && (seen as { id?: string }).id);
});

test("sign-out forgets the choice, then reloads onto the sign-in screen", async () => {
  // onChange never fires again, so without the reload the window stays put.
  const calls: string[] = [];
  const auth = new NoAccountAuthService({ forget: () => calls.push("forget"), reload: () => calls.push("reload") });
  await auth.signOut();
  assert.deepEqual(calls, ["forget", "reload"]);
});

test("the runtime light backend no longer selects the local database or its auth", () => {
  const parts = src("backend/parts.ts");
  assert.doesNotMatch(parts, /providers\/local\//);
  assert.doesNotMatch(parts, /localBackendParts|LocalAuthService|wireLocalLightBackend/);
  assert.match(parts, /NoAccountAuthService/);
});

test("getDataClient in no-account mode no longer returns the local database", () => {
  const lib = src("lib/parts.ts");
  assert.doesNotMatch(lib, /providers\/local\//);
  assert.doesNotMatch(lib, /localBackendParts/);
  assert.match(lib, /not available in 0\.9\.8 files mode/);
});

test("the no-account filesystem lives in backend/providers/files", () => {
  assert.match(src("backend/providers/files/no-account-fs.ts"), /export class NoAccountWorkspaceFs/);
  assert.doesNotMatch(src("container/no-account-file-backend.ts"), /export class NoAccountWorkspaceFs/);
});

test("0.9.8: the no-account conditional write never falls back to a plain overwrite", () => {
  // It shows the open folder's own capability (or none), so callers keep their checked fallback.
  const body = src("backend/providers/files/no-account-fs.ts").split("get writeTextIf(")[1]?.split("\n  }\n")[0] ?? "";
  assert.ok(body, "writeTextIf is a getter");
  assert.doesNotMatch(body, /writeFile\(/);
  assert.match(body, /fs\?\.writeTextIf \? fs\.writeTextIf\.bind\(fs\) : undefined/);
});