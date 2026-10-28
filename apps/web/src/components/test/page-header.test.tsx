/** One page header with a visible h1, one empty state, one comments badge (D11). */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "../empty-state";
import { CommentsBadge } from "../../features/sharing/ui/comments-badge";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : filesUnder(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

test("the screen header is the page header and always draws its h1 (DA-50)", () => {
  const head = src("components/screen-head.tsx");
  assert.match(head, /"screen-head page-header"/);
  const css = src("app/styles/buttons.css");
  const auto = css.match(/\.screen-title--auto \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(auto, /clip|position: absolute/);
});

test("no screen restyles or hides its title (DA-50)", () => {
  assert.doesNotMatch(src("app/styles/dashboard.css"), /\.(dashboard|report)-screen \.screen-title \{[^}]*font-size/);
  assert.doesNotMatch(src("app/styles/entity-detail.css"), /\.screen-title-block \{ display: none/);
  assert.match(src("app/not-found.css"), /\.not-found-title \{[^}]*font-size: var\(--fs-h1\)/);
});

test("every list screen opens on the page header (DA-50)", () => {
  const root = fileURLToPath(new URL("../../features", import.meta.url));
  // Record pages and the reader open on the item's own title instead.
  const own = /experiment-detail-screen|reader-screen/;
  const missing = filesUnder(root)
    .filter((f) => /className=["{`]+screen /.test(readFileSync(f, "utf8")) && !own.test(f))
    .filter((f) => !readFileSync(f, "utf8").includes("<ScreenHead"));
  assert.deepEqual(missing, []);
});

test("an empty state has icon, title, text and one action (DA-51)", () => {
  const html = renderToStaticMarkup(
    <EmptyState variant="first-run" icon={<svg />} title="Nothing yet" body="Why." action={<a className="btn-primary" href="/x">Go</a>} />,
  );
  assert.match(html, /empty-mark/);
  assert.match(html, /<h3 class="empty-title">Nothing yet<\/h3>/);
  assert.match(html, /<p class="empty-body">Why\.<\/p>/);
  assert.equal(html.match(/btn-primary/g)?.length, 1);
});

test("AI review and Supervision use the shared empty state (DA-51)", () => {
  const review = src("features/ai-assistant/ui/ai-proposal-review-screen.tsx");
  assert.doesNotMatch(review, /"card empty-state"/);
  assert.match(review, /<EmptyState/);
  const superv = src("features/org/ui/supervision-screen.tsx");
  assert.match(superv, /<EmptyState[\s\S]{0,120}?title="No students yet"/);
  // The empty state's one action is the only way to Sharing then.
  assert.match(superv, /supervisees\.length > 0 && \(\s*<Button href="\/shared">/);
});

test("the 404 has one primary and the rest as text links (DA-55)", () => {
  const page = src("app/not-found.tsx");
  assert.equal(page.match(/<Button\s/g)?.length, 1);
  assert.match(page, /<Button variant="primary" href="\/">/);
});

test("Git with no repository offers one way to settings (DA-56)", () => {
  const git = src("features/sync/ui/git-screen.tsx");
  assert.match(git, /\{integration && \(\s*<Button href="\/settings">/);
});

test("every settings panel opens on the same card header (DA-53)", () => {
  const dir = fileURLToPath(new URL("../../features/settings/ui", import.meta.url));
  for (const f of filesUnder(dir)) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /appearance-title|<h2>/, f);
  }
  assert.match(src("features/settings/ui/appearance-panel.tsx"), /className="card add-form settings-anchor appearance"/);
});

test("a report section page is as wide as the report list (DA-54)", () => {
  assert.match(src("app/styles/record.css"), /\.record \{\s*max-width: var\(--app-max\);/);
});

test("comments show a count badge, never the word None (D-25)", () => {
  assert.equal(renderToStaticMarkup(<CommentsBadge count={0} />), "");
  assert.equal(renderToStaticMarkup(<CommentsBadge count={3} />), '<span class="comments-badge" aria-label="3 open">3</span>');
  const inline = src("features/sharing/ui/note-comments.tsx");
  assert.doesNotMatch(inline, /"None"/);
  assert.match(inline, /<CommentsBadge count=\{openThreads\.length\} \/>/);
  assert.match(src("features/sharing/ui/comments-toggle.tsx"), /<CommentsBadge count=\{count\} \/>/);
});

/**
 * Where a header's actions break R5.1: `[search] [secondary…] [primary] [⋯]`.
 * Search is a prop, so ScreenHead draws it first; this reads the children.
 */
export function headerOrderProblems(block: string): string[] {
  const controls = [...block.matchAll(/<(Button|IconButton|ShareButton|Popover)\b([^>]*)>/g)].map(([, tag, attrs = ""]) =>
    tag === "Popover" && /ariaLabel="More actions"/.test(attrs) ? "more" : /variant="primary"/.test(attrs) ? "primary" : "secondary",
  );
  const problems: string[] = [];
  if (controls.filter((c) => c === "primary").length > 1) problems.push("more than one primary");
  const primary = controls.indexOf("primary");
  if (primary >= 0 && controls.slice(primary + 1).some((c) => c === "secondary")) problems.push("secondary after primary");
  const more = controls.indexOf("more");
  if (more >= 0 && more !== controls.length - 1) problems.push("⋯ is not last");
  return problems;
}

test("the order scanner flags each R5.1 break and passes the rule", () => {
  const ok = `<ScreenHead><Button>Sync</Button><Button variant="primary">Add</Button><Popover ariaLabel="More actions"></Popover></ScreenHead>`;
  assert.deepEqual(headerOrderProblems(ok), []);
  assert.deepEqual(headerOrderProblems(`<Button variant="primary">Add</Button><Button>Sync</Button>`), ["secondary after primary"]);
  assert.deepEqual(headerOrderProblems(`<Popover ariaLabel="More actions"></Popover><Button variant="primary">Add</Button>`), ["⋯ is not last"]);
  assert.deepEqual(headerOrderProblems(`<Button variant="primary">A</Button><Button variant="primary">B</Button>`), ["more than one primary"]);
});

test("every page header orders its actions search, secondary, primary, ⋯ (R5.1)", () => {
  const root = fileURLToPath(new URL("../../features", import.meta.url));
  const found = filesUnder(root).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/<ScreenHead\b[\s\S]*?<\/ScreenHead>/g)].flatMap((m) =>
      headerOrderProblems(m[0]).map((p) => `${f.slice(root.length + 1)}: ${p}`),
    ),
  );
  assert.deepEqual(found, []);
  // The dashboard's header actions live in their own bar.
  assert.deepEqual(headerOrderProblems(src("features/dashboard/ui/dashboard-edit-bar.tsx")), []);
});
