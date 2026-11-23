/**
 * A paper's summary saves against the text the editor opened with or last
 * saved (REVIEW-B P1). Without a base, a save after an outside edit wrote the
 * editor's older text over that edit with no conflict.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { Paper } from "@weaveforge/core";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { DocumentBody } from "@/components/document-body";
import { ProjectContext } from "@/features/projects";
import { ProfileProvider } from "@/features/org";
import { AuthContext } from "@/features/auth";
import { PaperNote } from "../ui/paper-note";
import { TagEditor } from "../ui/tag-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { self?: unknown }).self ??= globalThis;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

const PAPER = {
  id: "p1",
  title: "A paper",
  authors: [],
  status: "to_read",
  summary: "first #ml",
  tags: ["ml"],
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
} as unknown as Paper;

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
const router = { push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined };
const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
const project = { projectId: "p1", projects: [], current: null, loading: false, setProject: () => undefined, refresh: async () => [] } as never;

function note(paper: Paper, onChanged: () => void) {
  const el = createElement(PaperNote, { paper, onBack: () => undefined, onReplace: () => undefined, onChanged });
  return createElement(AppRouterContext.Provider, { value: router as never }, createElement(AuthContext.Provider, { value: auth }, createElement(ProfileProvider, null, createElement(ProjectContext.Provider, { value: project }, el))));
}

async function setup(conflicts = 0) {
  const bases: (string | undefined)[] = [];
  let reloads = 0;
  let left = conflicts;
  setContainerForTests(stub({
    papers: {
      loadScreenData: async () => null,
      isCitationTracking: async () => false,
      uploadImage: async () => "",
      updatePaper: {
        setSummary: async (id: string, summary: string, base?: string) => {
          bases.push(base);
          if (left-- > 0) throw Object.assign(new Error("changed on disk"), { name: "ConflictError" });
          return { ...PAPER, id, summary };
        },
      },
    },
    vault: { loadScreenData: async () => null },
    report: { loadScreenData: async () => null },
  }) as never);
  const onChanged = () => { reloads += 1; };
  let r!: ReactTestRenderer;
  await act(async () => { r = create(note(PAPER, onChanged)); await tick(); });
  const save = () => r.root.findByType(DocumentBody).props.onSave as (body: string) => Promise<void>;
  return { r, bases, save, onChanged, reloads: () => reloads };
}

async function close(r: ReactTestRenderer) {
  act(() => r.unmount());
  await tick();
}

test("a reload with an outside summary does not move the base the editor's next save sends", async () => {
  const { r, bases, save, onChanged } = await setup();
  try {
    await act(async () => { r.update(note({ ...PAPER, summary: "outside edit" }, onChanged)); await tick(); });
    await act(async () => { await save()("first #ml, mine"); });
    await act(async () => { await save()("first #ml, mine 2"); });
    assert.deepEqual(bases, ["first #ml", "first #ml, mine"]);
  } finally {
    await close(r);
  }
});

test("a conflict reloads, then the base and the editor follow the summary on disk", async () => {
  const { r, bases, save, onChanged, reloads } = await setup(1);
  try {
    const before = r.root.findByType(DocumentBody);
    await act(async () => { await save()("first, mine"); });
    assert.equal(reloads(), 1, "the conflict asks for a reload");
    await act(async () => { r.update(note({ ...PAPER, summary: "outside edit" }, onChanged)); await tick(); });
    assert.notEqual(r.root.findByType(DocumentBody), before, "the editor remounts on the reloaded text");
    await act(async () => { await save()("outside edit, mine"); });
    assert.deepEqual(bases, ["first #ml", "outside edit"]);
  } finally {
    await close(r);
  }
});

test("a live reload, then a conflict whose reload brings no new text: the editor remounts and the next save goes through", async () => {
  const { r, bases, save, onChanged, reloads } = await setup(1);
  try {
    await act(async () => { r.update(note({ ...PAPER, summary: "outside edit" }, onChanged)); await tick(); });
    const before = r.root.findByType(DocumentBody);
    await act(async () => { await save()("first #ml, mine").catch(() => undefined); });
    assert.equal(reloads(), 1, "the conflict asks for a reload");
    assert.notEqual(r.root.findByType(DocumentBody), before, "the editor remounts on the summary on disk anyway");
    await act(async () => { await save()("outside edit, mine"); });
    assert.deepEqual(bases, ["first #ml", "outside edit"], "the next save is based on the summary on disk");
  } finally {
    await close(r);
  }
});

test("a conflict calls onConflict, not onChanged, when the page gives one", async () => {
  const { r, save } = await setup(1);
  let changed = 0;
  let conflicts = 0;
  try {
    const el = createElement(PaperNote, { paper: PAPER, onBack: () => undefined, onReplace: () => undefined, onChanged: () => { changed += 1; }, onConflict: () => { conflicts += 1; } });
    await act(async () => { r.update(createElement(AppRouterContext.Provider, { value: router as never }, createElement(AuthContext.Provider, { value: auth }, createElement(ProfileProvider, null, createElement(ProjectContext.Provider, { value: project }, el))))); await tick(); });
    await act(async () => { await save()("first, mine").catch(() => undefined); });
    assert.deepEqual({ changed, conflicts }, { changed: 0, conflicts: 1 });
  } finally {
    await close(r);
  }
});

test("removing a tag chip saves with the same base chain as the editor", async () => {
  const { r, bases, save } = await setup();
  try {
    const chips = r.root.findByType(TagEditor);
    await act(async () => { await (chips.props.saveSummary as (b: string) => Promise<Paper>)("first"); });
    await act(async () => { await save()("first, mine"); });
    assert.deepEqual(bases, ["first #ml", "first"]);
  } finally {
    await close(r);
  }
});
