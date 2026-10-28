/**
 * Every screen says "empty" and "loading" the same way. Screens had drifted:
 * the dashboard's empty state was one grey line, the graph's focus mode used a
 * bare `.empty` div, the AI review state had no icon, and the workspace and a
 * student's supervision page loaded behind plain "Loading…" text. Screens use
 * EmptyState (with an icon on first run) and the branded loaders instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const features = fileURLToPath(new URL("../../features", import.meta.url));

function screens(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : screens(path);
    return name.endsWith("-screen.tsx") ? [path] : [];
  });
}

const files = screens(features).map((path) => ({ path, src: readFileSync(path, "utf8") }));

test("the scan finds the screens", () => {
  assert.ok(files.length > 15, `found ${files.length}`);
});

test("no screen hand-rolls an empty state", () => {
  for (const { path, src } of files) {
    assert.doesNotMatch(src, /className="empty[ "]/, path);
    assert.doesNotMatch(src, /className="muted dashboard-empty"/, path);
  }
});

test("every first-run empty state carries the screen's icon", () => {
  for (const { path, src } of files) {
    for (const m of src.matchAll(/<EmptyState\b([\s\S]*?)\/>/g)) {
      const props = m[1] ?? "";
      if (!/variant="first-run"/.test(props)) continue;
      assert.match(props, /\bicon=\{/, `${path}: ${props.slice(0, 80)}`);
    }
  }
});

test("no screen loads behind a plain grey line", () => {
  for (const { path, src } of files) {
    assert.doesNotMatch(src, /<p className="muted">Loading[^<]*<\/p>/, path);
  }
});
