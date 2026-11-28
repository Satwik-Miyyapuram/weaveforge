/** Attaches to the running WeaveForge Dev over CDP and counts its calls into the shell. */
import { chromium, expect, test as base, type Browser, type Page } from "@playwright/test";

export { expect };

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

export const ORIGIN = "https://app.localhost";

/** Opens a route in Dev. Specs never assume the screen Dev was left on. */
export async function openRoute(page: Page, route: string): Promise<void> {
  await page.goto(ORIGIN + route.replace(/\/?$/, "/"), { waitUntil: "load" });
}

/** Name of the open project, or null when Dev shows the projects screen. */
export async function currentProject(page: Page): Promise<string | null> {
  const switcher = page.getByRole("button", { name: /^Project: / });
  if ((await switcher.count()) === 0) return null;
  return ((await switcher.first().getAttribute("aria-label")) ?? "").replace(/^Project: /, "");
}

/** Shows the projects screen ("All projects" in the project switcher). */
export async function openProjectsScreen(page: Page): Promise<void> {
  await openRoute(page, "/dashboard");
  const switcher = page.getByRole("button", { name: /^Project: / });
  await page.getByRole("button", { name: "New project", exact: true }).or(switcher).first().waitFor({ timeout: 30_000 });
  if ((await switcher.count()) === 0) return;
  await switcher.first().click();
  await page.getByRole("menuitem", { name: "All projects" }).click();
  await page.getByRole("button", { name: "New project", exact: true }).first().waitFor({ timeout: 20_000 });
}

/** Opens a route inside a project; with none open, opens the first one that is not a test leftover. */
export async function openInProject(page: Page, route: string): Promise<void> {
  // Home always shows the switcher or the projects list; /workspace hides the switcher.
  await openRoute(page, "/dashboard");
  const switcher = page.getByRole("button", { name: /^Project: / });
  const rows = page.locator("main li > button:first-child");
  await switcher.or(rows).first().waitFor({ timeout: 30_000 });
  if ((await switcher.count()) === 0) {
    const names = await rows.allInnerTexts();
    const pick = names.map((n) => n.trim()).find((n) => n && !n.startsWith("e2e-"));
    if (!pick) throw new Error("No project to open in Dev");
    await openProject(page, pick);
  }
  await openRoute(page, route);
}

/** Names the note New note just opened: waits for its focused title, since creating it is async. */
export async function nameNewNote(page: Page, name: string): Promise<void> {
  const title = page.getByRole("textbox", { name: "Note title" });
  await expect(title).toBeFocused({ timeout: 20_000 });
  await title.fill(name);
  await title.press("Enter");
}

/**
 * The vault path of the note titled `title`. Notes-screen New note writes `untitled--<id6>.note.md`
 * (or `untitled-2--…`) whatever it is named, the explorer `<name>--<id6>.note.md`; match the frontmatter.
 */
export function findNoteFile(page: Page, title: string): Promise<string | null> {
  return page.evaluate(async (title) => {
    const wf = (window as any).weaveforge;
    let level = [""];
    for (let depth = 0; depth < 4 && level.length; depth++) {
      const next: string[] = [];
      for (const dir of level) {
        for (const e of (await wf.listVaultFiles(dir)) as { path: string; kind: string }[]) {
          const last = e.path.split("/").pop() ?? "";
          if (last.startsWith(".")) continue;
          if (e.kind === "dir") next.push(e.path);
          else if ((last.startsWith("untitled") || last.startsWith(`${title}--`)) && last.endsWith(".md")) {
            const text = ((await wf.readVaultFile(e.path)) as string | null) ?? "";
            const head = text.startsWith("---") ? text.slice(0, text.indexOf("\n---", 3)) : "";
            const named = head.split("\n").some((line) => /^title:/.test(line) && line.slice(6).trim().replace(/^["']|["']$/g, "") === title);
            if (named) return e.path;
          }
        }
      }
      level = next;
    }
    return null;
  }, title);
}

/**
 * Deletes the open note with its editor's "Delete note" button, then closes the Undo toast so the delete runs
 * now (rule D-07 deletes only when the toast closes; a test that moves on first leaves the note behind).
 */
export async function deleteOpenNote(page: Page, title: string): Promise<void> {
  const note = await findNoteFile(page, title);
  await page.getByRole("button", { name: "Delete note" }).first().click();
  await page.locator(".toast").filter({ hasText: title }).getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => findNoteFile(page, title), { timeout: 10_000 }).toBeNull();
  if (!note) return;
  // Its strokes folder (`foo.note.ink/` by `foo.note.md`) goes with it; one left behind is ink with no note.
  const ink = note.replace(/\.md$/, ".ink");
  const parent = ink.slice(0, ink.lastIndexOf("/"));
  const inkLeft = () =>
    page.evaluate(
      async ([dir, path]) => ((await (window as any).weaveforge.listVaultFiles(dir)) as { path: string }[]).some((e) => e.path === path),
      [parent, ink] as const,
    );
  await expect.poll(inkLeft, { timeout: 10_000 }).toBe(false);
}

/** Opens a project by name from the projects screen. */
export async function openProject(page: Page, name: string): Promise<void> {
  await openProjectsScreen(page);
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: `Project: ${name}` }).waitFor({ timeout: 20_000 });
}
