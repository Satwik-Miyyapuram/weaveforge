import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import TestRenderer, { act } from "react-test-renderer";
import { Install097Gate } from "../ui/install-097-gate";
import { INSTALL_097_WEB_NOTICE } from "../application/install-097-guard";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type RenderedJson = ReturnType<TestRenderer.ReactTestRenderer["toJSON"]>;

/** All rendered text under a node, concatenated. */
function textOf(node: RenderedJson): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  return (node.children ?? []).map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

test("browser with old 0.9.7 data and no export here: the browser port is asked and the gate shows", async () => {
  let portCalls = 0;
  const port = async () => {
    portCalls += 1;
    return {
      oldDataHere: async () => true,
      exportedHere: async () => false,
    };
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <Install097Gate webPort={port}>
        <p>APP</p>
      </Install097Gate>,
    );
    await flush();
  });
  assert.equal(portCalls, 1, "the port is asked once on the web");
  const text = textOf(renderer.toJSON());
  assert.ok(text.includes(INSTALL_097_WEB_NOTICE.title), "the Install 0.9.7 first notice shows");
  assert.ok(!text.includes("APP"), "children do not mount while the gate blocks");
  assert.ok(!text.includes("Choose the folder"), "no folder picker on the web");
});

test("browser with no old data: the port is asked and the app opens", async () => {
  let portCalls = 0;
  const port = async () => {
    portCalls += 1;
    return { oldDataHere: async () => false, exportedHere: async () => false };
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <Install097Gate webPort={port}>
        <p>APP</p>
      </Install097Gate>,
    );
    await flush();
  });
  assert.equal(portCalls, 1);
  assert.ok(textOf(renderer.toJSON()).includes("APP"));
});

test("no browser reader (port returns null): the app opens", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <Install097Gate webPort={async () => null}>
        <p>APP</p>
      </Install097Gate>,
    );
    await flush();
  });
  assert.ok(textOf(renderer.toJSON()).includes("APP"));
});

test("the browser reader rejects (no OPFS): the app opens (fail open)", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <Install097Gate
        webPort={async () => {
          throw new Error("no OPFS");
        }}
      >
        <p>APP</p>
      </Install097Gate>,
    );
    await flush();
  });
  assert.ok(textOf(renderer.toJSON()).includes("APP"));
});