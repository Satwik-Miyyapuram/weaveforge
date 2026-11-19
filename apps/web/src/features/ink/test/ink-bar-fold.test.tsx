/**
 * The one toolbar folds instead of wrapping: as it narrows, controls shrink,
 * then move into More (a dot says so) or into Layout ▾, a stage at a time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FOLD_STAGES, FoldedItems, fitFold, foldMoves, foldedFind, parseFold, useToolbarFold, type FoldStage } from "../ui/ink-bar-fold";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A bar that needs `need` stages before it fits. */
const bar = (need: number) => {
  let applied: readonly FoldStage[] = [];
  const calls: string[] = [];
  const on = fitFold(
    (stages) => {
      applied = [...stages];
      calls.push(stages.join(" "));
    },
    () => applied.length < need,
  );
  return { on, applied, calls };
};

test("a bar that fits folds nothing, and the reset is applied first", () => {
  const { on, calls } = bar(0);
  assert.deepEqual(on, []);
  assert.deepEqual(calls, [""]);
});

test("stages go on in order, only as many as it takes", () => {
  const { on, applied } = bar(3);
  assert.deepEqual(on, ["zoom", "pages", "zoom-out"]);
  assert.deepEqual(applied, on);
});

test("a bar too narrow for everything ends with every stage on, Focus last", () => {
  const { on } = bar(99);
  assert.deepEqual(on, [...FOLD_STAGES]);
  assert.equal(on.at(-1), "focus");
});

test("the More dot shows only once something moved into More", () => {
  assert.equal(foldMoves([]), false);
  assert.equal(foldMoves(["zoom", "pages"]), false, "shrinking moves nothing");
  assert.equal(foldMoves(["zoom", "pages", "zoom-out"]), true);
  assert.equal(foldMoves(["layout", "colours"]), false, "Layout ▾ and the pen swatch are on the bar");
});

test("the fold reads back from the toolbar's attribute, ignoring junk", () => {
  assert.deepEqual(parseFold(null), []);
  assert.deepEqual(parseFold(""), []);
  assert.deepEqual(parseFold(" zoom  find bogus "), ["zoom", "find"]);
});

const props = {
  history: <span className="h">undo</span>,
  page: <span className="p">page</span>,
  zoom: <span className="z">zoom</span>,
  onFind: () => {},
  onInsert: () => {},
  onRecognise: () => {},
  choose: (run: () => void) => run,
};

test("More lists nothing moved while nothing is", () => {
  assert.equal(renderToStaticMarkup(<FoldedItems on={["zoom", "pages", "layout"]} {...props} />), "");
});

test("moved items sit at the top of More in a fixed order, Insert with a › submenu", () => {
  const html = renderToStaticMarkup(<FoldedItems on={[...FOLD_STAGES]} {...props} />);
  const at = (text: string) => html.indexOf(text);
  for (const text of ["Undo · Redo", "Page", "Zoom", "Find", "Insert", "Recognise handwriting"]) assert.ok(at(text) >= 0, text);
  assert.ok(at("Undo · Redo") < at(">Page<") && at(">Page<") < at(">Zoom<") && at(">Zoom<") < at(">Find<"));
  assert.ok(at(">Find<") < at(">Insert<") && at(">Insert<") < at("Recognise handwriting"));
  assert.match(html, /<kbd>(Ctrl\+F|⌘F)<\/kbd>/);
  assert.match(html, /class="card-menu-more menu-more"[^>]*>›</);
  assert.match(html, /<hr class="ink-menu-rule"/, "a rule parts the moved items from More's own");
});

test("a moved item the document cannot do is greyed, not gone", () => {
  const html = renderToStaticMarkup(
    <FoldedItems on={["find", "insert", "recognise"]} {...props} onFind={undefined} onInsert={undefined} onRecognise={undefined} />,
  );
  assert.equal(html.match(/disabled=""/g)?.length, 3);
});

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("every control the fold hides by its label still carries that label", () => {
  const css = source("../../../app/styles/editor-workspace.css");
  const rules = css.split("\n").filter((line) => line.includes("data-fold~="));
  const labels = [...rules.join("\n").matchAll(/aria-label(\^?)="([^"]+)"/g)].map((m) => ({ prefix: m[1] === "^", label: m[2] }));
  assert.deepEqual(
    labels.map((entry) => entry.label).sort(),
    ["Add a blank page", "Find in document", "Focus", "Preview", "Recognise", "Split", "Undo"],
  );
  const ui = [
    "../ui/ink-bar.tsx",
    "../ui/ink-bar-view.tsx",
    "../../reader/ui/reader-search-bar.tsx",
    "../../editor-workspace/ui/workspace-toolbar.tsx",
  ].map(source).join("\n");
  for (const { prefix, label } of labels) {
    const pattern = new RegExp(`label="${label}${prefix ? "" : '"'}`);
    assert.match(ui, pattern, label);
  }
});

