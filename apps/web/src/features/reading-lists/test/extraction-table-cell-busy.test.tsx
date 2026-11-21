/**
 * Saving one extraction cell leaves the other cells editable (P2-176). A
 * single `busy` flag used to disable the whole table, so tabbing from cell A
 * to cell B landed on a disabled field.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ExtractionTable } from "../ui/extraction-table";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const oldWindow = g.window;

before(async () => {
  await loadTestCore();
  g.window = { addEventListener() {}, removeEventListener() {}, setTimeout };
});
after(() => {
  setContainerForTests(null);
  if (hadWindow) g.window = oldWindow;
  else delete g.window;
});

const paper = (id: string, title: string) => ({
  id,
  title,
  authors: [],
  status: "to_read",
  tags: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

test("a cell being saved does not disable the other cells (P2-176)", async () => {
  let release!: () => void;
  setContainerForTests({
    paperFields: {
      listPaperFieldDefs: async () => [{ id: "f1", name: "Method", kind: "text", options: [], sortOrder: 0 }],
      listPaperFieldValuesForProject: async () => [],
      setPaperFieldValue: () => new Promise<void>((resolve) => { release = resolve; }),
    },
    readingLists: {
      listItemsForLists: async () => [
        { id: "i1", paperId: "p1", inheritedFromListId: null },
        { id: "i2", paperId: "p2", inheritedFromListId: null },
      ],
    },
    aiProposals: { listPending: async () => [] },
  } as never);
  const node = { list: { id: "l1", name: "L", parentId: null, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" }, children: [] } as never;
  const papers = [paper("p1", "A"), paper("p2", "B")] as never;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(ExtractionTable, { node, papers }));
  });
  await flush();
  const cells = () => r.root.findAll((n) => n.type === "input" && n.props["aria-label"] === "Method");
  assert.equal(cells().length, 2);

  await act(async () => { cells()[0]!.props.onChange({ target: { value: "RL" } }); });
  await act(async () => { cells()[0]!.props.onBlur(); });
  assert.equal(cells()[0]!.props.disabled, true, "the saving cell waits for its save");
  assert.equal(cells()[1]!.props.disabled, false, "the next cell stays editable");

  await act(async () => { release(); });
  await flush();
  assert.equal(cells()[0]!.props.disabled, false);
  await act(async () => { r.unmount(); });
});