// Turns the DS bundle.css into the app's states.css: aliases app classes onto .wf-* and lifts specificity over old theme rules.
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);

const MAP = {
  "wf-btn": [".btn-primary", ".btn-secondary", ".btn-ghost", ".btn-cancel", ".btn-danger", ".auth-wide", ".btn-google",
    ".dashboard-customize-btn", ".proj-chip", ".entity-icon-btn", ".entity-open-icon", ".paper-open-icon",
    ".pdf-reader-icon-btn", ".card-menu-trigger", ".header-overflow-btn", ".list-toggle"],
  "wf-primary": [".btn-primary"],
  "wf-danger": [".btn-danger"],
  "wf-ghost": [".btn-ghost", ".btn-cancel", ".card-menu-trigger", ".header-overflow-btn", ".list-toggle"],
  "wf-icon": [".entity-icon-btn", ".entity-open-icon", ".paper-open-icon", ".pdf-reader-icon-btn"],
  "wf-sm": [".btn-sm"],
  "wf-back": [".back-btn"],
  "wf-back-box": [".back-btn-box"],
  "wf-link": [".link-btn", ".link", ".auth-link", ".auth-link-sm"],
  "wf-tool": [".ink-tool", ".pdf-reader-create-icon", ".pdf-reader-pop-btn"],
  "wf-seg": [".seg"],
  "wf-tab": [".sub-tab", ".pane-tab", ".graph-drawer-tab", ".mcp-tab"],
  "wf-nav": [".nav-link", ".header-link"],
  "wf-chip": [".tag-chip", ".git-chip", ".jump-to-chip", ".graph-chip"],
  "wf-chip-x": [".filter-chip-x", ".jump-to-chip-remove", ".tag-del"],
  "wf-swatch": [".ink-swatch", ".pdf-reader-pop-swatch", ".pdf-reader-create-swatch", ".pdf-reader-pill-swatch", ".list-color-pick"],
  "wf-toggle": [".appearance-switch"],
  "wf-check": [".themed-check", ".milestone-check"],
  "wf-input": [".themed-input", ".paper-field-input", ".search-input", ".input", ".explorer-filter", ".graph-search-input",
    ".settings-find", ".quick-open-input", ".pdf-reader-pop-input"],
  "wf-select": [".custom-select-button"],
  "wf-pop": [".popover-panel", ".custom-select-menu", ".card-menu-flyout", ".menu-flyout", ".header-menu", ".proj-menu",
    ".ink-menu-list", ".member-tree-menu", ".title-bar-menu", ".graph-edge-popover", ".pdf-reader-ref-popover",
    ".ink-figure-popover", ".note-comment-pop"],
  "wf-menu": [".custom-select-menu", ".card-menu-flyout", ".menu-flyout", ".header-menu", ".proj-menu", ".ink-menu-list",
    ".member-tree-menu", ".title-bar-menu"],
  "wf-item": [".custom-select-item", ".card-menu-item", ".menu-item", ".proj-menu-item", ".ink-menu-item", ".ms-item", ".title-bar-item"],
  "wf-toast": ["[data-sonner-toast]"],
  "wf-scrim": [".modal-backdrop"],
  "wf-modal": [".modal"],
  "wf-sheet": [".comments-sheet"],
};
const SELECTED = ".seg-on, .is-active, .is-selected, .sel, .on, .active";

// Split a selector list on commas outside brackets.
const splitTop = (s) => {
  const parts = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
};
const boost = (sel) => (sel.startsWith(":root") ? ":root:root" + sel : ":root:root " + sel);
const boostList = (list) => splitTop(list).map(boost).join(", ");

const lines = readFileSync(src, "utf8").split("\n");
const start = lines.findIndex((l) => /^(:is\(\.wf-|\.wf-)/.test(l));
for (let i = start; i < lines.length; i++) {
  const l = lines[i];
  const indent = l.match(/^\s*/)[0];
  const t = l.trimStart();
  if (t.startsWith("@keyframes")) continue;
  const ss = t.match(/^@starting-style \{ (.+?) \{(.*)$/);
  if (ss) { lines[i] = `${indent}@starting-style { ${boostList(ss[1])} {${ss[2]}`; continue; }
  if (!/^[.:\[a-z]/.test(t) || !t.includes("{") || /^[a-z-]+\s*:/.test(t)) continue;
  const at = t.indexOf(" {");
  lines[i] = indent + boostList(t.slice(0, at)) + t.slice(at);
}
let css = lines.join("\n");

css = css.replaceAll(':is([aria-pressed="true"]', `:is([aria-pressed="true"], ${SELECTED}`);
css = css.replaceAll(':is([aria-selected="true"], [aria-current="page"])', ':is([aria-selected="true"], [aria-current="page"], .active, .is-active)');
css = css.replaceAll('.wf-nav[aria-current="page"]', '.wf-nav:is([aria-current="page"], .active)');
for (const [wf, app] of Object.entries(MAP)) {
  css = css.replace(new RegExp(`\\.${wf}(?![\\w-])`, "g"), `:is(.${wf}, ${app.join(", ")})`);
}
css = css.replace(/^\/\* WeaveForge states and motion[^]*?\*\//, "/* States and motion for every control, from the design system bundle; generated, edit the DS then regenerate. */");
writeFileSync(out, css);
