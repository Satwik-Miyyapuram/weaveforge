import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { latexOutline } from "../lib/latex-outline";
import { OverleafEditorToolbar } from "../ui/overleaf-editor-toolbar";
import { OverleafOutline } from "../ui/overleaf-outline";
import { OverleafPanes } from "../ui/overleaf-panes";
import { OverleafSidebar } from "../ui/overleaf-sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => n.type === "button" && (n.props["aria-label"] === label || textOf(n) === label));
const has = (tree: ReactTestRenderer, className: string) =>
  tree.root.findAll((n) => typeof n.props.className === "string" && n.props.className.split(" ").includes(className)).length > 0;

async function render(element: ReturnType<typeof createElement>) {
  let tree: ReactTestRenderer | undefined;
  await act(async () => { tree = create(element); });
  return tree!;
}

// ---- Sidebar ----

test("the sidebar has File tree and File outline panels, each folding from its header", async () => {
  const tree = await render(createElement(OverleafSidebar, {
    files: createElement("p", { className: "files-body" }, "files"),
    outline: createElement("p", { className: "outline-body" }, "outline"),
  }));
  const header = (title: string) => tree.root.find((n) => n.type === "button" && textOf(n).includes(title));
  assert.equal(header("File tree").props["aria-expanded"], true);
  assert.equal(header("File outline").props["aria-expanded"], true);
  await act(async () => header("File outline").props.onClick());
  assert.equal(header("File outline").props["aria-expanded"], false);
  assert.ok(!has(tree, "outline-body"), "a folded panel hides its body");
  assert.ok(has(tree, "files-body"));
  await act(async () => header("File tree").props.onClick());
  assert.ok(!has(tree, "files-body"));
  await act(async () => tree.unmount());
});

// ---- Outline ----

const TEXT = "\\section{Intro}\n\\subsection{Why}\n\\section{Method}";

test("the outline nests headings; a click jumps to the heading's line; a twisty folds children", async () => {
  const jumps: number[] = [];
  const tree = await render(createElement(OverleafOutline, { items: latexOutline(TEXT), activeLine: 2, onJump: (l: number) => jumps.push(l) }));
  const row = (title: string) => tree.root.find((n) => n.type === "button" && n.props.className === "wf-row" && textOf(n) === title);
  await act(async () => row("Method").props.onClick());
  assert.deepEqual(jumps, [3]);
  assert.equal(row("Why").props["aria-current"], true, "the cursor's section is marked");
  const twisty = byLabel(tree, "Collapse Intro");
  await act(async () => twisty.props.onClick());
  assert.equal(tree.root.findAll((n) => n.type === "button" && textOf(n) === "Why").length, 0);
  await act(async () => byLabel(tree, "Expand Intro").props.onClick());
  assert.ok(row("Why"));
  await act(async () => tree.unmount());
});

test("a file with no headings says so", async () => {
  const tree = await render(createElement(OverleafOutline, { items: [], activeLine: 1, onJump: () => {} }));
  assert.match(JSON.stringify(tree.toJSON()), /No sections in this file/);
  await act(async () => tree.unmount());
});

// ---- Panes ----

function panes(layout: "split" | "editor" | "pdf", calls: string[]) {
  return createElement(OverleafPanes, {
    layout,
    onLayout: (l: string) => calls.push(l),
    sidebar: createElement("p", null, "S"),
    editor: createElement("p", null, "E"),
    pdf: createElement("p", null, "P"),
  });
}

test("split shows all three panes with dividers; collapsing the PDF picks the editor layout", async () => {
  const calls: string[] = [];
  const tree = await render(panes("split", calls));
  assert.equal(tree.root.findAll((n) => n.props.role === "separator").length, 2);
  await act(async () => byLabel(tree, "Hide PDF").props.onClick());
  await act(async () => byLabel(tree, "Hide editor").props.onClick());
  assert.deepEqual(calls, ["editor", "pdf"]);
  await act(async () => tree.unmount());
});

test("editor-only keeps the PDF mounted but hidden, and its divider brings it back", async () => {
  const calls: string[] = [];
  const tree = await render(panes("editor", calls));
  const pdf = tree.root.find((n) => typeof n.props.className === "string" && n.props.className.includes("overleaf-panes__pdf"));
  assert.ok(pdf.props.hidden, "hidden, not unmounted");
  await act(async () => byLabel(tree, "Show PDF").props.onClick());
  assert.deepEqual(calls, ["split"]);
  await act(async () => tree.unmount());
});

test("the sidebar folds away and comes back from its divider", async () => {
  const tree = await render(panes("split", []));
  await act(async () => byLabel(tree, "Hide file tree").props.onClick());
  const side = tree.root.find((n) => typeof n.props.className === "string" && n.props.className.includes("overleaf-panes__side"));
  assert.ok(side.props.hidden);
  await act(async () => byLabel(tree, "Show file tree").props.onClick());
  assert.ok(!side.props.hidden);
  await act(async () => tree.unmount());
});

test("arrow keys on a divider resize its panes", async () => {
  const tree = await render(panes("split", []));
  const [sideDivider, mainDivider] = tree.root.findAll((n) => n.props.role === "separator");
  const before = Number(mainDivider!.props["aria-valuenow"]);
  await act(async () => mainDivider!.props.onKeyDown({ key: "ArrowRight", preventDefault() {} }));
  assert.ok(Number(mainDivider!.props["aria-valuenow"]) > before);
  const sideBefore = Number(sideDivider!.props["aria-valuenow"]);
  await act(async () => sideDivider!.props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }));
  assert.ok(Number(sideDivider!.props["aria-valuenow"]) < sideBefore);
  await act(async () => tree.unmount());
});

// ---- Toolbar ----

test("toolbar buttons send their format; undo, redo and search have their own calls", async () => {
  const calls: string[] = [];
  const tree = await render(createElement(OverleafEditorToolbar, {
    style: "normal",
    disabled: false,
    onFormat: (f: string) => calls.push(f),
    onUndo: () => calls.push("undo"),
    onRedo: () => calls.push("redo"),
    onSearch: () => calls.push("search"),
  }));
  for (const label of ["Undo", "Redo", "Bold", "Italic", "Math", "Display math", "Link", "Bullet list", "Numbered list", "Toggle comment", "Search"]) {
    await act(async () => byLabel(tree, label).props.onClick());
  }
  assert.deepEqual(calls, ["undo", "redo", "bold", "italic", "math", "displayMath", "link", "itemize", "enumerate", "comment", "search"]);
  await act(async () => tree.unmount());
});

test("a read-only file disables the formatting tools", async () => {
  const tree = await render(createElement(OverleafEditorToolbar, {
    style: "normal", disabled: true, onFormat: () => {}, onUndo: () => {}, onRedo: () => {}, onSearch: () => {},
  }));
  assert.equal(byLabel(tree, "Bold").props.disabled, true);
  assert.equal(byLabel(tree, "Search").props.disabled, undefined, "search still works");
  await act(async () => tree.unmount());
});
