import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMermaidCache,
  mermaidCacheSize,
  renderMermaidBlock,
  setMermaidLoaderForTests,
  type MermaidModule,
} from "../mermaid-render";

/** A fake renderer that counts calls and echoes the id it was given. */
function fakeRenderer(): { renderer: MermaidModule; calls: () => number } {
  let calls = 0;
  const renderer = {
    renderAsync: async (_source: string, options?: { idPrefix?: string }) => {
      calls++;
      return { svg: `<svg>${options?.idPrefix}</svg>` };
    },
  } as unknown as MermaidModule;
  return { renderer, calls: () => calls };
}

/** Run `body` with a stub document and a renderer, restoring both afterwards. */
async function withRenderer(renderer: MermaidModule | null, body: () => Promise<void>): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  try {
    g.document = {};
    setMermaidLoaderForTests(renderer ? () => Promise.resolve(renderer) : null);
    await body();
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
}

test("two renders of the same code render once and return identical strings", async () => {
  const fake = fakeRenderer();
  await withRenderer(fake.renderer, async () => {
    const first = await renderMermaidBlock("graph TD; A-->B");
    const second = await renderMermaidBlock("graph TD; A-->B");
    assert.equal(fake.calls(), 1);
    assert.equal(first, second);
    assert.ok(first.includes("<svg>wf-mermaid-"));
  });
});

test("a render that throws returns error html and is not cached", async () => {
  const renderer = {
    renderAsync: async () => {
      throw new Error("diagram syntax error");
    },
  } as unknown as MermaidModule;
  await withRenderer(renderer, async () => {
    const html = await renderMermaidBlock("bad diagram");
    assert.ok(html.includes("md-mermaid-error"));
    assert.ok(html.includes("diagram syntax error"));
    assert.equal(mermaidCacheSize(), 0);
  });
});

test("40 distinct sources: cache size stays 32, oldest is re-rendered, recently hit one is not", async () => {
  const fake = fakeRenderer();
  await withRenderer(fake.renderer, async () => {
    for (let i = 1; i <= 32; i++) await renderMermaidBlock(`graph TD; node${i}`);
    assert.equal(fake.calls(), 32);
    assert.equal(mermaidCacheSize(), 32);

    await renderMermaidBlock("graph TD; node1");
    assert.equal(fake.calls(), 32);

    for (let i = 33; i <= 40; i++) await renderMermaidBlock(`graph TD; node${i}`);
    assert.equal(fake.calls(), 40);
    assert.equal(mermaidCacheSize(), 32);

    await renderMermaidBlock("graph TD; node2");
    assert.equal(fake.calls(), 41);

    await renderMermaidBlock("graph TD; node1");
    assert.equal(fake.calls(), 41);
    assert.equal(mermaidCacheSize(), 32);
  });
});

test("the real renderer draws a flowchart whose colours follow the theme's CSS variables", async () => {
  await withRenderer(null, async () => {
    const html = await renderMermaidBlock("graph TD\n  A[Start] --> B[End]");
    assert.ok(!html.includes("md-mermaid-error"), html);
    assert.ok(html.startsWith('<div class="md-mermaid">'));
    assert.ok(html.includes("<svg"));
    assert.ok(html.includes("Start") && html.includes("End"));
    // Colours are variables, so a light/dark switch needs no re-render.
    assert.ok(html.includes("var(--pele-bg"));
  });
});

test("the real renderer accepts a label with parentheses and a pipe", async () => {
  await withRenderer(null, async () => {
    const html = await renderMermaidBlock("graph LR\n  X --> Q[q(z|x)]");
    assert.ok(!html.includes("md-mermaid-error"), html);
    assert.ok(html.includes("q(z|x)"));
  });
});

test("the real renderer reports a parse error with its line", async () => {
  await withRenderer(null, async () => {
    const html = await renderMermaidBlock("graph TD\n  A -->");
    assert.ok(html.includes("md-mermaid-error"));
    assert.ok(/line \d/i.test(html), html);
  });
});

test("a failed load is retried on the next diagram, not kept (11-05)", async () => {
  const fake = fakeRenderer();
  let loads = 0;
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  try {
    g.document = {};
    setMermaidLoaderForTests(() => {
      loads++;
      return loads === 1 ? Promise.reject(new Error("chunk load failed")) : Promise.resolve(fake.renderer);
    });
    const failed = await renderMermaidBlock("graph TD; A-->B");
    assert.ok(failed.includes("md-mermaid-error"));
    const drawn = await renderMermaidBlock("graph TD; A-->B");
    assert.ok(drawn.includes("<svg>wf-mermaid-"), "the second diagram loads again");
    assert.equal(loads, 2);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});
