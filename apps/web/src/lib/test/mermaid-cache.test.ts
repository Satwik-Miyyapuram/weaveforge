import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMermaidCache,
  mermaidCacheSize,
  renderMermaidBlock,
  setMermaidLoaderForTests,
  type MermaidModule,
} from "../mermaid-render";

test("two renders of the same code and mode call render once and return identical strings", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  let renderCalls = 0;
  const fakeMermaid = {
    render: async (id: string) => {
      renderCalls++;
      return { svg: `<svg>${id}</svg>` };
    },
    initialize: () => {},
  } as unknown as MermaidModule;

  try {
    g.document = { fonts: { status: "loaded" } };
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
    const code = "graph TD; A-->B";
    const first = await renderMermaidBlock(code, "light");
    const second = await renderMermaidBlock(code, "light");
    assert.equal(renderCalls, 1);
    assert.equal(first, second);
    assert.ok(first.includes("<svg>wf-mermaid-"));
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});

test("different mode renders again", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  let renderCalls = 0;
  const fakeMermaid = {
    render: async (id: string) => {
      renderCalls++;
      return { svg: `<svg>${id}</svg>` };
    },
    initialize: () => {},
  } as unknown as MermaidModule;

  try {
    g.document = { fonts: { status: "loaded" } };
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
    const code = "graph TD; A-->B";
    await renderMermaidBlock(code, "light");
    assert.equal(renderCalls, 1);
    await renderMermaidBlock(code, "dark");
    assert.equal(renderCalls, 2);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});

test("fonts status loading is not cached (render called each time)", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  let renderCalls = 0;
  const fakeMermaid = {
    render: async (id: string) => {
      renderCalls++;
      return { svg: `<svg>${id}</svg>` };
    },
    initialize: () => {},
  } as unknown as MermaidModule;

  try {
    g.document = { fonts: { status: "loading" } };
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
    const code = "graph TD; A-->B";
    await renderMermaidBlock(code, "light");
    assert.equal(renderCalls, 1);
    assert.equal(mermaidCacheSize(), 0);
    await renderMermaidBlock(code, "light");
    assert.equal(renderCalls, 2);
    assert.equal(mermaidCacheSize(), 0);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});

test("a render that throws returns error html and is not cached", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  let renderCalls = 0;
  const fakeMermaid = {
    render: async () => {
      renderCalls++;
      throw new Error("diagram syntax error");
    },
    initialize: () => {},
  } as unknown as MermaidModule;

  try {
    g.document = { fonts: { status: "loaded" } };
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
    const code = "bad diagram";
    const html = await renderMermaidBlock(code, "light");
    assert.equal(renderCalls, 1);
    assert.ok(html.includes("md-mermaid-error"));
    assert.ok(html.includes("diagram syntax error"));
    assert.equal(mermaidCacheSize(), 0);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});

test("40 distinct sources: cache size stays 32, oldest is re-rendered, recently hit one is not", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedDoc = g.document;
  let renderCalls = 0;
  const fakeMermaid = {
    render: async (id: string) => {
      renderCalls++;
      return { svg: `<svg>${id}</svg>` };
    },
    initialize: () => {},
  } as unknown as MermaidModule;

  try {
    g.document = { fonts: { status: "loaded" } };
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));

    for (let i = 1; i <= 32; i++) {
      await renderMermaidBlock(`graph TD; node${i}`, "light");
    }
    assert.equal(renderCalls, 32);
    assert.equal(mermaidCacheSize(), 32);

    await renderMermaidBlock("graph TD; node1", "light");
    assert.equal(renderCalls, 32);

    for (let i = 33; i <= 40; i++) {
      await renderMermaidBlock(`graph TD; node${i}`, "light");
    }
    assert.equal(renderCalls, 40);
    assert.equal(mermaidCacheSize(), 32);

    await renderMermaidBlock("graph TD; node2", "light");
    assert.equal(renderCalls, 41);

    await renderMermaidBlock("graph TD; node1", "light");
    assert.equal(renderCalls, 41);
    assert.equal(mermaidCacheSize(), 32);
  } finally {
    g.document = savedDoc;
    setMermaidLoaderForTests(null);
    clearMermaidCache();
  }
});
