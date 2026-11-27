/** The sweep: walks every route, explorer item, theme, window size and safe control of the running Dev app and reports anything wrong. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./dev-app";
import { armLongTasks, formatIssues, overLayers, scanPage, slowOpen, takeLongTasks, waitReady, watchErrors, type Issue } from "./sweep-checks";

// What each test covers:
// - every route: loads with no console/page errors, long tasks, overflow, stray scrollbars, error text, broken images,
//   and is ready (no loading state) within SLOW_MS; every explorer item too.
// - every explorer item: expands all tree rows, then opens the first PER_KIND of each kind and checks the page.
// - every theme: switches data-theme across all themes on /workspace and checks each one.
// - every tab: clicks each visible rail tab twice (first visit, return visit), flags slow switches and
//   tabs over their composited-layer budget (.agents/ui-layers.md).
// - every window size: resizes via CDP across SIZES on /workspace and checks each one.
// - every safe control: presses each visible button/tab on /workspace and /dashboard whose name passes DENY.
// Env knobs: WF_SWEEP_ROUTES (comma list), WF_SWEEP_PER_KIND, WF_SWEEP_MAX_CLICKS, WF_SWEEP_LONG_MS, WF_SWEEP_SLOW_MS, WF_SWEEP_TAB_MS,
// WF_SWEEP_CLICKS=0 (turns off the safe-control test).
// DENY keeps the sweep off anything that writes, sends, closes or leaves. Theme, size and URL are restored after each test.

const ORIGIN = "https://app.localhost";
const ROUTES = (process.env.WF_SWEEP_ROUTES?.split(",") ?? ["/workspace","/dashboard","/notes","/papers","/reader","/lists","/log","/plan","/experiments","/report","/graph","/wiki","/git","/settings","/shared","/supervision","/org","/ai-review"]);
const THEMES = ["amoled","brutal-dark","brutal","confetti-dark","confetti-light","contrast","crt","dark","dracula","honey","latte","light","mocha","pastel-dark","pastel-light","vivid-dark","vivid-light"];
const SIZES = [[1400, 900], [1024, 768], [800, 900], [390, 844]] as const;
const PER_KIND = Number(process.env.WF_SWEEP_PER_KIND ?? 3);
const MAX_CLICKS = Number(process.env.WF_SWEEP_MAX_CLICKS ?? 80);
const LONG_MS = Number(process.env.WF_SWEEP_LONG_MS ?? 500);
const SLOW_MS = Number(process.env.WF_SWEEP_SLOW_MS ?? 1_000);
const TAB_MS = Number(process.env.WF_SWEEP_TAB_MS ?? 300);
const SETTLE_MS = 2_500;
// Names of controls the sweep never presses: anything that writes, sends, closes or leaves.
const DENY = /delete|remove|discard|reset|clear|sign ?out|log ?out|push|pull|publish|send|share|revoke|install|update|restart|quit|exit|close|minimi|maximi|merge|commit|sync|import|export|upload|download|rename|move|archive|trash|\bnew\b|create|add|duplicate|copy|paste|cut|undo|redo|save|print|folder|connect|link|accept|decline|submit|apply|confirm|erase|sign ?in|log ?in|restore|revert|drop|leave|invite|join|approve|reject|\brun\b|start|stop|generate|reload|refresh|retry|fetch|\bpin\b|unpin|\btag\b|\bstar|favou?rite|\bmark\b|split/i;

const ALL: Issue[] = [];

/** Drains errors and long tasks, then scans the page; every issue is recorded in ALL. */
async function check(app: Page, errors: ReturnType<typeof watchErrors>, where: string): Promise<Issue[]> {
  const issues = [...errors.take(where), ...(await takeLongTasks(app, where, LONG_MS)), ...(await scanPage(app, where))];
  ALL.push(...issues);
  return issues;
}

/** Opens a route in Dev, waits for it to settle and returns how long it took to be ready. */
async function goto(app: Page, route: string): Promise<number> {
  const t0 = Date.now();
  await app.goto(ORIGIN + route.replace(/\/?$/, "/"), { waitUntil: "load" });
  await armLongTasks(app);
  const ms = await waitReady(app, t0);
  await app.waitForTimeout(SETTLE_MS);
  return ms;
}

