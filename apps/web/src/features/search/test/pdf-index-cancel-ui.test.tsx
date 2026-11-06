import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Paper } from "@weaveforge/core";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import {
  autoIndexStatus,
  runLibraryIndex,
  setAutoIndexDeps,
  stopAutoIndex,
  type AutoIndexDeps,
} from "../application/auto-index-library";
import type { LibraryIndexResult } from "../application/index-library-pdfs";
import { PdfIndexChip } from "../ui/pdf-index-chip";
import { LibraryPdfIndexing } from "@/features/settings/ui/library-pdf-indexing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY: LibraryIndexResult = { indexed: 0, skipped: 0, failed: 0, failures: [], reasons: {}, unreadIds: [] };

/** A run 3 of 10 in that holds until aborted. */
function holdingRun(): { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const deps: AutoIndexDeps = {
    projectId: () => "ui",
    papersNeedingIndex: async () => [{ id: "p1", title: "One" } as Paper],
    indexLibraryPdfs: (_papers, options) =>
      new Promise((resolve) => {
        signals.push(options!.signal!);
        options!.onProgress?.({ done: 3, total: 10, current: "Four", indexed: 3, skipped: 0, failed: 0 });
        options!.signal!.addEventListener("abort", () => resolve({ ...EMPTY, indexed: 3 }));
      }),
  };
  setAutoIndexDeps(deps);
  return { signals };
}

/** Plain text in `children`, skipping elements (an icon's props can be circular). */
const textOf = (children: unknown): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : "";

const buttons = (tree: ReactTestRenderer, label: RegExp) =>
  tree.root.findAll(
    (node) => node.type === "button" && label.test(`${textOf(node.props.children)} ${node.props["aria-label"] ?? ""}`),
  );

test("the nav chip shows a run's progress and its × stops it", async () => {
  await withAppLogs(async () => {
    const run = holdingRun();
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(createElement(PdfIndexChip));
    });
    assert.equal(tree!.toJSON(), null, "nothing shows while idle");
    let done: Promise<unknown> = Promise.resolve();
    await act(async () => {
      done = runLibraryIndex();
    });
    assert.match(JSON.stringify(tree!.toJSON()), /Indexing PDFs.*3.*of.*10/);
    await act(async () => buttons(tree!, /Stop indexing/)[0]!.props.onClick());
    await act(async () => {
      await done;
    });
    assert.equal(run.signals[0]!.aborted, true);
    assert.equal(tree!.toJSON(), null, "the chip goes once the run stops");
    await act(async () => tree!.unmount());
    stopAutoIndex();
  });
});

test("Settings shows Cancel while a run goes, even one started before it opened", async () => {
  await withAppLogs(async () => {
    const run = holdingRun();
    let done: Promise<unknown> = Promise.resolve();
    await act(async () => {
      done = runLibraryIndex();
    });
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(createElement(LibraryPdfIndexing));
    });
    assert.match(JSON.stringify(tree!.toJSON()), /3 of 10/);
    const cancel = buttons(tree!, /Cancel/);
    assert.equal(cancel.length, 1);
    await act(async () => cancel[0]!.props.onClick());
    await act(async () => {
      await done;
    });
    assert.equal(run.signals[0]!.aborted, true);
    assert.equal(autoIndexStatus().stopped, true);
    assert.equal(buttons(tree!, /Cancel/).length, 0, "Cancel goes once the run stops");
    await act(async () => tree!.unmount());
    stopAutoIndex();
  });
});
