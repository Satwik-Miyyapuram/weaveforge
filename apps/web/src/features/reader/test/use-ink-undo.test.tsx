/**
 * The undo stack records only writes that landed (23-01), and a lasso delete
 * is one step, not one per mark (23-16).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";

import { useInkUndo, type InkUndo } from "../ui/pdf-reader/use-ink-undo";
import { useAnnotationActions, type AnnotationActions } from "../ui/pdf-reader/use-annotation-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { getSelection: () => null };

function ann(id: string): ReaderAnnotation {
  return {
    id,
    origin: "local",
    zoteroKey: null,
    type: "ink",
    color: "#ff6666",
    text: "",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 0, paths: [[0, 0, 1, 1]], width: 1 } },
    sortIndex: "00000|000000|00000",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    syncState: "local",
    zoteroVersion: null,
  } as ReaderAnnotation;
}

type Writes = Pick<AnnotationActions, "persistDraft" | "removeLocal" | "saveAnchor">;

function mount(writes: Writes, rows: ReaderAnnotation[]): () => InkUndo {
  let undo: InkUndo | null = null;
  function Probe() {
    undo = useInkUndo(writes, rows);
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  return () => undo!;
}

function fakeWrites(ok: boolean, log: string[] = []): Writes {
  return {
    persistDraft: async (d: NewReaderAnnotation) => {
      log.push(`create:${d.id}`);
      return ok ? ann(d.id ?? "new") : null;
    },
    removeLocal: async (id: string) => {
      log.push(`remove:${id}`);
      return ok;
    },
    saveAnchor: async (a: ReaderAnnotation) => {
      log.push(`anchor:${a.id}`);
      return ok;
    },
  };
}

test("a failed delete leaves nothing to undo (23-01)", async () => {
  const get = mount(fakeWrites(false), [ann("a")]);
  await act(async () => {
    await get().removeLocal("a");
  });
  assert.equal(get().canUndo, false);
});

test("a failed move leaves nothing to undo (23-01)", async () => {
  const a = ann("a");
  const get = mount(fakeWrites(false), [a]);
  await act(async () => {
    await get().saveAnchor(a, a.anchor);
  });
  assert.equal(get().canUndo, false);
});

test("a delete that landed can be undone", async () => {
  const get = mount(fakeWrites(true), [ann("a")]);
  await act(async () => {
    await get().removeLocal("a");
  });
  assert.equal(get().canUndo, true);
});

test("a lasso delete is one undo step that brings every mark back (23-16)", async () => {
  const log: string[] = [];
  const get = mount(fakeWrites(true, log), [ann("a"), ann("b"), ann("c")]);
  await act(async () => {
    await get().removeMany(["a", "b", "c"]);
  });
  assert.deepEqual(log, ["remove:a", "remove:b", "remove:c"]);
  log.length = 0;
  await act(async () => {
    await get().undo();
  });
  assert.deepEqual(log.sort(), ["create:a", "create:b", "create:c"]);
  assert.equal(get().canUndo, false);
  assert.equal(get().canRedo, true);
});

test("a lasso delete records only the marks that were removed", async () => {
  const log: string[] = [];
  const writes = fakeWrites(true, log);
  writes.removeLocal = async (id) => {
    log.push(`remove:${id}`);
    return id !== "b";
  };
  const get = mount(writes, [ann("a"), ann("b")]);
  await act(async () => {
    await get().removeMany(["a", "b"]);
  });
  log.length = 0;
  await act(async () => {
    await get().undo();
  });
  assert.deepEqual(log, ["create:a"]);
});

test("a lasso delete where nothing landed leaves nothing to undo", async () => {
  const get = mount(fakeWrites(false), [ann("a"), ann("b")]);
  await act(async () => {
    await get().removeMany(["a", "b"]);
  });
  assert.equal(get().canUndo, false);
});

test("removeLocal reports failure and keeps its identity across selection changes (23-01, 23-02)", async () => {
  const seen: AnnotationActions[] = [];
  let rows: ReaderAnnotation[] = [ann("a")];
  const onAnnotationsChange = (next: ReaderAnnotation[] | ((p: ReaderAnnotation[]) => ReaderAnnotation[])) => {
    rows = typeof next === "function" ? next(rows) : next;
  };
  let selection: string | null = "a";
  const setSelectedAnnId = (u: string | null | ((p: string | null) => string | null)) => {
    selection = typeof u === "function" ? u(selection) : u;
  };
  function Probe({ selected }: { selected: string | null }) {
    void selected;
    seen.push(
      useAnnotationActions({
        paperId: "paper-1",
        onAnnotationsChange,
        onActivity: undefined,
        applyPin: () => {},
        setSelectedAnnId,
        clearPendingCreate: () => {},
      }),
    );
    return null;
  }
  let root: ReturnType<typeof create> | null = null;
  act(() => {
    root = create(createElement(Probe, { selected: null }));
  });
  act(() => {
    root!.update(createElement(Probe, { selected: "a" }));
  });
  assert.equal(seen[0]!.removeLocal, seen[seen.length - 1]!.removeLocal);
  // No container in a test: the write fails, rolls back and says so.
  let ok: boolean | undefined;
  await act(async () => {
    ok = await seen[seen.length - 1]!.removeLocal("a");
  });
  assert.equal(ok, false);
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
  // The deleted mark was selected: the selection clears.
  assert.equal(selection, null);
});