/**
 * An ink note read as its sheet, or open in the ink editor, shows `[[links]]`
 * as links, like any note's Read view, and its typed text is not hidden under
 * a placed figure (design D19, DA-101).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkPageStatic } from "../ui/ink-page-static";
import { InkRail, type InkRailProps } from "../ui/ink-rail";
import { InkSheetTextUnderlay } from "../ui/ink-sheet-underlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function underlayHtml(props: Parameters<typeof InkSheetTextUnderlay>[0]): string {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(InkSheetTextUnderlay, props));
  });
  const html = (tree.root.findByType("div").props.dangerouslySetInnerHTML as { __html: string }).__html;
  act(() => tree.unmount());
  return html;
}

/** Observers that never fire: node has none, and the rail watches its size. */
function withObservers<T>(run: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const names = ["ResizeObserver", "MutationObserver"];
  const saved = names.map((name) => [name, g[name]] as const);
  class Idle {
    observe() {}
    disconnect() {}
  }
  Object.assign(g, { ResizeObserver: Idle, MutationObserver: Idle });
  try {
    return run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete g[name];
      else g[name] = value;
    }
  }
}

test("a wikilink on the sheet renders as a link, not its brackets", () => {
  const html = underlayHtml({
    text: "See [[Cluster cheat-sheet]]",
    scale: 1,
    resolveWikilink: () => ({ href: "/notes?page=n1", unresolved: false }),
  });
  assert.match(html, /<a class="wikilink" href="\/notes\?page=n1" data-wikilink="1">Cluster cheat-sheet<\/a>/);
  assert.doesNotMatch(html, /\[\[/);
});

test("a link on the read sheet carries its href and can be clicked", () => {
  const onWikilinkClick = () => {};
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(InkPageStatic, {
        index: 0,
        pageSize: { width: 100, height: 100 },
        scale: 1,
        paper: "plain",
        pureText: "See [[Cluster cheat-sheet]]",
        resolveWikilink: () => ({ href: "/notes?page=n1", unresolved: false }),
        onWikilinkClick,
      }),
      { createNodeMock: () => ({ closest: () => null, querySelector: () => null, getContext: () => null }) },
    );
  });
  const sheet = tree.root.findByType(InkSheetTextUnderlay).findByType("div");
  const html = (sheet.props.dangerouslySetInnerHTML as { __html: string }).__html;
  const className = sheet.props.className as string;
  const onClick: unknown = sheet.props.onClick;
  act(() => tree.unmount());
  assert.match(html, /<a class="wikilink" href="\/notes\?page=n1" data-wikilink="1">Cluster cheat-sheet<\/a>/);
  assert.equal(onClick, onWikilinkClick, "the click follows the link");
  // The sheet stays click-through; only its links take the pointer.
  assert.match(className, /\bink-links-live\b/);
  assert.match(src("../../../app/styles/editor-workspace.css"), /\.ink-sheet-text-underlay\.ink-links-live a\[href\] \{ pointer-events: auto; \}/);
});

test("the read sheet resolves and follows links against the note catalogue", () => {
  const reader = src("../ui/ink-reader.tsx");
  assert.match(reader, /\{ resolveWikilink, onWikilinkClick \} = useWikilinkNavigation\(/);
  const page = reader.slice(reader.indexOf("<InkPageStatic"));
  const props = page.slice(0, page.indexOf("/>"));
  assert.match(props, /resolveWikilink=\{resolveWikilink\}/);
  assert.match(props, /onWikilinkClick=\{onWikilinkClick\}/);
});

test("the editor's neighbouring pages show a wikilink as a link", () => {
  const props: InkRailProps = {
    children: null,
    scrollRef: { current: null },
    pageIndex: 0,
    pageCount: 2,
    pageSize: { width: 2100, height: 2970 },
    scale: 0.5,
    paper: "plain",
    pages: null,
    ghosts: new Map(),
    flowedText: ["", "See [[Cluster cheat-sheet]]"],
    resolveWikilink: () => ({ href: "/notes?page=n1", unresolved: false }),
  };
  // A bare stand-in for the DOM the rail's layout effects touch.
  const createNodeMock = () => ({
    closest: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  });
  const sheets = withObservers(() => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement(InkRail, props), { createNodeMock });
    });
    const out = tree.root
      .findAll((n) => n.type === "div" && n.props.dangerouslySetInnerHTML != null)
      .map((n) => ({
        html: (n.props.dangerouslySetInnerHTML as { __html: string }).__html,
        className: n.props.className as string,
      }));
    act(() => tree.unmount());
    return out;
  });
  const html = sheets.map((s) => s.html).join("");
  assert.match(html, /<a class="wikilink" href="\/notes\?page=n1" data-wikilink="1">Cluster cheat-sheet<\/a>/);
  assert.doesNotMatch(html, /\[\[/);
  // While editing the pen owns the sheet: its links take no clicks.
  for (const s of sheets) assert.doesNotMatch(s.className, /ink-links-live/);
});

test("the editor's live page resolves links against the note catalogue", () => {
  const host = src("../ui/ink-host.tsx");
  assert.match(host, /useWikilinkNavigation\(/);
  const underlay = host.slice(host.indexOf("<InkSheetTextUnderlay"));
  assert.match(underlay.slice(0, underlay.indexOf("/>")), /resolveWikilink=\{resolveWikilink\}/);
  const rail = host.slice(host.indexOf("<InkRail"));
  assert.match(rail.slice(0, rail.indexOf(">\n")), /resolveWikilink=\{resolveWikilink\}/);
});

test("typed text paints above a placed figure, on the read sheet and the editor", () => {
  for (const file of ["../ui/ink-page-static.tsx", "../ui/ink-host.tsx"]) {
    const s = src(file);
    const figures = s.indexOf("<InkFigures");
    const text = s.indexOf("<InkSheetTextUnderlay");
    assert.ok(figures > 0 && text > figures, `${file}: text is drawn under the figures`);
  }
});
