/**
 * A Copy button says "Copied" only when the text reached the clipboard, and a
 * blocked clipboard is not an unhandled rejection (31-10).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import type { DesktopLocalApi } from "@/lib/desktop/desktop-bridge";
import { McpClients } from "../ui/mcp-clients";

const state: DesktopLocalApi = {
  enabled: true,
  url: "http://127.0.0.1:27123",
  tokens: [{ id: "t1", name: "AI clients", prefix: "wf_ab", permissions: ["mcp:read"], createdAt: "2026-10-01T10:00:00Z", expiresAt: null }],
  mcp: {
    connected: true,
    tokenId: "t1",
    url: "http://127.0.0.1:27123/mcp",
    launch: { command: "node", args: ["mcp.mjs"], env: {} },
  },
};

async function clickCopy(writeText: (t: string) => Promise<void>) {
  const g = globalThis as Record<string, unknown>;
  const savedWindow = g.window;
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);
  g.window = { setTimeout: () => 0 };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true, writable: true });
  process.on("unhandledRejection", onUnhandled);
  try {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(createElement(McpClients, { state, onChange() {} }));
    });
    const copy = root.root.findAll((n) => n.type === "button" && n.children.includes("Copy"))[0]!;
    await act(async () => {
      copy.props.onClick();
      await new Promise((r) => setTimeout(r, 5));
    });
    const labels = root.root.findAll((n) => n.type === "button").map((b) => b.children.join(""));
    root.unmount();
    return { labels, unhandled };
  } finally {
    process.off("unhandledRejection", onUnhandled);
    g.window = savedWindow;
    if (savedNav) Object.defineProperty(globalThis, "navigator", savedNav);
  }
}

test("a granted copy shows Copied", async () => {
  const { labels, unhandled } = await clickCopy(async () => {});
  assert.ok(labels.includes("Copied"));
  assert.deepEqual(unhandled, []);
});

test("a blocked copy shows no Copied and leaves nothing unhandled", async () => {
  const { labels, unhandled } = await clickCopy(() => Promise.reject(new Error("NotAllowedError")));
  assert.ok(!labels.includes("Copied"));
  assert.deepEqual(unhandled, []);
});
