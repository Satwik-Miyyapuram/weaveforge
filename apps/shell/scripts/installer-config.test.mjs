import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(shell, rel), "utf8");
const conf = JSON.parse(read("tauri.conf.json"));
const nsis = conf.bundle?.windows?.nsis ?? {};

// BMP keeps its width and height as little-endian int32 at bytes 18 and 22.
function bmpSize(rel) {
  const buf = fs.readFileSync(path.join(shell, rel));
  assert.equal(buf.toString("ascii", 0, 2), "BM", `${rel} is not a BMP`);
  assert.equal(buf.readUInt16LE(28), 24, `${rel} must be 24-bit (NSIS takes no other depth)`);
  return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
}

test("the NSIS icons, art and hooks named in tauri.conf.json exist", () => {
  for (const key of ["installerIcon", "uninstallerIcon", "headerImage", "uninstallerHeaderImage", "sidebarImage", "installerHooks"]) {
    assert.equal(typeof nsis[key], "string", `bundle.windows.nsis.${key} is not set`);
    assert.ok(fs.existsSync(path.join(shell, nsis[key])), `bundle.windows.nsis.${key} -> ${nsis[key]} is missing`);
  }
  assert.deepEqual(nsis.languages, ["English"]);
  assert.equal(nsis.installMode, "currentUser");
});

test("the installer art has the sizes NSIS expects", () => {
  assert.deepEqual(bmpSize(nsis.headerImage), { width: 150, height: 57 });
  assert.deepEqual(bmpSize(nsis.sidebarImage), { width: 164, height: 314 });
});

test("the hooks close both the Electron and the Tauri app before install and uninstall", () => {
  const hooks = read(nsis.installerHooks);
  assert.match(hooks, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(hooks, /!macro NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks, /WeaveForge\.exe/);
  assert.match(hooks, /weaveforge-shell\.exe/);
  assert.match(hooks, /taskkill/);
  // The header strip colours from the setup window's art panel.
  assert.match(hooks, /!define MUI_BGCOLOR F1D5A7/);
  assert.match(hooks, /!define MUI_TEXTCOLOR 2B222B/);
});

// Same merge rule as the release build: tauri.bundle.json is laid over tauri.conf.json.
function deepMerge(base, over) {
  if (over === null || typeof over !== "object" || Array.isArray(over)) return over;
  const out = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v);
  return out;
}

test("the release config keeps the NSIS settings after tauri.bundle.json is merged in", () => {
  const overlay = JSON.parse(read("tauri.bundle.json"));
  const merged = deepMerge(conf, overlay);
  assert.equal(merged.bundle.active, true);
  assert.deepEqual(merged.bundle.windows.nsis, nsis);
});

test("the close macro names both exes in each taskkill call, and both hooks run it", () => {
  const hooks = read(nsis.installerHooks);
  const macro = hooks.match(/!macro WF_CLOSE_RUNNING([\s\S]*?)!macroend/)?.[1];
  assert.ok(macro, "WF_CLOSE_RUNNING macro is missing");
  const kills = macro.split("\n").filter((l) => /taskkill/.test(l));
  assert.equal(kills.length, 2, "expected a close request and a forced end");
  for (const line of kills) {
    assert.match(line, /WeaveForge\.exe/);
    assert.match(line, /weaveforge-shell\.exe/);
  }
  for (const hook of ["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_PREUNINSTALL"]) {
    assert.match(hooks, new RegExp(`!macro ${hook}\\s+!insertmacro WF_CLOSE_RUNNING\\s+!macroend`));
  }
});

test("check:all runs the installer and icon tests", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(shell, "..", "..", "package.json"), "utf8"));
  for (const file of ["apps/shell/scripts/installer-config.test.mjs", "apps/shell/scripts/shell-icons.test.mjs"]) {
    assert.ok(pkg.scripts["check:all"].includes(file), `check:all does not run ${file}`);
  }
});

test("the source pages load the font that sits beside them", () => {
  const dir = path.dirname(nsis.installerHooks);
  for (const page of ["header.html", "sidebar.html"]) {
    const html = read(path.join(dir, page));
    const font = html.match(/url\(([^)]+\.woff2)\)/)?.[1];
    assert.ok(font, `${page} names no font`);
    assert.ok(fs.existsSync(path.join(shell, dir, font)), `${page} font ${font} is missing`);
  }
});
