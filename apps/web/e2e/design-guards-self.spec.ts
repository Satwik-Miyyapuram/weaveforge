import { expect, test } from "@playwright/test";
import { clippedText, sidewaysScroll, smallTargets } from "./helpers/design-guards.js";

/**
 * The page-level design guards (G5 targets, G6 overflow) on planted pages:
 * each must catch the bad element and only it (design D20, "each guard fails
 * on a planted bad file"). No server and no account: run on its own with
 * PLAYWRIGHT_NO_SESSION=1 (apps/web/scripts/run-design-guards.mjs).
 */

const page = (body: string) => `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0; }
  button { padding: 0; border: 0; }
</style></head><body>${body}</body></html>`;

test.describe("G5 targets", () => {
  test.use({ viewport: { width: 960, height: 800 } });

  test("catches small buttons, block links and bare checkboxes, and nothing else", async ({ page: p }) => {
    await p.setContent(page(`
      <button aria-label="Tiny" style="width:16px;height:16px"></button>
      <a href="#" style="display:block;width:120px;height:20px">Block link</a>
      <input type="checkbox" aria-label="Bare">
      <button aria-label="Fine" style="width:24px;height:24px"></button>
      <p>Read <a href="#">the guide</a> first.</p>
      <label style="display:inline-flex;height:28px;align-items:center"><input type="checkbox"> Labelled</label>
      <button style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Screen reader</button>
      <button aria-label="Hidden" style="width:10px;height:10px;visibility:hidden"></button>
    `));
    const hits = await smallTargets(p);
    expect(hits).toEqual(["Tiny 16x16 (min 24)", "Block link 120x20 (min 24)", "Bare 13x13 (min 24)"]);
  });

  test("a clean page has no hits", async ({ page: p }) => {
    await p.setContent(page(`<button style="width:36px;height:36px">Go</button>`));
    expect(await smallTargets(p)).toEqual([]);
  });
});

test.describe("G5 reader toolbars under a finger", () => {
  test.use({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true });

  test("ask 44px in a reader toolbar and 24px elsewhere", async ({ page: p }) => {
    await p.setContent(page(`
      <div class="reader-screen"><div role="toolbar">
        <button aria-label="Zoom" style="width:32px;height:32px"></button>
        <button aria-label="Pen" style="width:44px;height:44px"></button>
      </div></div>
      <div role="toolbar"><button aria-label="Bold" style="width:32px;height:32px"></button></div>
    `));
    expect(await p.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(await smallTargets(p)).toEqual(["Zoom 32x32 (min 44)"]);
  });
});

test.describe("G6 overflow", () => {
  test.use({ viewport: { width: 960, height: 800 } });
  const long = "A title far too long for the box it has been given";

  test("catches text cut off without an ellipsis, and nothing else", async ({ page: p }) => {
    await p.setContent(page(`
      <div class="cut" style="width:80px;overflow:hidden;white-space:nowrap">${long}</div>
      <div class="dots" style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${long}</div>
      <div class="clamp" style="width:80px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${long} ${long}</div>
      <div class="cm-editor"><div class="line" style="width:80px;overflow:hidden;white-space:nowrap">${long}</div></div>
      <div class="wraps" style="width:80px;overflow:hidden">${long}</div>
    `));
    expect(await clippedText(p)).toEqual([`cut: ${long.slice(0, 40)}`]);
    expect(await sidewaysScroll(p)).toBe(0);
  });

  test("catches a page that scrolls sideways", async ({ page: p }) => {
    await p.setContent(page(`<div style="width:1400px;height:10px"></div>`));
    expect(await sidewaysScroll(p)).toBe(440);
  });
});
