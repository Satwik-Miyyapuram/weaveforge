/**
 * The sign-in screen's "Use without an account" entry (desktop only): pick a
 * folder first, then remember the choice and reload onto the files wiring. A
 * dismissed dialog leaves the sign-in screen exactly as it was.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { enterWithoutAccount } from "../ui/enter-without-account";

function deps(picked: false | { warnings: readonly string[] }) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      chooseFolder: async () => {
        calls.push("choose");
        return picked;
      },
      setLocalMode: (on: boolean) => calls.push(`local:${on}`),
      reload: () => calls.push("reload"),
    },
  };
}

test("a picked folder sets no-account mode, then reloads", async () => {
  const { calls, deps: d } = deps({ warnings: [] });
  assert.equal(await enterWithoutAccount(d), true);
  assert.deepEqual(calls, ["choose", "local:true", "reload"]);
});

test("a picked folder with shell warnings still enters", async () => {
  const { calls, deps: d } = deps({ warnings: ["not watched"] });
  assert.equal(await enterWithoutAccount(d), true);
  assert.deepEqual(calls, ["choose", "local:true", "reload"]);
});

test("a dismissed dialog (or no shell) changes nothing", async () => {
  const { calls, deps: d } = deps(false);
  assert.equal(await enterWithoutAccount(d), false);
  assert.deepEqual(calls, ["choose"]);
});

test("a failing picker leaves the choice unset and surfaces the error", async () => {
  const calls: string[] = [];
  await assert.rejects(
    enterWithoutAccount({
      chooseFolder: async () => {
        throw new Error("dialog broke");
      },
      setLocalMode: (on: boolean) => calls.push(`local:${on}`),
      reload: () => calls.push("reload"),
    }),
    /dialog broke/,
  );
  assert.deepEqual(calls, []);
});

const screen = readFileSync(fileURLToPath(new URL("../ui/login-screen.tsx", import.meta.url)), "utf8");

test("the sign-in screen offers the entry on desktop only and runs it busy", () => {
  assert.match(screen, /Use without an account/);
  assert.match(screen, /onThisComputer && \(/);
  assert.match(screen, /setOnThisComputer\(desktop\(\) !== null\)/);
  assert.match(screen, /run\(async \(\) => \{\s*await enterWithoutAccount\(/);
  assert.match(screen, /chooseFolder: async \(\) => \(await import\("@\/features\/workspace\/application\/workspace-folder"\)\)\.chooseDesktopFolder\(\{\}\)/);
  assert.doesNotMatch(screen, /^import .*workspace-folder/m);
  assert.match(screen, /setLocalMode,/);
  assert.match(screen, /reload: \(\) => window\.location\.reload\(\)/);
});

const badge = readFileSync(fileURLToPath(new URL("../ui/local-mode-badge.tsx", import.meta.url)), "utf8");
const tabbar = readFileSync(fileURLToPath(new URL("../../../app/tabbar.tsx", import.meta.url)), "utf8");

test("no-account mode shows the 'Offline · on this computer' tag in the tab bar", () => {
  assert.match(badge, /Offline · on this computer/);
  assert.match(badge, /if \(!local\) return null;/);
  assert.match(tabbar, /<LocalModeBadge \/>/);
});
