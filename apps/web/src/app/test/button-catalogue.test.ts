/**
 * Every button is one of the catalogue kinds, and nothing else.
 *
 * A button may carry only the class names below: one kind, plus looks.
 * Anything else on a button is a new button look, and this test fails with
 * "new button look" naming the class and the place. Positioning belongs on the
 * parent, not on the button. To add a kind, add it here, to states.css and to
 * the primitives, on purpose.
 *
 * "A button" is any button primitive, any <a> or <Link>
 * that looks like a button, and anything with role="button".
 *
 * The old names the catalogue replaced are gone from the code and the CSS.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** One kind per button. */
export const KINDS = [
  "wf-btn", "wf-tool", "wf-tab", "wf-chip", "wf-chip-x", "wf-row", "wf-fold", "wf-item",
  "wf-select", "wf-swatch", "wf-nav", "wf-link", "wf-toggle",
];
/** Looks a kind may add. */
export const LOOKS = ["wf-primary", "wf-ghost", "wf-danger", "wf-danger-ghost", "wf-icon", "wf-sm"];
const CATALOGUE = new Set([...KINDS, ...LOOKS]);
/**
 * wf-* names that are not buttons: surfaces, containers and form fields. They
 * never go on a button (the first test), and a card is never clickable itself.
 */
export const NOT_BUTTONS = [
  "wf-card", "wf-seg", "wf-tabs", "wf-fold-count", "wf-check", "wf-radio", "wf-input", "wf-kbd", "wf-sep",
  "wf-menu", "wf-menu-label", "wf-pop", "wf-modal", "wf-sheet", "wf-scrim", "wf-toast", "wf-tip", "wf-has-tip",
  "wf-closing", "wf-looks",
];

/** The primitives: the only files that may pass a caller's className through. */
const PRIMITIVES = ["components/button.tsx", "components/controls.tsx", "components/popover.tsx"];
const BUTTON_TAGS = new Set([
  "Button", "IconButton", "IconLink", "CloseButton", "MoreButton", "RowButton", "ToolButton", "MenuItemButton", "MenuItemLink", "TabButton",
  "ToggleButton", "OptionButton", "RadioButton", "ComboboxButton", "Switch", "Swatch", "Chip", "FoldButton", "NavLink", "NavButton",
]);
/** An <a> or <Link> is a button when its class says so. */
const BUTTON_LIKE = /^wf-|btn|button|chip|tab|toggle|tool|nav-link|header-link|back|link-btn/;

const src = fileURLToPath(new URL("../../", import.meta.url));
function sources(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sources(path, ext);
    return ext.test(name) ? [path] : [];
  });
}
const rel = (path: string) => relative(src, path).replace(/\\/g, "/");
const tsx = sources(src, /\.tsx$/).map((path) => ({
  rel: rel(path),
  sf: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
}));

/**
 * The class words an expression can produce, and the parts that are not
 * literal. A condition's test and the left of `&&` choose a class, so they may
 * be anything; the class itself must be written out.
 */
function classWords(node: ts.Node | undefined): { words: string[]; computed: string[] } {
  const words: string[] = [];
  const computed: string[] = [];
  const visit = (n: ts.Node | undefined): void => {
    if (!n) return;
    if (ts.isJsxExpression(n) || ts.isParenthesizedExpression(n)) return visit(n.expression);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) words.push(...n.text.split(/\s+/));
    else if (ts.isTemplateExpression(n)) {
      words.push(...n.head.text.split(/\s+/));
      for (const s of n.templateSpans) { visit(s.expression); words.push(...s.literal.text.split(/\s+/)); }
    } else if (ts.isConditionalExpression(n)) { visit(n.whenTrue); visit(n.whenFalse); }
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) visit(n.right);
    else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(n.operatorToken.kind)) { visit(n.left); visit(n.right); }
    else if (ts.isCallExpression(n) && /^(cn|clsx)$/.test(n.expression.getText())) n.arguments.forEach(visit);
    else if (ts.isArrayLiteralExpression(n)) n.elements.forEach(visit);
    else if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(n) && n.text === "undefined")) return;
    else computed.push(n.getText().replace(/\s+/g, " ").slice(0, 60));
  };
  visit(node);
  return { words: words.filter(Boolean), computed };
}

