/**
 * Minimal hook render harness for the node:test runner.
 *
 * react-test-renderer needs no DOM, so hooks can be exercised under plain
 * `node --import tsx --test` alongside the pure-function tests in this folder.
 * Only hooks are supported — assert on the returned value, not on markup.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// react-test-renderer logs a deprecation notice on import under React 18.3.
// It is advisory and unrelated to anything under test, so keep it out of the
// test output.
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("react-test-renderer is deprecated")) return;
  originalError(...(args as Parameters<typeof console.error>));
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface HookHarness<P, T> {
  /** Latest value returned by the hook. */
  readonly current: T;
  /** Re-render with new props. Flushes effects and any microtasks they await. */
  rerender: (props: P) => Promise<void>;
  /** Let pending promises inside effects settle. */
  flush: () => Promise<void>;
  unmount: () => Promise<void>;
}

/**
 * Render `hook` with `initialProps` and return a handle for re-rendering it.
 * Effects have run (and their awaited work settled) by the time this resolves.
 */
export async function renderHook<P, T>(
  hook: (props: P) => T,
  initialProps: P,
): Promise<HookHarness<P, T>> {
  let value: T;
  const Probe = ({ hookProps }: { hookProps: P }) => {
    value = hook(hookProps);
    return null;
  };

  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Probe, { hookProps: initialProps }));
  });

  const flush = async () => {
    await act(async () => {});
  };

  return {
    get current() {
      return value;
    },
    rerender: async (props: P) => {
      await act(async () => {
        renderer.update(createElement(Probe, { hookProps: props }));
      });
    },
    flush,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}
