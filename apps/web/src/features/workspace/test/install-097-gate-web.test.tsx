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

test("web signed in: the old-user port is called and its verdict shows the gate", async () => {
  let portCalls = 0;
  const port = async () => {
    portCalls += 1;
    return {
      hasLegacyRows: async () => true,
      ownRunVerified: async () => false,
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
  assert.ok(text.includes(INSTALL_097_WEB_NOTICE.title), "the web export notice shows");
  assert.ok(!text.includes("APP"), "children do not mount while the gate blocks");
  assert.ok(!text.includes("Choose the folder"), "no folder picker on the web");
});

test("web signed in with no legacy rows: the port is called and the app opens", async () => {
  let portCalls = 0;
  const port = async () => {
    portCalls += 1;
    return { hasLegacyRows: async () => false, ownRunVerified: async () => false };
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

test("no account on the web (port returns null): the app opens without asking the reader", async () => {
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