function attr(open: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return open.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** Every button outside the primitives, with the classes it is given. */
function buttons() {
  const out: { at: string; tag: string; words: string[]; computed: string[] }[] = [];
  for (const { rel: file, sf } of tsx) {
    if (PRIMITIVES.includes(file)) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const at = `${file}:${lineOf(sf, n)}`;
        const role = attr(n, "role")?.initializer;
        // Any role that can come out as "button", literal or behind a condition.
        const isRoleButton = !!role && /(["'`])button\1/.test(role.getText(sf));
        if (BUTTON_TAGS.has(tag) || isRoleButton) {
          out.push({ at, tag, ...classWords(attr(n, "className")?.initializer) });
        } else if (tag === "a" || tag === "Link") {
          const c = classWords(attr(n, "className")?.initializer);
          if (c.words.some((w) => BUTTON_LIKE.test(w))) out.push({ at, tag, ...c });
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return out;
}

test("every button uses only catalogue class names; anything else is a new button look", () => {
  const errors = buttons().flatMap((b) =>
    b.words.filter((w) => !CATALOGUE.has(w)).map((w) => `new button look '${w}' on <${b.tag}> at ${b.at}: use a catalogue kind`));
  assert.deepEqual(errors, []);
});

test("a button's classes are written out, never computed from a variable", () => {
  const errors = buttons().flatMap((b) =>
    b.computed.map((c) => `computed class '${c}' on <${b.tag}> at ${b.at}: write the catalogue kind out`));
  assert.deepEqual(errors, []);
});

test("nothing outside the primitives is a button by role", () => {
  const errors = buttons().filter((b) => !BUTTON_TAGS.has(b.tag) && b.tag !== "a" && b.tag !== "Link")
    .map((b) => `new button: <${b.tag} role="button"> at ${b.at}: use a button primitive`);
  assert.deepEqual(errors, []);
});

test("the primitives themselves write only catalogue class names", () => {
  const errors: string[] = [];
  for (const { rel: file, sf } of tsx.filter((f) => PRIMITIVES.includes(f.rel))) {
    const visit = (n: ts.Node): void => {
      // Class words in a button's className (not its inner parts), and in any *_CLASS lookup table.
      const owner = ts.isJsxAttribute(n) ? n.parent.parent.tagName.getText(sf) : "";
      const isClassAttr = ts.isJsxAttribute(n) && n.name.getText() === "className" && (BUTTON_TAGS.has(owner) || /^(button|a|Link)$/.test(owner));
      const isTable = ts.isVariableDeclaration(n) && /CLASS/.test(n.name.getText());
      if (isClassAttr || isTable) {
        const init = isClassAttr ? (n as ts.JsxAttribute).initializer : (n as ts.VariableDeclaration).initializer;
        const strings: string[] = [];
        const grab = (m: ts.Node): void => {
          if (ts.isStringLiteral(m) || ts.isNoSubstitutionTemplateLiteral(m)) strings.push(...m.text.split(/\s+/));
          else if (ts.isTemplateExpression(m)) { strings.push(...m.head.text.split(/\s+/), ...m.templateSpans.flatMap((s) => s.literal.text.split(/\s+/))); m.templateSpans.forEach((s) => grab(s.expression)); }
          else if (ts.isPropertyAssignment(m)) grab(m.initializer);
          else m.forEachChild(grab);
        };
        if (init) grab(init);
        for (const w of strings.filter((s) => /^[a-z][\w-]*$/.test(s))) {
          if (!CATALOGUE.has(w)) errors.push(`primitive writes '${w}' at ${file}:${lineOf(sf, n)}: not a catalogue name`);
        }
        return;
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  assert.deepEqual(errors, []);
});

/** The names the catalogue replaced. None may come back. */
export const RETIRED = [
  // Buttons
  "btn-primary", "btn-secondary", "btn-ghost", "btn-cancel", "btn-danger", "btn-sm", "auth-wide", "btn-google",
  "dashboard-customize-btn", "proj-chip", "entity-icon-btn", "entity-open-icon", "paper-open-icon", "pdf-reader-icon-btn",
  "card-menu-trigger", "header-overflow-btn", "list-toggle", "icon-btn", "popover-trigger", "popover-trigger--icon",
  // Back, links, nav
  "back-btn", "back-btn-box", "link-btn", "link", "auth-link", "auth-link-sm", "nav-link", "header-link",
  // Tools, tabs, segments
  "ink-tool", "pdf-reader-create-icon", "pdf-reader-pop-btn", "seg", "seg-on", "sub-tab", "pane-tab", "graph-drawer-tab", "mcp-tab",
  // Chips
  "tag-chip", "git-chip", "jump-to-chip", "graph-chip", "plan-chip", "filter-chip-x", "jump-to-chip-remove", "tag-del",
  // Swatches, switches, checks
  "ink-swatch", "pdf-reader-pop-swatch", "pdf-reader-create-swatch", "pdf-reader-pill-swatch", "list-color-pick",
  "appearance-switch", "toggle", "knob", "themed-check", "milestone-check",
  // Menu items, selects
  "custom-select-item", "card-menu-item", "menu-item", "proj-menu-item", "ink-menu-item", "ms-item", "title-bar-item",
  "custom-select-button",
  // Per-feature buttons the catalogue absorbed
  "ai-access-launcher", "auth-local", "breadcrumb-btn", "btn-icon", "colour-menu-trigger", "comment-del", "comments-trigger-detail",
  "dashboard-card-remove", "dashboard-list-more-btn", "dashboard-picker-btn", "dashboard-view-full", "date-picker-day", "date-picker-nav",
  "entity-icon-text-btn", "error-report-link", "explorer-action", "explorer-row-action", "explorer-section-count", "explorer-section-toggle",
  "extraction-propose-btn", "filter-chip", "filter-chip--more", "git-chip--paper", "graph-legend-toggle", "graph-side-close",
  "graph-stage-settings", "ink-action-recognise", "ink-bar-collapse", "ink-bar-dock", "ink-figure-button", "ink-figure-button-remove",
  "ink-menu-chip", "ink-menu-paper", "ink-menu-trigger", "ink-page-add", "ink-pen-trigger", "ink-tool-hand", "ink-tool-icon-only",
  "ink-tool-nib", "ink-tool-text", "ink-zoom-level", "jump-to-create", "list-item-move", "list-item-remove", "lists-rail-item",
  "log-kind-chip", "mcp-danger", "metric-chart-run", "modal-close", "nav-home", "nav-search", "note-comments-resolved",
  "note-comments-toggle", "pane-action", "pane-tab-close", "papers-table-title-btn", "pdf-reader-ref-action", "pdf-reader-search-close",
  "pdf-reader-search-step", "pdf-reader-search-trigger", "pdf-reader-sidebar-item", "picker-btn", "quick-open-result", "record-action",
  "record-aside-toggle", "record-focus-btn", "record-link-btn", "seg--sm", "session-expired-close", "session-expired-dismiss",
  "settings-find-hit", "sort-btn", "sort-btn--on", "superv-team-item", "tag-chip-btn", "title-bar-button", "toast-action", "toast-close",
  "wf-back", "wf-back-box", "wf-current", "wf-ext", "wf-soft",
];

test("the retired button names are gone from every className", () => {
  const retired = new Set(RETIRED);
  const errors: string[] = [];
  for (const { rel: file, sf } of tsx) {
    const visit = (n: ts.Node): void => {
      if (ts.isJsxAttribute(n) && n.name.getText() === "className") {
        for (const w of classWords(n.initializer).words) if (retired.has(w)) errors.push(`retired name '${w}' at ${file}:${lineOf(sf, n)}`);
      }
      // A class list built in a variable ("item" + (sel ? " sel" : "")) never
      // reaches a className attribute as text, so check every string too. Only
      // hyphenated names: a bare retired word like "link" is also a variant name.
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
        for (const w of n.text.split(/\s+/)) if (w.includes("-") && retired.has(w)) errors.push(`retired name '${w}' at ${file}:${lineOf(sf, n)}`);
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  assert.deepEqual(errors, []);
});

test("the retired button names are gone from every stylesheet", () => {
  const pattern = new RegExp(`\\.(${RETIRED.map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})(?![\\w-])`, "g");
  const errors = sources(src, /\.css$/).flatMap((path) => {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    return [...css.matchAll(pattern)].map((m) => `retired name '${m[1]}' at ${rel(path)}:${css.slice(0, m.index).split("\n").length}`);
  });
  assert.deepEqual(errors, []);
});

test("the stylesheets define no wf-* look outside the catalogue", () => {
  const known = new Set([...CATALOGUE, ...NOT_BUTTONS]);
  const errors = sources(src, /\.css$/).flatMap((path) => {
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    return [...css.matchAll(/\.(wf-[a-z0-9-]+)/g)].filter((m) => !known.has(m[1] ?? ""))
      .map((m) => `new button look '.${m[1]}' at ${rel(path)}:${css.slice(0, m.index).split("\n").length}: not in the catalogue`);
  });
  assert.deepEqual(errors, []);
});

test("a card is a surface, never a button: clickable cards are list rows", () => {
  const css = sources(src, /\.css$/).map((path) => readFileSync(path, "utf8")).join("\n");
  for (const [, sel = ""] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    if (/\.wf-card/.test(sel)) assert.doesNotMatch(sel, /:hover|:active|hover"|press"|\(a, button|\[tabindex\]/, sel.trim().slice(0, 120));
  }
});
