/**
 * A refused reading-status save shows its error on the paper page (P2-192).
 * The change ran as `void changeStatus(st)` with no catch, so a failed save was
 * an unhandled rejection and the page said nothing.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { Paper } from "@weaveforge/core";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { StatusSelect } from "@/components/status-select";
import { ProjectContext } from "@/features/projects";
import { ProfileProvider } from "@/features/org";
import { AuthContext } from "@/features/auth";
import { PaperNote } from "../ui/paper-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// next/link prefetches through `self.requestIdleCallback`.
(globalThis as { self?: unknown }).self ??= globalThis;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

const PAPER = {
  id: "p1",
  title: "A paper",
  authors: [],
  status: "to_read",
  summary: "",
  tags: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
} as unknown as Paper;

/**
 * A container where `over` names the paths the test cares about and every
 * other path is a call that resolves to an empty list.
 */
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

function text(r: ReactTestRenderer): string {
  return JSON.stringify(r.toJSON());
}

test("a refused reading-status save shows its error and rejects nothing (P2-192)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => { unhandled.push(err); };
  process.on("unhandledRejection", onUnhandled);
  setContainerForTests(stub({
    papers: {
      loadScreenData: async () => null,
      isCitationTracking: async () => false,
      updatePaper: { setStatus: async () => { throw new Error("status not saved"); } },
    },
    vault: { loadScreenData: async () => null },
    report: { loadScreenData: async () => null },
  }) as never);
  const router = { push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined };
  const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      const note = createElement(PaperNote, { paper: PAPER, readOnly: true, onBack: () => undefined, onReplace: () => undefined, onChanged: () => undefined });
      const project = { projectId: "p1", projects: [], current: null, loading: false, setProject: () => undefined, refresh: async () => [] } as never;
      r = create(createElement(AppRouterContext.Provider, { value: router as never }, createElement(AuthContext.Provider, { value: auth }, createElement(ProfileProvider, null, createElement(ProjectContext.Provider, { value: project }, note)))));
    });
    const select = r.root.findAllByType(StatusSelect).find((s) => s.props.label === "Reading status");
    assert.ok(select, "no reading-status select");
    await act(async () => {
      (select.props.onChange as (s: string) => void)("reading");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.match(text(r), /status not saved/);
    assert.deepEqual(unhandled, []);
  } finally {
    act(() => r?.unmount());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a failed citation-tracking check leaves Watch usable and rejects nothing (P2-191)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => { unhandled.push(err); };
  process.on("unhandledRejection", onUnhandled);
  setContainerForTests(stub({
    papers: {
      loadScreenData: async () => null,
      isCitationTracking: async () => { throw new Error("tracking check failed"); },
    },
    vault: { loadScreenData: async () => null },
    report: { loadScreenData: async () => null },
  }) as never);
  const router = { push: () => undefined, replace: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined, prefetch: () => undefined };
  const auth = { user: null, loading: false, expired: false, sessionEpoch: 0, signOut: async () => {}, updatePassword: async () => {} } as never;
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      const note = createElement(PaperNote, { paper: { ...PAPER, doi: "10.1/x" } as Paper, readOnly: false, onBack: () => undefined, onReplace: () => undefined, onChanged: () => undefined });
      const project = { projectId: "p1", projects: [], current: null, loading: false, setProject: () => undefined, refresh: async () => [] } as never;
      r = create(createElement(AppRouterContext.Provider, { value: router as never }, createElement(AuthContext.Provider, { value: auth }, createElement(ProfileProvider, null, createElement(ProjectContext.Provider, { value: project }, note)))));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const watch = r.root.findAll((n) => n.type === "button" && n.props.title === "Track new citations");
    assert.equal(watch.length, 1, "no Watch button");
    assert.equal(watch[0]!.props.disabled, false, "Watch stayed disabled after the check failed");
    assert.deepEqual(unhandled, []);
  } finally {
    act(() => r?.unmount());
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);
  }
});