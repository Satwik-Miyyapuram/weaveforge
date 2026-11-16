/**
 * The component, not just the flag: mounting ServiceWorkerRegister in a
 * production build must not call navigator.serviceWorker.register on the
 * desktop build, and must call it on the web build.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, create } from "react-test-renderer";

import { ServiceWorkerRegister } from "../service-worker-register";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalEnv = process.env.NODE_ENV;

type RegisterCall = { url: string; options: unknown };
let registerCalls: RegisterCall[] = [];

beforeEach(() => {
  registerCalls = [];
  const serviceWorker = {
    register: async (url: string, options: unknown) => {
      registerCalls.push({ url, options });
      return {};
    },
    getRegistrations: async () => [],
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  // Registration only runs in production (the dev branch unregisters instead).
  Object.assign(process.env, { NODE_ENV: "production" });
});

afterEach(() => {
  Object.assign(process.env, { NODE_ENV: originalEnv });
  delete (globalThis as { window?: unknown }).window;
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    delete (globalThis as { navigator?: unknown }).navigator;
  }
});

/** Mounts the component and flushes its effects and the best-effort work they start. */
async function mount(offlineBuild: boolean) {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(<ServiceWorkerRegister offlineBuild={offlineBuild} />);
  });
  await act(async () => {});
  renderer?.unmount();
}

test("the desktop build does not register /sw.js when mounted", async () => {
  await mount(true);
  assert.deepEqual(registerCalls, []);
});

test("the web build registers /sw.js with root scope when mounted", async () => {
  await mount(false);
  assert.deepEqual(registerCalls, [{ url: "/sw.js", options: { scope: "/" } }]);
});
