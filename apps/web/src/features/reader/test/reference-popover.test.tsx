import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { Paper } from "@weaveforge/core";
import type { ResolvedReference } from "../application/reference-lookup";
import { ReferencePopover, type ReferencePopoverProps } from "../ui/reference-popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = {
  index: 12,
  label: "[12]",
  raw: "Vaswani et al. Attention is all you need. NeurIPS, 2017.",
  page: 9,
  x: 40,
  y: 600,
  authors: ["Vaswani"],
  year: 2017,
  title: "Attention is all you need",
};

const resolved: ResolvedReference = {
  status: "resolved",
  sourceId: "semantic-scholar",
  metadata: { title: "Attention is all you need", authors: ["Vaswani"], year: 2017, venue: "NeurIPS" },
};

function noop(): void {}

function renderPopover(overrides: Partial<ReferencePopoverProps> = {}): string {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      createElement(ReferencePopover, {
        entry,
        resolution: resolved,
        onClose: noop,
        onAddToLibrary: noop,
        onOpenInReader: noop,
        onLinkPapers: noop,
        onCite: noop,
        onAddManually: noop,
        onJumpToEntry: noop,
        ...overrides,
      }),
    );
  });
  // Read the tree after `act` has flushed — inside the callback the render has
  // not committed and `toJSON()` is null.
  const text = JSON.stringify(renderer!.toJSON());
  act(() => renderer!.unmount());
  return text;
}

test("State A: resolved but not in library offers one add action and copying the citation", () => {
  const text = renderPopover();
  assert.match(text, /Attention is all you need/);
  assert.match(text, /Add to library/);
  assert.match(text, /Copy citation/);
  // "Read later" was the same add with another status; one button is enough.
  assert.doesNotMatch(text, /Read later/);
  // Library-only affordances must not appear before the paper is in the library.
  assert.doesNotMatch(text, /In library/);
  assert.doesNotMatch(text, /Open in reader/);
});

test("one outside link: the DOI when known, else the Semantic Scholar record, else a Scholar search", () => {
  const links = (text: string) => text.match(/https?:\/\/[^"]+/g) ?? [];
  const withDoi = renderPopover({ resolution: { ...resolved, metadata: { ...resolved.metadata, doi: "10.1/x" } } });
  assert.deepEqual(links(withDoi), ["https://doi.org/10.1%2Fx"]);
  const s2 = "https://www.semanticscholar.org/paper/abc";
  assert.deepEqual(links(renderPopover({ resolution: { ...resolved, metadata: { ...resolved.metadata, url: s2 } } })), [s2]);
  // Only the host counts: a URL that merely mentions the site is not its record.
  const spoof = "https://evil.example/?semanticscholar.org";
  assert.match(links(renderPopover({ resolution: { ...resolved, metadata: { ...resolved.metadata, url: spoof } } }))[0]!, /scholar\.google\.com/);
  const fallback = links(renderPopover());
  assert.equal(fallback.length, 1);
  assert.match(fallback[0]!, /scholar\.google\.com\/scholar\?q=/);
});

test("State B: in-library papers expose open and link actions instead of add actions", () => {
  const paper = { id: "p1", status: "reading" } as Paper;
  const text = renderPopover({ resolution: { ...resolved, inLibrary: paper } });
  assert.match(text, /In library/);
  assert.match(text, /Open in reader/);
  assert.match(text, /Link papers/);
  assert.doesNotMatch(text, /Read later/);
  assert.doesNotMatch(text, /Add to library/);
});

test("State B: an existing cites relation hides Link papers", () => {
  const paper = { id: "p1", status: "reading" } as Paper;
  const text = renderPopover({ resolution: { ...resolved, inLibrary: paper }, alreadyLinked: true });
  assert.doesNotMatch(text, /Link papers/);
  assert.match(text, /Copy citation/);
});

test("State C: unresolved entries offer Scholar and manual add, never an empty popover", () => {
  const text = renderPopover({ resolution: { status: "unresolved" } });
  assert.match(text, /No match found/);
  assert.match(text, /scholar\.google\.com\/scholar\?q=/);
  assert.match(text, /Add manually/);
  assert.match(text, /Go to reference/);
});

test("Pending: the document's own entry shows at once while the lookup runs", () => {
  const text = renderPopover({ resolution: { status: "pending" } });
  assert.match(text, /pdf-reader-ref-skeleton/);
  assert.match(text, /Attention is all you need/);
  assert.match(text, /scholar\.google\.com\/scholar\?q=/);
  assert.match(text, /Go to reference/);
});