test.describe("sweep", () => {
  // Not serial: one failing test must not stop the rest of the sweep (workers: 1 keeps the order).
  test.describe.configure({ mode: "default" });

  // A failed test restarts the worker, which empties ALL, so each test writes its own file.
  test.afterEach(({}, info) => {
    const dir = "test-results/desktop-sweep";
    mkdirSync(dir, { recursive: true });
    const slug = info.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    writeFileSync(`${dir}/${slug}.json`, JSON.stringify(ALL.splice(0), null, 2));
  });

  test.afterAll(() => {
    const dir = "test-results/desktop-sweep";
    const all: Issue[] = readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Issue[]);
    const perKind: Record<string, number> = {};
    for (const i of all) perKind[i.kind] = (perKind[i.kind] ?? 0) + 1;
    console.log(`sweep issues: ${all.length}`);
    console.log(`per kind: ${JSON.stringify(perKind)}`);
    console.log(formatIssues(all.slice(0, 40)));
  });

  test("every route loads clean", async ({ app }) => {
    test.setTimeout(15 * 60_000);
    const errors = watchErrors(app);
    const start = app.url();
    const found: Issue[] = [];
    try {
      for (const r of ROUTES) {
        const ms = await goto(app, r);
        console.log(`route ${r}: ready ${ms} ms`);
        found.push(...slowOpen("route " + r, ms, SLOW_MS), ...(await check(app, errors, "route " + r)));
      }
    } finally {
      await app.goto(start, { waitUntil: "load" });
    }
    expect(found, formatIssues(found)).toEqual([]);
  });

  // Users switch tabs from the rail, not with a page load: the screen there is kept alive, so a
  // return visit must be near instant and a first visit no slower than a route load.
  test("every tab switches fast", async ({ app }) => {
    test.setTimeout(10 * 60_000);
    const errors = watchErrors(app);
    const start = app.url();
    const found: Issue[] = [];
    const folded = app.locator('nav[aria-label="Primary"] [aria-expanded="false"][aria-controls^="nav-group-"]');
    let opened: string[] = [];
    try {
      await goto(app, "/dashboard");
      opened = await folded.evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-controls")!));
      // A folded group hides its tabs; open every one, and fold them back after.
      for (const id of opened) await app.locator(`nav[aria-label="Primary"] [aria-controls="${id}"]`).click();
      const tabs = app.locator('nav[aria-label="Primary"] a[href^="/"]');
      const hrefs = [...new Set(await tabs.evaluateAll((as) => as.filter((a) => (a as HTMLElement).offsetParent !== null).map((a) => a.getAttribute("href")!)))];
      for (const [pass, budget] of [["first", SLOW_MS], ["return", TAB_MS]] as const) {
        for (const href of hrefs) {
          await armLongTasks(app);
          const t0 = Date.now();
          await app.locator(`nav[aria-label="Primary"] a[href="${href}"]`).first().click();
          const ms = await waitReady(app, t0);
          console.log(`tab ${href} (${pass}): ready ${ms} ms`);
          const at = new URL(app.url()).pathname;
          if (at !== href) found.push({ where: `tab ${href} (${pass})`, kind: "no-switch", detail: `still on ${at}` });
          found.push(...slowOpen(`tab ${href} (${pass})`, ms, budget), ...(await check(app, errors, `tab ${href} (${pass})`)));
          if (pass === "return") found.push(...(await overLayers(app, `tab ${href}`, at)));
        }
      }
    } finally {
      for (const id of opened) await app.locator(`nav[aria-label="Primary"] [aria-controls="${id}"]`).click().catch(() => {});
      await app.goto(start, { waitUntil: "load" });
    }
    expect(found, formatIssues(found)).toEqual([]);
  });

  test("every explorer item opens clean", async ({ app }) => {
    test.setTimeout(15 * 60_000);
    const errors = watchErrors(app);
    const found: Issue[] = [];
    await goto(app, "/workspace");
    // The explorer's hidden state persists, so a run after a hidden session would see no rows.
    const show = app.getByRole("button", { name: "Show explorer" });
    if (await show.isVisible()) await show.click();

    for (let pass = 0; pass < 10; pass++) {
      const closed = app.locator('.explorer-body [role=treeitem][aria-expanded="false"]');
      const n = await closed.count();
      if (!n) break;
      for (let i = n - 1; i >= 0; i--) {
        await closed.nth(i).click({ timeout: 3_000 }).catch(() => {});
      }
      await app.waitForTimeout(500);
    }

    // The explorer paints only the rows in view (use-explorer-window), so read the keys a screenful at a time.
    const body = app.locator(".explorer-body");
    const seen = new Set<string>();
    for (let top = 0; ; ) {
      await body.evaluate((el, t) => (el.scrollTop = t), top);
      await app.waitForTimeout(150);
      const page = await app
        .locator(".explorer-body [role=treeitem]:not([aria-expanded])")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rowKey ?? "").filter(Boolean));
      page.forEach((k) => seen.add(k));
      const { h, sh } = await body.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight }));
      top += Math.max(1, Math.floor(h * 0.8));
      if (top >= sh) break;
    }
    const keys = [...seen];

    const byKind = new Map<string, string[]>();
    for (const key of keys) {
      const kind = key.split(/[:/]/)[0];
      const list = byKind.get(kind) ?? [];
      if (list.length < PER_KIND) list.push(key);
      byKind.set(kind, list);
    }

    const visited: Record<string, number> = {};
    for (const [kind, list] of byKind) {
      for (const key of list) {
        visited[kind] = (visited[kind] ?? 0) + 1;
        try {
          const row = app.locator(`.explorer-body [role=treeitem][data-row-key="${key.replace(/"/g, '\\"')}"]`).first();
          // Scroll the row into the painted window first.
          const sh = await body.evaluate((el) => el.scrollHeight);
          for (let top = 0; top < sh && !(await row.count()); top += 400) {
            await body.evaluate((el, t) => (el.scrollTop = t), top);
            await app.waitForTimeout(100);
          }
          const t0 = Date.now();
          await row.click({ timeout: 5_000 });
          const ms = await waitReady(app, t0);
          console.log(`item ${key}: ready ${ms} ms`);
          const slow = slowOpen("item " + key, ms, SLOW_MS);
          ALL.push(...slow);
          found.push(...slow);
        } catch (err) {
          const issue: Issue = { where: "item " + key, kind: "click-failed", detail: String(err).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 600) };
          ALL.push(issue);
          found.push(issue);
          continue;
        }
        await app.waitForTimeout(SETTLE_MS);
        found.push(...(await check(app, errors, "item " + key)));
      }
    }
    console.log(`explorer kinds visited: ${JSON.stringify(visited)}`);
    expect(found, formatIssues(found)).toEqual([]);
  });

  test("every theme renders clean", async ({ app }) => {
    test.setTimeout(15 * 60_000);
    const errors = watchErrors(app);
    const found: Issue[] = [];
    await goto(app, "/workspace");
    const orig = await app.evaluate(() => document.documentElement.dataset.theme ?? "");
    try {
      for (const t of THEMES) {
        await app.evaluate((th) => {
          document.documentElement.dataset.theme = th;
        }, t);
        await app.waitForTimeout(400);
        found.push(...(await check(app, errors, "theme " + t)));
      }
    } finally {
      await app.evaluate((th) => {
        document.documentElement.dataset.theme = th;
      }, orig);
    }
    expect(found, formatIssues(found)).toEqual([]);
  });

  test("every window size renders clean", async ({ app }) => {
    test.setTimeout(15 * 60_000);
    const errors = watchErrors(app);
    const found: Issue[] = [];
    await goto(app, "/workspace");
    const cdp = await app.context().newCDPSession(app);
    try {
      for (const [w, h] of SIZES) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await app.waitForTimeout(800);
        found.push(...(await check(app, errors, `size ${w}x${h}`)));
      }
    } finally {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.detach();
    }
    expect(found, formatIssues(found)).toEqual([]);
  });

  test("every safe control responds clean", async ({ app }) => {
    test.setTimeout(15 * 60_000);
    test.skip(process.env.WF_SWEEP_CLICKS === "0", "clicks off");
    const errors = watchErrors(app);
    const found: Issue[] = [];

    for (const route of ["/workspace", "/dashboard"]) {
      await goto(app, route);
      const names = await app
        .locator("button:visible, [role=button]:visible, [role=tab]:visible")
        .evaluateAll((els) => [
          ...new Set(
            els
              .filter((e) => !(e as HTMLButtonElement).disabled && (e as HTMLButtonElement).type !== "submit")
              .map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().replace(/\s+/g, " "))
              .filter((n) => n && n.length <= 60),
          ),
        ]);
      const safe = names.filter((n) => !DENY.test(n)).slice(0, MAX_CLICKS);
      console.log(`${route}: ${safe.length} safe controls, ${names.length - safe.length} skipped`);

      for (const n of safe) {
        const el = app
          .getByRole("button", { name: n, exact: true })
          .or(app.getByRole("tab", { name: n, exact: true }))
          .first();
        if (!(await el.isVisible().catch(() => false))) continue;
        // Covered or detached controls are skipped silently.
        await el.click({ timeout: 3_000 }).catch(() => {});
        await app.waitForTimeout(600);
        found.push(...(await check(app, errors, `click "${n}" on ${route}`)));
        await app.keyboard.press("Escape");
        await app.keyboard.press("Escape");
        if (!app.url().startsWith(ORIGIN + route)) await goto(app, route);
      }
    }
    expect(found, formatIssues(found)).toEqual([]);
  });
});
