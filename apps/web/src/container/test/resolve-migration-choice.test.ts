import assert from "node:assert/strict";
import { test } from "node:test";

import { reresolveOnFocus, resolveMigrationChoice, type MigrationChoiceBridge } from "../resolve-migration-choice";

const folder = { path: "C:\\Notes" };

function bridge(status: () => Promise<{ state: unknown }>, root: () => Promise<{ path: string } | null> = async () => folder): MigrationChoiceBridge {
  return { migrate097Status: status, vaultRoot: root };
}

test("a verified report resolves to verified", async () => {
  const b = bridge(async () => ({ state: "verified", ownRunVerified: true, exportedHere: true }));
  assert.equal(await resolveMigrationChoice(b), "verified");
});

test("a verified report from another device's run stays unexported", async () => {
  const b = bridge(async () => ({ state: "verified" }));
  assert.equal(await resolveMigrationChoice(b), "unexported");
});

test("incomplete and none resolve to their own state", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "incomplete" }))), "incomplete");
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "none" }))), "none");
});

test("an unknown shell state is unavailable, never none and never verified", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "verified-ish" }))), "unavailable");
});

test("no bridge resolves to unavailable", async () => {
  assert.equal(await resolveMigrationChoice(null), "unavailable");
  assert.equal(await resolveMigrationChoice(undefined), "unavailable");
});

test("no folder open resolves to unavailable and never asks the shell", async () => {
  let asked = false;
  const b = bridge(async () => { asked = true; return { state: "verified" }; }, async () => null);
  assert.equal(await resolveMigrationChoice(b), "unavailable");
  assert.equal(asked, false);
});

test("a throwing status or folder read resolves to unavailable", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => { throw new Error("gone"); })), "unavailable");
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "verified" }), async () => { throw new Error("x"); })), "unavailable");
});

test("a status that never answers times out to unavailable", async () => {
  const b = bridge(() => new Promise(() => {}));
  const started = Date.now();
  assert.equal(await resolveMigrationChoice(b, 20), "unavailable");
  assert.ok(Date.now() - started < 2_000);
});

test("createAppContainer awaits the migration choice before wireBackend", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../create-app-container.ts", import.meta.url)), "utf8");
  const awaited = src.indexOf("await resolveMigrationChoice(");
  const wired = src.indexOf("wireBackend(readBackendConfig()");
  assert.ok(awaited > 0 && wired > awaited, "the await must come before wireBackend");
});

test("createAppContainer re-resolves an unavailable desktop choice on focus and reloads", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../create-app-container.ts", import.meta.url)), "utf8");
  const wiredFocus = src.indexOf("reresolveOnFocus(migration, shell");
  assert.ok(wiredFocus > 0, "desktop must wire reresolveOnFocus with the shell");
  assert.ok(src.indexOf("if (shell)", wiredFocus - 40) > 0, "the wiring is desktop only");
  assert.ok(src.includes("window.location.reload()"), "a usable answer reloads the app");
});

test("a transient unavailable is retried and a later attempt can resolve", async () => {
  let calls = 0;
  const b = bridge(async () => {
    calls++;
    if (calls === 1) throw new Error("shell busy");
    return { state: "verified", ownRunVerified: true, exportedHere: true };
  });
  assert.equal(await resolveMigrationChoice(b, 1_000, 1), "verified");
  assert.equal(calls, 2);
});

test("retries stop after three attempts and stay unavailable", async () => {
  let calls = 0;
  const b = bridge(async () => {
    calls++;
    throw new Error("gone");
  });
  assert.equal(await resolveMigrationChoice(b, 1_000, 1), "unavailable");
  assert.equal(calls, 3);
});

test("no bridge never retries, so web and Android start without delay", async () => {
  const started = Date.now();
  assert.equal(await resolveMigrationChoice(null, 1_000, 500), "unavailable");
  assert.ok(Date.now() - started < 200);
});

test("reresolveOnFocus does nothing when the first answer is usable", () => {
  const listeners: Array<() => void> = [];
  const target = {
    addEventListener: (_t: string, f: () => void) => listeners.push(f),
    removeEventListener: () => {},
  };
  reresolveOnFocus("verified", null, target, () => {});
  assert.equal(listeners.length, 0);
});

test("reresolveOnFocus re-asks on focus while read-only and reports the first usable answer", async () => {
  const listeners: Array<() => void> = [];
  const removed: Array<() => void> = [];
  const target = {
    addEventListener: (_t: string, f: () => void) => listeners.push(f),
    removeEventListener: (_t: string, f: () => void) => removed.push(f),
  };
  let answers = 0;
  const b = bridge(async () => {
    answers++;
    return { state: answers === 1 ? "unavailable-ish" : "verified", ownRunVerified: true, exportedHere: true };
  });
  const seen: string[] = [];
  reresolveOnFocus("unavailable", b, target, (s) => seen.push(s));
  assert.equal(listeners.length, 1);
  const fire = listeners[0];
  assert.ok(fire);
  fire();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [], "a still-unavailable answer reports nothing");
  fire();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, ["verified"]);
  assert.equal(removed.length, 1, "stops listening once a usable answer arrives");
});