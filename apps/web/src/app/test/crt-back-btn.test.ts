/** The CRT back button takes its colours from the CRT theme, not hard-coded hex. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const record = read("../styles/record.css");
const crt = read("../themes/crt.css");

/** Declarations of the rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `missing rule ${selector}`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

test("the CRT back button uses theme tokens", () => {
  const body = rule(record, ':root[data-theme="crt"] .back-btn-box');
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i);
  assert.match(body, /background:\s*var\(--btn-2\)/);
  assert.match(body, /color:\s*var\(--text\)/);
});

test("the CRT theme defines the secondary button fill with its old value", () => {
  assert.match(crt, /--btn-2:\s*#f29731;/i);
  assert.match(crt, /--text:\s*#2b222b;/i);
});
