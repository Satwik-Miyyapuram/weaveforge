import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { decideBrowserSwitchFromConfig } from "../browser-switch-wiring";
import type { BackendConfig } from "@/backend/parts";

/**
 * P3 desktop group. In the Tauri shell the browser switch must never run: no Supabase
 * session read, no core call, no network. Detection honours both the desktop bridge
 * (`window.weaveforge.fetchTitle`) and the raw Tauri global (`__TAURI_INTERNALS__`).
 */

const CONFIG = {
  dataUrl: "https://data.example",
  supabaseUrl: "https://auth.example",
  supabaseAnonKey: "anon",
} as unknown as BackendConfig;

type G = { window?: unknown; fetch?: unknown };
const g = globalThis as G;
let savedWindow: unknown;
let savedFetch: unknown;
let fetchCalls: number;

beforeEach(() => {
  savedWindow = g.window;
  savedFetch = g.fetch;
  fetchCalls = 0;
  g.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
});

afterEach(() => {
  g.window = savedWindow;
  g.fetch = savedFetch;
});

test("(P3-a) the Tauri global alone is enough: no bridge, no shell arg, no session or network call", async () => {
  g.window = { __TAURI_INTERNALS__: {} };
  const out = await decideBrowserSwitchFromConfig(CONFIG, null);
  assert.deepEqual(out, { switch: false, reason: "desktop" });
  assert.equal(fetchCalls, 0);
});

test("(P3-c) the desktop bridge alone reads as desktop and makes no session or network call", async () => {
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve(null) } };
  const out = await decideBrowserSwitchFromConfig(CONFIG, { fetchTitle: () => Promise.resolve(null) } as never);
  assert.deepEqual(out, { switch: false, reason: "desktop" });
  assert.equal(fetchCalls, 0);
});

test("(P3-b) the shell passed by the caller is honoured even with no window globals", async () => {
  g.window = {};
  const out = await decideBrowserSwitchFromConfig(CONFIG, { fetchTitle: () => Promise.resolve(null) } as never);
  assert.deepEqual(out, { switch: false, reason: "desktop" });
  assert.equal(fetchCalls, 0);
});

test("a plain browser with no shell is not treated as desktop", async () => {
  g.window = {};
  const out = await decideBrowserSwitchFromConfig(CONFIG, null);
  assert.notEqual(out.switch === false && out.reason, "desktop");
});
