/**
 * The "In library" pill on the references panel. A provider knowing a paper
 * says nothing about this workspace, so the pill follows the lookup's library
 * hit and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { create } from "react-test-renderer";
import type { Paper, ParsedReference } from "@weaveforge/core";

import { ReferencesPanel } from "../references-panel";
import type { ResolvedReference } from "../../application/reference-lookup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (index: number): ParsedReference => ({
  index, raw: `[${index}] Paper ${index}`, page: 9, x: 40, y: 700 - index, authors: ["Ba"], title: `Paper ${index}`,
});

function pills(resolutions: Map<number, ResolvedReference>): string[] {
  const tree = create(
    createElement(ReferencesPanel, { references: [entry(1), entry(2), entry(3)], resolutions, onJumpToMention: () => {} }),
  );
  return tree.root
    .findAll((node) => node.type === "span" && node.props.className === "pdf-reader-ref-pill")
    .map((node) => String(node.children.join("")));
}

test("only a reference the lookup found in the library gets the pill", () => {
  const resolutions = new Map<number, ResolvedReference>([
    [1, { status: "resolved", metadata: { title: "Paper 1", arxivId: "1607.06450" }, sourceId: "semantic-scholar" }],
    [2, { status: "resolved", metadata: { title: "Paper 2" }, inLibrary: { status: "to_read" } as Paper, sourceId: "semantic-scholar" }],
    [3, { status: "unresolved" }],
  ]);
  assert.deepEqual(pills(resolutions), ["In library · to_read"]);
});
