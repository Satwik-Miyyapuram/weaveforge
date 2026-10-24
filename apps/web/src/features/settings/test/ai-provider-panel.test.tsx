/**
 * A keychain that refuses is reported, not left as an unhandled rejection:
 * the restore on mount is logged (31-06) and a failed forget on "Stop using
 * it" is shown (31-05).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { clearActiveProvider, setActiveProvider } from "@/features/ai-assistant/application/ai-provider-session";
import { AiProviderPanel } from "../ui/ai-provider-panel";

type Log = { level: string; source: string; message: string; detail?: string };

const DESCRIPTOR = { id: "example", label: "Example", baseUrl: "https://api.example.com", api: "openai-chat" as const, model: "m" };

const text = (root: ReactTestRenderer) => JSON.stringify(root.toJSON());

test("a refusing keychain is logged on mount and shown on Stop using it", async () => {
  const logs: Log[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = {
    localStorage: { getItem: () => null },
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      readSecret: () => Promise.reject(new Error("keychain locked")),
      clearSecret: () => Promise.reject(new Error("keychain locked")),
      reportAppLog: (e: Log) => void logs.push(e),
    },
  };
  process.on("unhandledRejection", onUnhandled);
  setActiveProvider(DESCRIPTOR, "sk-test");
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AiProviderPanel));
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.ok(logs.some((l) => l.level === "warn" && l.source === "ai-provider" && /keychain locked/.test(l.detail ?? "")));

    const stop = root.root.findAll((n) => n.type === "button" && n.children.includes("Stop using it"))[0]!;
    await act(async () => {
      stop.props.onClick();
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.match(text(root), /Could not forget the stored key/);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    root?.unmount();
    process.off("unhandledRejection", onUnhandled);
    g.window = original;
    clearActiveProvider();
  }
});
