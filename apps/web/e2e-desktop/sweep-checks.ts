/** What the sweep counts as wrong on a page: errors, error text, stray scrollbars, broken images, long tasks, slow opens. */
import type { Page } from "@playwright/test";

export type Issue = { where: string; kind: string; detail: string };

// Browser noise, not an app bug.
export const IGNORE = [/ResizeObserver loop/];

/** Collects console errors and uncaught page errors until `take` drains them. */
export function watchErrors(page: Page): { take(where: string): Issue[] } {
  const pending: { kind: string; detail: string }[] = [];
  const push = (kind: string, detail: string) => {
    pending.push({ kind, detail: detail.slice(0, 300) });
  };
  // A failed fetch logs only "Failed to load resource"; the URL says which one.
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    push("console-error", url && m.text().startsWith("Failed to load resource") ? `${m.text()} ${url}` : m.text());
  });
  page.on("pageerror", (e) => push("page-error", e.message));
  return {
    take(where: string): Issue[] {
      const out = pending
        .splice(0)
        .filter((p) => !IGNORE.some((re) => re.test(p.detail)))
        .map((p) => ({ where, kind: p.kind, detail: p.detail }));
      return out;
    },
  };
}

/** Starts a long-task observer in the page; a no-op if it is already running. */
export async function armLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__wfSweepArmed) return;
    w.__wfSweepArmed = true;
    w.__wfLong = [];
    // WebView2 supports longtask; if it did not, the sweep simply sees none.
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__wfLong.push(Math.round(e.duration));
      }).observe({ type: "longtask", buffered: false });
    } catch {
      /* no longtask support */
    }
  });
}

/** Drains the long-task durations recorded since the last call. */
export async function takeLongTasks(page: Page, where: string, overMs: number): Promise<Issue[]> {
  const durations = await page.evaluate(() => {
    const w = window as any;
    const l: number[] = w.__wfLong ?? [];
    w.__wfLong = [];
    return l;
  });
  const over = durations.filter((d) => d > overMs);
  if (!over.length) return [];
  const longest = Math.max(...over);
  return [{ where, kind: "long-task", detail: `${over.length} tasks over ${overMs} ms, longest ${longest} ms` }];
}

/**
 * Waits until the page shows no loading state (a "Loading…" line, aria-busy, a skeleton, spinner or loading class)
 * for 300 ms, and returns how long that took from `since`. Gives up at `capMs`.
 */
export async function waitReady(page: Page, since: number, capMs = 20_000): Promise<number> {
  let quietFrom = 0;
  for (;;) {
    const busy = await page
      .evaluate(() => {
        const marker = document.querySelector('[aria-busy="true"], [class*="skeleton"], [class*="loading"], [class*="spinner"]');
        if (marker && (marker as HTMLElement).offsetParent !== null) return true;
        return /^\s*Loading\b[^\n]{0,40}$/m.test(document.body.innerText);
      })
      .catch(() => true);
    const now = Date.now();
    if (busy) quietFrom = 0;
    else if (!quietFrom) quietFrom = now;
    else if (now - quietFrom >= 300) return quietFrom - since;
    if (now - since >= capMs) return now - since;
    await page.waitForTimeout(50);
  }
}

/** A slow-open issue when opening `where` took longer than `overMs`. */
export function slowOpen(where: string, ms: number, overMs: number): Issue[] {
  return ms > overMs ? [{ where, kind: "slow-open", detail: `ready after ${ms} ms (budget ${overMs} ms)` }] : [];
}

/** Scans the current page for overflow, stray scrollbars, error text and broken images. */
export async function scanPage(page: Page, where: string): Promise<Issue[]> {
  const found = await page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const sel = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      for (let i = 0; i < 3 && cur; i++, cur = cur.parentElement) {
        let s = cur.tagName.toLowerCase();
        if (cur.id) s += `#${cur.id}`;
        else if (cur.classList.length) s += "." + [...cur.classList].slice(0, 2).join(".");
        parts.unshift(s);
      }
      return parts.join(" > ");
    };

    // The editor route is a full-window shell, so its page never scrolls; other screens scroll the page by design
    // (shell.css pads them by --nav-clear). Sideways overflow is wrong everywhere.
    const d = document.documentElement;
    const editor = !!document.querySelector(".layout.editor-route");
    if (editor && d.scrollHeight > innerHeight + 1) out.push({ kind: "page-overflow-y", detail: `${d.scrollHeight}/${innerHeight}` });
    if (d.scrollWidth > innerWidth + 1) out.push({ kind: "page-overflow-x", detail: `${d.scrollWidth}/${innerWidth}` });

    // A strip under 64px (tab bar, toolbar, breadcrumb) that can scroll on that axis shows a stray scrollbar; this caught the CRT tab strip.
    let scrollIssues = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (scrollIssues >= 20) break;
      const h = el as HTMLElement;
      // A scroller with scrollbar-width: none shows no bar (the breadcrumbs scroll that way on purpose).
      if ((h.scrollHeight > h.clientHeight + 1 || h.scrollWidth > h.clientWidth + 1) && getComputedStyle(h).scrollbarWidth === "none") continue;
      if (h.scrollHeight > h.clientHeight + 1 && h.clientHeight > 0 && h.clientHeight < 64) {
        if (["auto", "scroll"].includes(getComputedStyle(h).overflowY)) {
          out.push({ kind: "thin-scroll-y", detail: `${sel(h)} ${h.scrollHeight}/${h.clientHeight}` });
          scrollIssues++;
        }
      }
      if (h.scrollWidth > h.clientWidth + 1 && h.clientWidth > 0 && h.clientWidth < 64) {
        if (["auto", "scroll"].includes(getComputedStyle(h).overflowX)) {
          out.push({ kind: "thin-scroll-x", detail: `${sel(h)} ${h.scrollWidth}/${h.clientWidth}` });
          scrollIssues++;
        }
      }
    }

    const m = document.body.innerText.match(/^.*(Could not load|Something went wrong|Application error|Unhandled Runtime Error|Failed to load).*$/m);
    if (m) out.push({ kind: "error-text", detail: m[0].slice(0, 160) });

    for (const img of document.querySelectorAll("img")) {
      if (img.src && img.complete && img.naturalWidth === 0) {
        out.push({ kind: "broken-image", detail: img.src.slice(0, 120) });
      }
    }
    return out;
  });
  return found.map((f) => ({ where, kind: f.kind, detail: f.detail }));
}

/** One line per issue, `[kind] where: detail`. */
export function formatIssues(list: Issue[]): string {
  return list.map((i) => `[${i.kind}] ${i.where}: ${i.detail}`).join("\n");
}
