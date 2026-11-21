/**
 * A refused status save shows its error on the section page (P2-233). The
 * change ran as `void changeStatus(st)` with no catch, so a failed save was an
 * unhandled rejection and the page said nothing.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReportSection } from "@weaveforge/core";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { StatusSelect } from "@/components/status-select";
import { ProjectContext } from "@/features/projects/ui/project-provider";
import { SectionNote } from "../ui/section-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

before(async () => { await loadTestCore(); });
after(() => setContainerForTests(null));

const SECTION: ReportSection = { id: "s1", title: "Intro", status: "drafting", notes: "", sortOrder: 0, wordCount: 0, createdAt: "2026-01-01T00:00:00Z" };

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

test("a refused status save shows its error and rejects nothing (P2-233)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => { unhandled.push(err); };
  process.on("unhandledRejection", onUnhandled);
  setContainerForTests(stub({
    papers: { loadScreenData: async () => null },
    vault: { loadScreenData: async () => null },
    report: {
      loadScreenData: async () => null,
      manageReportSection: { setStatus: async () => { throw new Error("status not saved"); } },
    },
  }) as never);
  let r!: ReactTestRenderer;
  try {
    await act(async () => {
      const note = createElement(SectionNote, { section: SECTION, readOnly: true, onBack: () => undefined, onReplace: () => undefined, onChanged: () => undefined });
      const project = { projectId: "p1", projects: [], current: null, loading: false, setProject: () => undefined, refresh: async () => [] } as never;
      r = create(createElement(ProjectContext.Provider, { value: project }, note));
    });
    const select = r.root.findByType(StatusSelect);
    await act(async () => {
      (select.props.onChange as (s: string) => void)("review");
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
