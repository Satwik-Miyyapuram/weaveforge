/**
 * The result note saves against the text the draft opened with (REVIEW-B P1).
 * A running experiment reloads every few seconds; passing the reloaded
 * `exp.resultNote` as the base let a save overwrite an outside edit made while
 * the draft was open.
 */
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { Experiment } from "@weaveforge/core";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ProjectContext } from "@/features/projects";
import { ProfileProvider } from "@/features/org";
import { AuthContext } from "@/features/auth";
import Module from "node:module";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { self?: unknown }).self ??= globalThis;
// The loading spinner rotates its tips on window timers.
(globalThis as { window?: unknown }).window ??= globalThis;

// The metric chart imports uPlot's stylesheet, which node cannot load; it plays no part here.
(Module as unknown as { _extensions: Record<string, () => void> })._extensions[".css"] = () => undefined;
let ExperimentDetailScreen: typeof import("../ui/experiment-detail-screen").ExperimentDetailScreen;

before(async () => {
  await loadTestCore();
  ({ ExperimentDetailScreen } = await import("../ui/experiment-detail-screen"));
});
after(() => setContainerForTests(null));

const EXP = {
  id: "e1",
  name: "Run",
  status: "running",
  resultNote: "opened text",
  config: {},
  metrics: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Experiment;

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

function screen() {
  const el = createElement(ExperimentDetailScreen, { id: "e1" });
  return createElement(AppRouterContext.Provider, { value: router as never }, createElement(AuthContext.Provider, { value: auth }, createElement(ProfileProvider, null, createElement(ProjectContext.Provider, { value: project }, el))));
}

function byText(r: ReactTestRenderer, text: string) {
  return r.root.find((n) => typeof n.type === "string" && n.type === "button" && n.children.join("").includes(text));
}

const resultBox = (r: ReactTestRenderer) =>
  r.root.find((n) => n.type === "textarea" && String(n.props.placeholder ?? "").startsWith("What came out"));

test("saving the result sends the text the draft opened with, not a reloaded one", async () => {
  let current = EXP;
  const bases: string[] = [];
  setContainerForTests(stub({
    experiments: {
      getExperiment: async () => current,
      manageExperiment: {
        setResultNote: async (_id: string, note: string, base: string) => {
          bases.push(base);
          return { ...current, resultNote: note };
        },
      },
    },
  }) as never);
  let r!: ReactTestRenderer;
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    await act(async () => { r = create(screen()); await tick(); });
    await act(async () => { byText(r, "Edit").props.onClick(); await tick(); });
    // An outside edit lands and the screen reloads it while the draft is open.
    current = { ...EXP, resultNote: "outside edit" };
    await act(async () => { mock.timers.tick(5000); await tick(); });
    assert.equal(resultBox(r).props.value, "opened text", "the poll does not reset the open draft");
    const area = resultBox(r);
    await act(async () => { area.props.onChange({ target: { value: "mine" } }); await tick(); });
    await act(async () => { byText(r, "Save result").props.onClick(); await tick(); });
    assert.deepEqual(bases, ["opened text"]);
  } finally {
    mock.timers.reset();
    act(() => r?.unmount());
    await tick();
  }
});
