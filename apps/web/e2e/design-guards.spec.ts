import { expect, test } from "@playwright/test";
import { e2eEnabled } from "./helpers/env.js";
import { clippedText, sidewaysScroll, smallTargets } from "./helpers/design-guards.js";
import { gotoStable } from "./helpers/nav.js";

/**
 * G5 (targets) and G6 (overflow) on the real screens, signed in (design D20,
 * R9): at the design audit's two widths, the narrow one under a finger. A hit
 * names the element; there is no allowance to stay under.
 */

const ROUTES = ["/", "/log", "/papers", "/notes", "/experiments", "/plan", "/lists", "/settings", "/git", "/report"];

const WIDTHS = [
  { name: "960 mouse", use: { viewport: { width: 960, height: 1440 } } },
  { name: "420 finger", use: { viewport: { width: 420, height: 880 }, hasTouch: true, isMobile: true } },
];

for (const width of WIDTHS) {
  test.describe(`design guards at ${width.name}`, () => {
    test.use(width.use);

    test.beforeEach(async ({}, testInfo) => {
      if (!e2eEnabled()) testInfo.skip(true, "needs the e2e account (local-dev/test-accounts.env)");
    });

    for (const route of ROUTES) {
      test(`${route}: targets, clipped text, sideways scroll`, async ({ page }) => {
        await gotoStable(page, route);
        await expect(page.locator(".layout.has-nav")).toBeVisible({ timeout: 30_000 });
        // Let the route's data land so the guards see the full screen, not its skeleton.
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(500);
        expect(await smallTargets(page), "pressable things under their size").toEqual([]);
        expect(await clippedText(page), "text cut off without an ellipsis").toEqual([]);
        expect(await sidewaysScroll(page), "page scrolls sideways by").toBe(0);
      });
    }
  });
}
