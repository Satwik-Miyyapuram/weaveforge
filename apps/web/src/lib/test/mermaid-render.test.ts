/**
 * The SVG pele builds from note text goes through the sanitizer before it is
 * cached or returned, since `upgradeMermaidFences` assigns it to innerHTML
 * (P2-256). Node has no DOM for DOMPurify, so the test stands in a sanitizer
 * and checks that every path out of `renderMermaidBlock` went through it.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  clearMermaidCache,
  renderMermaidBlock,
  setMermaidLoaderForTests,
  setSvgSanitizerForTests,
  type MermaidModule,
} from "../mermaid-render";

before(loadTestCore);

const HOSTILE = [
  '<img src="x" onerror="alert(1)">',
  "<script>alert(2)</script>",
  '<a href="javascript:alert(3)"><text>go</text></a>',
];

test("a diagram's SVG is sanitized before it is returned or cached (P2-256)", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  const seen: string[] = [];
  let renders = 0;
  try {
    g.document = {};
    setMermaidLoaderForTests(async () => ({
      renderAsync: async () => {
        renders += 1;
        return { svg: `<svg>${HOSTILE.join("")}</svg>` };
      },
    }) as unknown as MermaidModule);
    setSvgSanitizerForTests((svg) => {
      seen.push(svg);
      return "<svg>clean</svg>";
    });
    const first = await renderMermaidBlock("graph TD; A-->B");
    const second = await renderMermaidBlock("graph TD; A-->B");
    assert.equal(seen.length, 1, "the render went through the sanitizer");
    for (const bad of HOSTILE) assert.ok(seen[0]!.includes(bad), "the sanitizer saw the raw SVG");
    assert.equal(first, '<div class="md-mermaid"><svg>clean</svg></div>');
    assert.equal(second, first, "the cache holds the sanitized markup");
    assert.equal(renders, 1);
    for (const bad of [...HOSTILE, "onerror", "javascript:", "<script"]) assert.ok(!first.includes(bad), bad);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    setSvgSanitizerForTests(null);
    clearMermaidCache();
  }
});
