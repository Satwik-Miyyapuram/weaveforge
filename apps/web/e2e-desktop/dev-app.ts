/** Attaches to the running WeaveForge Dev over CDP and counts its calls into the shell. */
import { chromium, test as base, type Browser, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

export type ShellCall = { cmd: string; t: number; ms?: number };

const CDP_PORT = process.env.CDP_PORT ?? "9223";

// Wrapper injected before page scripts: logs every weaveforge bridge call.
const WRAPPER_SOURCE = `
(() => {
  const log = (window.__wfIpc = []);
  const wrap = (b) => {
    if (!b || b.__wfWrapped) return b;
    for (const k of Object.keys(b)) {
      const f = b[k];
      if (typeof f !== "function") continue;
      b[k] = (...a) => {
        const t = performance.now();
        const e = { cmd: k, t: Math.round(t) };
        log.push(e);
        const p = f.apply(b, a);
        if (p && typeof p.then === "function") p.then(() => { e.ms = Math.round(performance.now() - t); }, () => { e.ms = Math.round(performance.now() - t); });
        else e.ms = 0;
        return p;
      };
    }
    try { b.__wfWrapped = true; } catch {}
    return b;
  };
  let cur = window.weaveforge;
  if (cur) wrap(cur);
  else Object.defineProperty(window, "weaveforge", { configurable: true, get: () => cur, set: (v) => { cur = wrap(v); } });
  const iv = setInterval(() => { if (window.weaveforge && !window.weaveforge.__wfWrapped) wrap(window.weaveforge); }, 0);
  setTimeout(() => clearInterval(iv), 3000);
})();
`;

export const test = base.extend<{ app: Page }, { dev: Browser }>({
  dev: [
    async ({}, use) => {
      let browser: Browser;
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`WeaveForge Dev is not running with CDP on ${CDP_PORT}: ` + message);
      }
      // No close(): the socket drops when the worker exits, and Dev must never be closed by a test.
      await use(browser);
    },
    { scope: "worker" },
  ],
  app: async ({ dev }, use) => {
    // Use the Dev app page only; never close it, the user's session lives there.
    let found: Page | undefined;
    for (const context of dev.contexts()) {
      found = context.pages().find((p) => p.url().startsWith("https://app.localhost"));
      if (found) break;
    }
    if (!found) throw new Error("No WeaveForge Dev page at https://app.localhost found over CDP");
    await use(found);
  },
});

export async function countShellCalls(page: Page): Promise<{
  reload(): Promise<void>;
  calls(): Promise<ShellCall[]>;
}> {
  const cdp = await page.context().newCDPSession(page);
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: WRAPPER_SOURCE,
  });

  return {
    async reload() {
      await page.reload({ waitUntil: "load" });
      // Wait until the shell call count stops growing for 2 s, capped at 30 s.
      let last = -1;
      let stableSince = Date.now();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const n = await page.evaluate(() => (window as any).__wfIpc?.length ?? 0);
        if (n !== last) {
          last = n;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 2_000) {
          break;
        }
        await page.waitForTimeout(250);
      }
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      await cdp.detach();
    },
    async calls() {
      return page.evaluate(() => (window as any).__wfIpc ?? []) as Promise<ShellCall[]>;
    },
  };
}

export function tally(calls: ShellCall[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of calls) out[c.cmd] = (out[c.cmd] ?? 0) + 1;
  return out;
}
