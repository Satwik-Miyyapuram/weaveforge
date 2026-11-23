/**
 * Where "Use without an account" shows and how the sign-in screen reaches it.
 * LoginScreen has no render harness, so the wiring is pinned in the source,
 * like the other auth screen tests. The order (folder, warnings, remember,
 * reload) is tested in backend/providers/files/test/enter-no-account.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const login = read("../ui/login-screen.tsx");
const shell = read("../../../app/app-shell.tsx");

test("the sign-in screen never sets the flag itself", () => {
  assert.doesNotMatch(login, /no-account-mode/);
  assert.doesNotMatch(login, /setLocalMode/);
  assert.match(login, /from "@\/backend\/providers\/files\/enter-no-account"/);
});

test("the entry shows only on the desktop, and only where it is offered", () => {
  assert.match(login, /export function LoginScreen\(\{ offerNoAccount = true \}: \{ offerNoAccount\?: boolean \} = \{\}\)/);
  assert.match(login, /setOnThisComputer\(desktop\(\) !== null\)/);
  assert.match(login, /\{offerNoAccount && onThisComputer && \(/);
  assert.match(login, />\s*Use without an account\s*</);
});

test("the session-expired overlay does not offer it; the first sign-in screen does", () => {
  assert.match(shell, /<CloseButton label="Not now"[^\n]*\/>\s*<LoginScreen offerNoAccount=\{false\} \/>/);
  assert.match(shell, /<main className="app-shell"><LoginScreen \/><\/main>/);
});

test("folder warnings are shown with a Continue button before the reload", () => {
  assert.match(login, /showWarnings: \(warnings\) => new Promise<void>/);
  assert.doesNotMatch(read("../../../backend/providers/files/enter-no-account.ts"), /@\/features\//);
  assert.match(login, /folderWarnings && \(/);
  assert.match(login, />\s*Continue\s*</);
});

test("signed out, the folder is only picked, never connected (no watcher, no sync)", () => {
  assert.doesNotMatch(login, /chooseDesktopFolder|connectDesktopFolder|workspace-folder|requestSync/);
  assert.doesNotMatch(login, /chooseFolder:/);
});

test("Sign out in the account menu clears the session caches, which forget the boot snapshot (desktop.md)", () => {
  const menu = read("../../../app/header-actions.tsx");
  assert.match(menu, /import \{ useAuth \} from "@\/features\/auth";/);
  assert.match(menu, /onClick=\{\(\) => void signOut\(\)\}/);
  const provider = read("../ui/auth-provider.tsx");
  assert.match(provider, /const signOut = useCallback\(async \(\) => \{[\s\S]*?clearSessionCaches\(\);[\s\S]*?auth\.signOut\(\)/);
  // clearSessionCaches running the recorder's reset (and so forgetBootSnapshot)
  // is tested in app/test/boot-snapshot-recorder.test.tsx.
  assert.match(read("../../../app/boot-snapshot.tsx"), /registerSessionReset\(\(\) => \{[\s\S]*?forgetBootSnapshot\(\);/);
});

test("there is no no-account badge", () => {
  assert.doesNotMatch(login + shell, /Offline · on this computer|LocalModeBadge|local-mode-badge/);
});
