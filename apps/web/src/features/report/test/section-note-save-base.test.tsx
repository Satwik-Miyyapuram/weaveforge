/**
 * The base a section save sends is the text the editor started from or last
 * saved, never fresh outside text the page reloaded while the editor still
 * holds the old one (REVIEW-B P1). Moving the base to the reloaded text made
 * the next save overwrite the outside edit without a conflict.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReportSection } from "@weaveforge/core";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { DocumentBody } from "@/components/document-body";
import { ProjectContext } from "@/features/projects";
import { SectionNote } from "../ui/section-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

const SECTION: ReportSection = { id: "s1", title: "Intro", status: "drafting", notes: "first", sortOrder: 0, wordCount: 0, createdAt: "2026-01-01T00:00:00Z" };
const PROJECT = { projectId: "p1", projects: [], current: null, loading: false, setProject: () => undefined, refresh: async () => [] } as never;

function stub(over: Record<string, unknown> = {}): unknown {
  return new Proxy(() => undefined, {
    get: (_t, key) => {
      if (key === "then") return undefined;
      const hit = over[key as string];
      if (typeof hit === "function") return hit;
      return stub((hit ?? {}) as Record<string, unknown>);
    },
    apply: () => Promise.resolve([]),
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function note(section: ReportSection, onChanged: () => void = () => undefined) {
  const el = createElement(SectionNote, { section, onBack: () => undefined, onReplace: () => undefined, onChanged });
  return createElement(ProjectContext.Provider, { value: PROJECT }, el);
}

async function setup(conflicts = 0) {
  const bases: string[] = [];
  let reloads = 0;
  let left = conflicts;
  setContainerForTests(stub({
    papers: { loadScreenData: async () => null },
    vault: { loadScreenData: async () => null },
    report: {
      loadScreenData: async () => null,
      uploadImage: async () => "",
      manageReportSection: {
        setNotes: async (id: string, notes: string, base: string) => {
          bases.push(base);
          if (left-- > 0) throw Object.assign(new Error("changed on disk; yours is in a copy"), { name: "ConflictError" });
          return { ...SECTION, id, notes };
        },
      },
    },
  }) as never);
  let r!: ReactTestRenderer;
  const onChanged = () => { reloads += 1; };
  await act(async () => { r = create(note(SECTION, onChanged)); await tick(); });
  const save = () => r.root.findByType(DocumentBody).props.onSave as (body: string) => Promise<void>;
  const editorKey = () => r.root.findByType(DocumentBody);
  return { r, bases, save, onChanged, editorKey, reloads: () => reloads };
}

test("a conflict reloads, then the base and the editor follow the text on disk", async () => {
  const { r, bases, save, onChanged, editorKey, reloads } = await setup(1);
  try {
    const before = editorKey();
    await act(async () => { await save()("first, mine"); });
    assert.equal(reloads(), 1, "the conflict asks for a reload");
    await act(async () => { r.update(note({ ...SECTION, notes: "outside edit" }, onChanged)); await tick(); });
    assert.notEqual(editorKey(), before, "the editor remounts on the reloaded text");
    await act(async () => { await save()("outside edit, mine"); });
    assert.deepEqual(bases, ["first", "outside edit"]);
  } finally {
    act(() => r.unmount());
    await tick();
  }
});

test("a reload with outside text does not move the base the editor's next save sends", async () => {
  const { r, bases, save } = await setup();
  try {
    // The page reloads the section after an outside edit; the editor still holds "first".
    await act(async () => { r.update(note({ ...SECTION, notes: "outside edit" })); await tick(); });
    await act(async () => { await save()("first, mine"); });
    assert.deepEqual(bases, ["first"]);
  } finally {
    act(() => r.unmount());
    await tick();
  }
});

test("the base after a save is what that save wrote", async () => {
  const { r, bases, save } = await setup();
  try {
    await act(async () => { await save()("one"); });
    await act(async () => { await save()("two"); });
    assert.deepEqual(bases, ["first", "one"]);
  } finally {
    act(() => r.unmount());
    await tick();
  }
});

test("another section resets the base to that section's text", async () => {
  const { r, bases, save } = await setup();
  try {
    await act(async () => { r.update(note({ ...SECTION, id: "s2", notes: "second" })); await tick(); });
    await act(async () => { await save()("second, mine"); });
    assert.deepEqual(bases, ["second"]);
  } finally {
    act(() => r.unmount());
    await tick();
  }
});
