// One version per crate: a crate pinned in the root [workspace.dependencies] is taken
// from there (`workspace = true`), never pinned again in a member, so a bump in one
// place cannot leave the shell or a relay on the old version (F97-P2-17).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Names in the root `[workspace.dependencies]` table. */
export function workspaceDependencyNames(rootToml) {
  const names = new Set();
  let inTable = false;
  for (const line of rootToml.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inTable = /^\s*\[workspace\.dependencies\]\s*$/.test(line);
    else if (inTable) {
      const name = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
      if (name) names.add(name);
    }
  }
  return names;
}

/** `name` lines in a member manifest that pin their own version of a workspace crate. */
export function ownPins(memberToml, names) {
  const pins = [];
  for (const line of memberToml.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !names.has(match[1])) continue;
    const value = match[2];
    if (/^"/.test(value) || /\bversion\s*=/.test(value)) pins.push(match[1]);
  }
  return pins;
}

function memberManifests(rootToml) {
  const members = /^members\s*=\s*\[(.*)\]/m.exec(rootToml)?.[1] ?? "";
  const dirs = [...members.matchAll(/"([^"]+)"/g)].flatMap(([, entry]) => {
    if (!entry.endsWith("/*")) return [entry];
    const parent = entry.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => `${parent}/${dirent.name}`);
  });
  return dirs.map((dir) => `${dir}/Cargo.toml`).filter((file) => existsSync(join(root, file)));
}

test("no workspace member pins its own version of a workspace dependency", () => {
  const rootToml = readFileSync(join(root, "Cargo.toml"), "utf8");
  const names = workspaceDependencyNames(rootToml);
  assert.ok(names.has("serde") && names.has("tokio"), "the root table was read");
  const manifests = memberManifests(rootToml);
  assert.ok(manifests.includes("apps/shell/Cargo.toml"), "the shell is a member");
  const found = manifests.flatMap((file) =>
    ownPins(readFileSync(join(root, file), "utf8"), names).map((name) => `${file}: ${name}`),
  );
  assert.deepEqual(found, [], "use `{ workspace = true, features = [...] }` instead");
});

test("own pins are found in both the string and the table form", () => {
  const names = new Set(["serde", "tokio", "git2"]);
  const toml = [
    "[dependencies]",
    'serde = "=1.0.229"',
    'tokio = { version = "=1.54.1", features = ["rt"] }',
    "git2.workspace = true",
    'other = "=1.0.0"',
    "[dev-dependencies]",
    'tokio = { workspace = true, features = ["macros"] }',
  ].join("\r\n");
  assert.deepEqual(ownPins(toml, names), ["serde", "tokio"]);
});

test("the root table ends at the next header", () => {
  const toml = '[workspace.dependencies]\nserde = "=1"\n\n[workspace.lints.rust]\nunused_results = "deny"\n';
  assert.deepEqual([...workspaceDependencyNames(toml)], ["serde"]);
});