/** A stand-in for the toolbar's DOM: More's menu, inside a toolbar holding `find`. */
const inToolbar = (find: { disabled: boolean; click: () => void } | null) => {
  const selectors: string[] = [];
  const from = {
    closest: (selector: string) =>
      selector.split(", ").includes(".workspace-toolbar")
        ? {
            querySelector: (query: string) => {
              selectors.push(query);
              return find;
            },
          }
        : null,
  } as unknown as Element;
  return { from, selectors };
};

test("Find in More clicks the toolbar's own Find, by its label", () => {
  let clicks = 0;
  const { from, selectors } = inToolbar({ disabled: false, click: () => (clicks += 1) });
  const run = foldedFind(from);
  assert.ok(run);
  run();
  assert.equal(clicks, 1);
  assert.deepEqual(selectors, ['button[aria-label="Find in document"]']);
});

test("Find in More is greyed while the toolbar's Find is disabled or missing", () => {
  // Ink's Find is a disabled placeholder, and the PDF's is disabled while its search is open.
  assert.equal(foldedFind(inToolbar({ disabled: true, click: () => {} }).from), undefined);
  assert.equal(foldedFind(inToolbar(null).from), undefined);
  assert.equal(foldedFind(null), undefined);
});

type Dataset = Record<string, string | undefined>;

/** A bar 100px wide; `scroll` says how wide its contents are at the fold it now has. */
function fakeBar(scroll: (dataset: Dataset) => number) {
  const dataset: Dataset = {};
  return {
    dataset,
    clientWidth: 100,
    get scrollWidth() {
      return scroll(dataset);
    },
    querySelector: () => null,
  };
}

const stages = (dataset: Dataset) => (dataset.fold ?? "").split(" ").filter(Boolean).length;

/** Observers that never fire, and no frames: the hook's first fit runs in the effect. */
function withBrowser(run: () => void) {
  const g = globalThis as Record<string, unknown>;
  const names = ["ResizeObserver", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"];
  const saved = names.map((name) => [name, g[name]] as const);
  class Idle {
    observe() {}
    disconnect() {}
  }
  Object.assign(g, { ResizeObserver: Idle, MutationObserver: Idle, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  try {
    run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete g[name];
      else g[name] = value;
    }
  }
}

/** A toolbar that mounts its bar only while `focus` is off, as DocumentToolbar does. */
function Probe({ focus }: { focus: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  useToolbarFold(bar, focus);
  return focus ? null : <div ref={bar} />;
}

test("a bar still too wide after every fold stage wraps rather than clips", () => {
  withBrowser(() => {
    const bar = fakeBar(() => 200);
    act(() => {
      create(<Probe focus={false} />, { createNodeMock: () => bar });
    });
    assert.equal(bar.dataset.fold, FOLD_STAGES.join(" "));
    assert.equal(bar.dataset.wrap, "");
  });
});

test("a bar that fits once folded does not wrap", () => {
  withBrowser(() => {
    const bar = fakeBar((dataset) => (stages(dataset) >= 2 ? 100 : 200));
    act(() => {
      create(<Probe focus={false} />, { createNodeMock: () => bar });
    });
    assert.equal(bar.dataset.fold, "zoom pages");
    assert.equal(bar.dataset.wrap, undefined);
  });
});

test("a remounted bar after a focus toggle is fitted again", () => {
  withBrowser(() => {
    const mounted: Dataset[] = [];
    const scroll = (dataset: Dataset) => (stages(dataset) >= 2 ? 100 : 200);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Probe focus={false} />, {
        createNodeMock: () => {
          const bar = fakeBar(scroll);
          mounted.push(bar.dataset);
          return bar;
        },
      });
    });
    act(() => {
      tree.update(<Probe focus />);
    });
    act(() => {
      tree.update(<Probe focus={false} />);
    });
    assert.equal(mounted.length, 2);
    assert.equal(mounted[1]!.fold, "zoom pages");
  });
});
