import type { Page } from "@playwright/test";

export interface DemoScenario {
  /** Filename stem, e.g. `papers` → docs/demo/clips/papers.webm */
  id: string;
  title: string;
  /** Seconds to hold the final frame after navigation/actions. */
  holdSec?: number;
  run: (page: Page) => Promise<void>;
}

async function waitForShell(page: Page) {
  await page.locator(".layout.has-nav").waitFor({ state: "visible", timeout: 60_000 });
}

const LIBRARY_PATHS = new Set(["/papers", "/notes", "/graph", "/lists"]);
const PLAN_PATHS = new Set(["/plan", "/log"]);

async function waitForPath(page: Page, path: string) {
  await page.waitForFunction(
    (expected) => {
      const p = window.location.pathname;
      return p === expected || p.startsWith(`${expected}/`);
    },
    path,
    { timeout: 20_000 },
  );
}

/** In-app navigation when possible — avoids Next.js SPA aborting full document loads. */
async function goToPath(page: Page, path: string) {
  const shell = page.locator(".layout.has-nav");
  const inShell = await shell.isVisible({ timeout: 1500 }).catch(() => false);

  if (inShell) {
    const subTab = page.locator(`.sub-nav a.sub-tab[href="${path}"]`);
    if (await subTab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await subTab.click();
      await waitForPath(page, path);
      await waitForShell(page);
      return;
    }

    if (LIBRARY_PATHS.has(path)) {
      await page.locator('.nav a.nav-link[href="/papers"]').first().click();
      await waitForShell(page);
      if (path !== "/papers") {
        await page.locator(`.sub-nav a.sub-tab[href="${path}"]`).waitFor({ state: "visible", timeout: 10_000 });
        await page.locator(`.sub-nav a.sub-tab[href="${path}"]`).click();
        await waitForPath(page, path);
      }
      await waitForShell(page);
      return;
    }

    if (PLAN_PATHS.has(path)) {
      await page.locator('.nav a.nav-link[href="/plan"]').first().click();
      await waitForShell(page);
      if (path !== "/plan") {
        const subTab = page.locator(`.sub-nav a.sub-tab[href="${path}"]`);
        await subTab.waitFor({ state: "visible", timeout: 10_000 });
        await subTab.click();
        await waitForPath(page, path);
      }
      await waitForShell(page);
      return;
    }

    const navLink = page.locator(`.nav a.nav-link[href="${path}"]`).first();
    if (await navLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await navLink.click();
      await waitForPath(page, path);
      await waitForShell(page);
      return;
    }
  }

  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  } catch (err) {
    if (!/ERR_ABORTED|NS_ERROR_ABORT/i.test(String(err))) throw err;
  }
  await waitForPath(page, path);
  await waitForShell(page);
}

