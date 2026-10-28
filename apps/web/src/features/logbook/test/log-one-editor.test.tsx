/**
 * A log entry is written in the note editor, new or edited (design D19,
 * DA-102): no plain textarea for a new entry, no bare mono editor for an
 * edit. Paper notes and report sections already mount the workspace's
 * `DocumentBody`, so the logbook was the last surface with an editor of its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AddLogEntryForm } from "../ui/add-log-entry-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("a new entry is written in the note editor, not a textarea", () => {
  const form = src("../ui/add-log-entry-form.tsx");
  assert.doesNotMatch(form, /<textarea/);
  assert.match(form, /<MarkdownField\b/);
});

test("the note editor field builds the workspace editor's own stack", () => {
  const field = src("../../../components/markdown/markdown-field-editor.tsx");
  assert.match(field, /markdownEditorExtensions\(/);
  assert.match(field, /watchSiteTheme\(/);
  // Lazy, so the logbook route does not carry CodeMirror in its first load.
  assert.match(src("../../../components/markdown-field.tsx"), /dynamic\(/);
});

test("an edited entry uses the same stack, not the bare fallback", () => {
  const screen = src("../ui/logbook-screen.tsx");
  const host = screen.slice(screen.indexOf("<CollabBodyHost"));
  const props = host.slice(0, host.indexOf("/>"));
  assert.match(props, /markdownEditing=\{/);
  assert.match(props, /editorClassName="log-body-editor"/);
  assert.match(src("../ui/add-log-entry-form.tsx"), /className="log-body-editor"/);
});

test("Create waits for words, since the editor is not a required field", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(AddLogEntryForm, {}));
  });
  const create_ = tree.root.find((n) => n.type === "button" && n.props.type === "submit");
  assert.equal(create_.props.disabled, true);
  act(() => tree.unmount());
});
