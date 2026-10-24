/**
 * Classes no component renders. Their rules were removed from the stylesheets;
 * this keeps them from coming back without a user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const STYLES = join(SRC, "app/styles");

const DEAD = [
  "vault-editor", "vault-editor-head", "vault-title-readonly",
  "summary-editor", "summary-input", "summary-editor-foot", "summary-input-collab",
  "controls-row", "controls-spacer", "markdown-code-editor--notes", "ink-pen-only",
  "exp-detail-title", "exp-detail-hypothesis", "exp-detail-meta", "exp-detail-section",
  "exp-detail-heading", "exp-config-grid", "exp-config-row",
  "card-del", "log-head", "log-meta", "log-edit", "graph-check-grid", "legend-tag",
  "ink-ghost", "pdf-reader-caption-target", "pdf-reader-phone-toggles",
];

/** Matches `name` as a whole class token, not as a prefix of a longer one. */
const token = (name: string) => new RegExp(`(^|[^A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`);

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && keep(e.name))
    .map((e) => join(e.parentPath, e.name));
}

test("no stylesheet styles a class nothing renders", () => {
  const hits: string[] = [];
  for (const file of files(STYLES, (n) => n.endsWith(".css"))) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const name of DEAD) if (token(`\.${name}`).test(css)) hits.push(`${relative(STYLES, file)}: .${name}`);
  }
  assert.deepEqual(hits, []);
});

test("the removed classes have no TS/TSX user", () => {
  const code = files(SRC, (n) => /\.(ts|tsx)$/.test(n) && !n.includes(".test."))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  assert.deepEqual(DEAD.filter((name) => token(name).test(code)), []);
});

test("token matching ignores longer class names", () => {
  assert.equal(token("\.ink-ghost").test(".ink-ghost-image {"), false);
  assert.equal(token("\.ink-ghost").test(".ink-host .ink-ghost {"), true);
  assert.equal(token("log-head").test('className="log-header"'), false);
});