async function expandAllReportSections(page: Page) {
  for (let i = 0; i < 24; i++) {
    const closed = page.locator('.section-tree button.list-toggle[aria-expanded="false"]');
    if ((await closed.count()) === 0) break;
    await closed.first().click();
    await page.waitForTimeout(120);
  }
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "dashboard",
    title: "Dashboard — project overview",
    holdSec: 2,
    async run(page) {
      await page.goto("/dashboard");
      await waitForShell(page);
      await page.waitForTimeout(600);
    },
  },
  {
    id: "papers",
    title: "Papers — library grid & reading view",
    holdSec: 2.5,
    async run(page) {
      await goToPath(page, "/papers");
      await page.waitForTimeout(800);
      const card = page.locator(".paper-card").first();
      if (await card.isVisible({ timeout: 4000 }).catch(() => false)) {
        await card.click();
        await page.locator(".paper-note, .paper-article").first().waitFor({ timeout: 8000 });
      }
    },
  },
  {
    id: "graph",
    title: "Citation graph",
    holdSec: 2.5,
    async run(page) {
      await goToPath(page, "/graph");
      await page.locator(".graph-wrap, .graph-screen, canvas").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: "lists",
    title: "Reading lists — nested hierarchy",
    holdSec: 2.5,
    async run(page) {
      await goToPath(page, "/lists");
      await page.getByText("Loading…").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
      await page.locator(".list-tree-panel").waitFor({ timeout: 15_000 });
      const expandAll = page.getByRole("button", { name: "Expand all" });
      await expandAll.waitFor({ state: "visible", timeout: 5000 });
      await expandAll.click();
      await page.locator(".list-tree-root .list-node").first().waitFor({ timeout: 10_000 });
      await page.locator(".list-children .list-node").first().waitFor({ timeout: 10_000 });
      await page.locator(".list-paper-row").first().waitFor({ timeout: 10_000 });
      await page.evaluate(() => window.scrollTo({ top: 280, behavior: "instant" }));
      await page.waitForTimeout(1100);
    },
  },
  {
    id: "notes",
    title: "Vault notes",
    holdSec: 2,
    async run(page) {
      await goToPath(page, "/notes");
      await page.getByText("Loading…").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
      await page.locator(".vault-screen").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(900);
    },
  },
  {
    id: "experiments",
    title: "Experiments — runs, compare & detail",
    holdSec: 2.5,
    async run(page) {
      await goToPath(page, "/experiments");
      await page.waitForTimeout(700);
      const compare = page.getByRole("button", { name: "Compare", exact: true });
      if (await compare.isVisible({ timeout: 2000 }).catch(() => false)) {
        await compare.click();
        await page.waitForTimeout(900);
      }
      const detail = page.locator('a[href^="/experiments/"]').first();
      if (await detail.isVisible({ timeout: 3000 }).catch(() => false)) {
        await detail.click();
        await page.locator(".exp-detail, .metric-curves").first().waitFor({ timeout: 12_000 });
      }
    },
  },
  {
    id: "plan",
    title: "Plan — milestones & dependencies",
    holdSec: 2,
    async run(page) {
      await goToPath(page, "/plan");
      await page.waitForTimeout(900);
    },
  },
  {
    id: "logbook",
    title: "Logbook",
    holdSec: 2,
    async run(page) {
      await goToPath(page, "/log");
      await page.waitForTimeout(900);
    },
  },
  {
    id: "report",
    title: "Report outline — nested sections",
    holdSec: 2.5,
    async run(page) {
      await goToPath(page, "/report");
      await page.getByText("Loading…").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
      await page.locator(".section-tree > .section-node").first().waitFor({ timeout: 15_000 });
      await expandAllReportSections(page);
      await page.locator(".section-tree.nested .section-node").first().waitFor({ timeout: 10_000 });
      const deepNested = page.locator(".section-tree.nested .section-tree.nested").first();
      if (await deepNested.isVisible({ timeout: 3000 }).catch(() => false)) {
        await deepNested.scrollIntoViewIfNeeded();
      } else {
        const bg = page.locator(".section-node").filter({ hasText: /Generative models|2\.1/ }).first();
        if (await bg.isVisible({ timeout: 3000 }).catch(() => false)) {
          await bg.scrollIntoViewIfNeeded();
        }
      }
      await page.evaluate(() => window.scrollTo({ top: 360, behavior: "instant" }));
      await page.waitForTimeout(1100);
    },
  },
  {
    id: "shared",
    title: "Shared with me",
    holdSec: 2,
    async run(page) {
      await page.goto("/shared");
      await waitForShell(page);
      await page.waitForTimeout(900);
    },
  },
  {
    id: "supervision",
    title: "Supervision — supervisee plan & logbook",
    holdSec: 2.5,
    async run(page) {
      await page.goto("/supervision");
      await waitForShell(page);
      await page.locator(".superv-panels, .superv-picker").first().waitFor({ timeout: 12_000 });
      await page.waitForTimeout(900);
    },
  },
];
