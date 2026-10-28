/** One route list feeds the sidebar, the phone bar and the desktop Go menu (D14). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string) => readFileSync(join(src, rel), "utf8");

test("the sidebar groups are Library, Work and Write (DA-92)", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const groups = buildModuleRegistry().navGroups.map((g) => [g.label, g.items.map((i) => i.label)]);
  const enabled = new Set(buildModuleRegistry().modules.map((m) => m.id));
  const work = ["Experiments", ...(enabled.has("git") ? ["Git"] : []), "Plan", "Log"];
  assert.deepEqual(groups, [
    ["Library", ["Papers", "Notes", "Wiki", "Graph", "Lists"]],
    ["Work", work],
    ["Write", ["Report", "Overleaf"]],
  ]);
});

test("one name per route: Workspace, Report (D-29, D-30)", async () => {
  const { buildModuleRegistry } = await import("../registry");
  assert.deepEqual(buildModuleRegistry().topNavItems.map((i) => i.label), ["Workspace"]);
  assert.match(read("features/report/ui/report-screen.tsx"), /<ScreenHead title="Report"/);
});

test("the desktop Go menu lists the sidebar's pages, in its order and with its names (DA-86)", async () => {
  const { buildModuleRegistry } = await import("../registry");
  const r = buildModuleRegistry();
  const menu = read("../../desktop/src/app-menu.ts");
  const goMenu = menu.slice(menu.indexOf('label: "Go"'), menu.indexOf('label: "View"'));
  const entries = [...goMenu.matchAll(/go\("([^"]+)", "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  const expected = [r.homeNavItem, ...r.topNavItems, ...r.navGroups.flatMap((g) => g.items)]
    // Git is in the menu whatever this build's config says; the window decides.
    .map((i) => `${i.label} ${i.path}`);
  if (!expected.includes("Git /git")) expected.splice(expected.indexOf("Plan /plan"), 0, "Git /git");
  assert.deepEqual(entries.filter((e) => !INBOX_AND_ACCOUNT.includes(e)), expected);
  for (const e of INBOX_AND_ACCOUNT) assert.ok(entries.includes(e), `Go menu misses ${e}`);
});

const INBOX_AND_ACCOUNT = ["AI suggestions /ai-review", "Shared with you /shared", "Supervision /supervision", "Settings /settings"];

test("every Inbox route has a window title that matches its nav name", async () => {
  const { titleForPath } = await import("../lib/route-title");
  assert.equal(titleForPath("/ai-review", []), "AI suggestions · WeaveForge");
  assert.equal(titleForPath("/shared", []), "Shared with you · WeaveForge");
  assert.equal(titleForPath("/supervision", []), "Supervision · WeaveForge");
});

test("the phone bar shows each item's name, not icons alone (DA-84)", () => {
  const css = read("app/styles/nav.css");
  assert.ok(!/@media \(max-width: 460px\)\s*\{\s*\.nav-link \.nav-label \{ display: none; \}/.test(css));
});
