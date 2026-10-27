/**
 * The phone's top row is the project picker and the account button. The lab
 * chip beside them squeezed the project name until the two overlapped; lab
 * switching lives in the account menu instead. On the workspace, which has no
 * page gutter, the row keeps its own so the account badge stays on screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const shellCss = () => read("../styles/shell.css");

test("the phone header has no lab chip", () => {
  const src = read("../app-shell.tsx");
  const row = src.slice(src.indexOf('className="brand mobile-only"'), src.indexOf("</div>", src.indexOf('className="brand-right"')));
  assert.ok(row.includes("<ProjectSwitcher />"));
  assert.doesNotMatch(row, /<OrgSwitcher/);
  assert.doesNotMatch(src, /import \{[^}]*OrgSwitcher/);
  assert.doesNotMatch(shellCss(), /\.brand\.mobile-only \.org-switcher/);
});

test("the account menu still switches labs", () => {
  const src = read("../header-actions.tsx");
  assert.match(src, /labs\.length > 1 && \(\s*<OrgMenuSubmenu/);
});

test("a long project name shrinks to an ellipsis before it reaches the account button", () => {
  const css = shellCss();
  assert.match(css, /\.brand\.mobile-only \.proj-switcher \{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0/);
  assert.match(css, /\.brand\.mobile-only \.proj-switcher \.wf-btn > span:nth-child\(2\) \{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.brand-right \{[^}]*flex:\s*none/);
  // The chip sits in an inline-flex popover, which takes its content's width
  // unless capped; each flex level then needs min-width: 0 to shrink.
  assert.match(css, /\.brand\.mobile-only \.proj-switcher \.popover \{[^}]*max-width:\s*100%/);
  assert.match(css, /\.brand\.mobile-only \.proj-switcher \.wf-btn \{[^}]*min-width:\s*0/);
  assert.match(css, /\.brand\.mobile-only \.proj-switcher \.wf-btn > span:nth-child\(2\) \{[^}]*min-width:\s*0/);
});

test("on the workspace the phone header keeps a side gutter", () => {
  assert.match(shellCss(), /\.layout\.editor-route \.brand\.mobile-only \{[^}]*padding-inline:\s*16px/);
});
