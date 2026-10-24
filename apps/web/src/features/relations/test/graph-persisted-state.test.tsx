/**
 * The graph's saved settings are never overwritten by a failed load (26-01),
 * and an edit made just before leaving is still saved, to the project it was
 * made in (26-02).
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { GraphPersistedState } from "@weaveforge/core";

import { useGraphPersistedState, type GraphSettingsStore } from "../application/use-graph-persisted-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handle = ReturnType<typeof useGraphPersistedState>;

/** A store that records saves and can fail its load. */
function store(opts: { failLoad?: boolean } = {}) {
  const saves: { projectId: string; state: GraphPersistedState }[] = [];
  const graph: GraphSettingsStore = {
    getSettings: async () => {
      if (opts.failLoad) throw new Error("network down");
      return null;
    },
    saveSettings: async (projectId, state) => void saves.push({ projectId, state }),
  };
  return { graph, saves };
}

const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
});

let nextProject = 0;
/** A project id no earlier test used, since the hook caches state per project. */
const freshProject = () => `p-${process.pid}-${++nextProject}`;

function mount(graph: GraphSettingsStore, projectId: string) {
  let handle: Handle | null = null;
  function Probe({ id }: { id: string }) {
    handle = useGraphPersistedState(id, graph);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Probe, { id: projectId }));
  });
  mounted.push(renderer);
  return {
    handle: () => handle!,
    switchTo: (id: string) => act(() => renderer.update(createElement(Probe, { id }))),
    unmount: () => {
      mounted.splice(mounted.indexOf(renderer), 1);
      act(() => renderer.unmount());
    },
  };
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

test("a load that fails never saves over the stored settings (26-01)", async () => {
  const { graph, saves } = store({ failLoad: true });
  const view = mount(graph, freshProject());
  await wait(10);
  assert.match(view.handle().error ?? "", /network down/);
  act(() => view.handle().setLocalDepth(3));
  await wait(700);
  view.unmount();
  assert.deepEqual(saves, []);
});

test("a load that succeeds saves an edit after the debounce", async () => {
  const { graph, saves } = store();
  const project = freshProject();
  const view = mount(graph, project);
  await wait(10);
  act(() => view.handle().setLocalDepth(3));
  await wait(700);
  assert.equal(saves.length, 1);
  assert.equal(saves[0]!.projectId, project);
  assert.equal(saves[0]!.state.localDepth, 3);
  view.unmount();
  assert.equal(saves.length, 1, "nothing left to flush once saved");
});

test("an edit made just before unmount is still saved (26-02)", async () => {
  const { graph, saves } = store();
  const project = freshProject();
  const view = mount(graph, project);
  await wait(10);
  act(() => view.handle().setLocalDepth(4));
  view.unmount();
  await wait(10);
  assert.deepEqual(
    saves.map((s) => [s.projectId, s.state.localDepth]),
    [[project, 4]],
  );
});

test("an edit made just before a project switch is saved to the old project (26-02)", async () => {
  const { graph, saves } = store();
  const first = freshProject();
  const second = freshProject();
  const view = mount(graph, first);
  await wait(10);
  act(() => view.handle().setLocalDepth(5));
  view.switchTo(second);
  await wait(700);
  assert.deepEqual(
    saves.map((s) => [s.projectId, s.state.localDepth]),
    [[first, 5]],
  );
});

test("no edit, no save on unmount", async () => {
  const { graph, saves } = store();
  const view = mount(graph, freshProject());
  await wait(10);
  view.unmount();
  await wait(10);
  assert.deepEqual(saves, []);
});
