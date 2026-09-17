/**
 * The ink editor's image affordances, driven over CDP in a real browser.
 *
 * The app itself needs a database and a session to reach an ink note, and the
 * ink editor is a component with a `deps` surface — so this serves the editor on
 * a page of its own (`e2e/fixtures/ink-harness.tsx`) over `http://127.0.0.1`,
 * launches Chromium with a debugging port, and drives it through CDP.
 *
 * What it proves, end to end and in pixels:
 *   1. "Add image" puts a *figure* on page 1 — the text layer carries its
 *      geometry, the vault has the bytes (WebP where the browser makes one),
 *      and the sheet draws it (screenshot). A page may hold any number.
 *   2. A paste and a drag-and-drop add figures rather than replacing anything.
 *   3. Ink draws *over* the figures and they all survive the stroke's save.
 *   4. "Insert page" still makes a page whose background is the image, because
 *      a PDF raster is a page — and its chunk index counts the figures too.
 *   5. The print menu's PNG and SVG both come out of a real download, at A4,
 *      with the figures composed in — a pasted photo must not vanish from
 *      the printed note.
 *   6. The figure is content: dragged, corner-resized with its aspect held,
 *      cropped by insets in the app's own dialog, and removable — every one
 *      a write to the note's text.
 *
 * Run: node scripts/ink-image-cdp.mjs [--headed] [--keep]
 * Screenshots land in `local-dev/ink-image-cdp/`.
 */
import fs from "node:fs";
import path from "node:path";

import { startInkHarness } from "./lib/ink-cdp-harness.mjs";

const { page, origin, snap, check, finish } = await startInkHarness({
  name: "ink-image-cdp",
  title: "ink",
  paneHeight: 1180,
  port: 9333,
  viewportHeight: 1240,
});
const SHOTS = path.resolve(import.meta.dirname, "..", "..", "local-dev", "ink-image-cdp");

/**
 * What a PNG actually looks like, read in the browser.
 *
 * A screenshot on disk proves nothing to a test, so it is decoded back in the
 * page and asked two questions: what colour is at each of these points (in
 * pixels of the image, so a caller can pass real coordinates rather than guess
 * at fractions of a viewport), and how many near-black pixels are there at all.
 * A tenth-scale copy answers the second cheaply and keeps the distinction that
 * matters — a 1 mm pen line survives the downscale as black, while the test
 * image's red text mixes with the paper and stays red.
 */
async function probePng(file, points = []) {
  return page.evaluate(
    async ([base64, wanted]) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const full = document.createElement("canvas");
      full.width = bitmap.width;
      full.height = bitmap.height;
      const ctx = full.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const at = ([x, y]) => {
        const data = ctx.getImageData(
          Math.min(bitmap.width - 1, Math.max(0, Math.round(x))),
          Math.min(bitmap.height - 1, Math.max(0, Math.round(y))),
          1,
          1,
        ).data;
        return [data[0], data[1], data[2]];
      };
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(bitmap.width / 10));
      small.height = Math.max(1, Math.round(bitmap.height / 10));
      const smallCtx = small.getContext("2d");
      smallCtx.drawImage(bitmap, 0, 0, small.width, small.height);
      const data = smallCtx.getImageData(0, 0, small.width, small.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] < 250) dark += 1;
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        points: wanted.map(at),
        dark,
      };
    },
    [fs.readFileSync(file).toString("base64"), points],
  );
}

/** Whether a probed colour is the test image's blue (#2563eb). */
function isBlue(rgb) {
  return rgb[2] > 180 && rgb[0] < 130 && rgb[1] < 180;
}

await page.goto(origin);
try {
  await page.waitForFunction(() => Boolean(window.inkHarness), null, {
    timeout: 20_000,
  });
} catch (error) {
  console.log("\nthe harness never loaded; the page body was:");
  console.log(
    await page
      .evaluate(() => document.body.innerHTML.slice(0, 600))
      .catch(() => "?"),
  );
  throw error;
}
// The worker comes up asynchronously; the bar is only interactive once it has,
// and the backend line says which renderer it chose.
await page
  .waitForFunction(
    () => {
      const el = document.querySelector(".ink-readout");
      const b = el?.getAttribute("data-backend");
      return b && b !== "starting";
    },
    null,
    { timeout: 15_000 },
  )
  .catch(() => {});
const backend = await page
  .locator(".ink-readout")
  .first()
  .getAttribute("data-backend")
  .catch(() => null);
console.log(`\n=== ink editor up on ${origin} (backend: ${backend ?? "?"}) ===\n`);

/** A picture to put on the page: obvious in a screenshot, and a real PNG. */
const imageBase64 = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(80, 80, 1040, 300);
  ctx.fillStyle = "#dc2626";
  ctx.font = "bold 96px sans-serif";
  ctx.fillText("PAGE IMAGE", 120, 620);
  return canvas.toDataURL("image/png").split(",")[1];
});
const imageBytes = Buffer.from(imageBase64, "base64");
console.log(`test image: ${(imageBytes.length / 1024).toFixed(1)} KB\n`);

const state = () =>
  page.evaluate(() => ({
    backgroundPath: window.inkHarness.backgroundPath(0),
    figures: window.inkHarness.figures(0).length,
    pages: window.inkHarness.pages().length,
    vault: window.inkHarness.vault(),
    uploads: window.inkHarness.uploadCount(),
    saves: window.inkHarness.saves.length,
    firstLine: window.inkHarness.pages()[0]?.split("\n")[0] ?? "",
  }));

/* ------------------------------------------------- 1. the Add image button */

console.log("1. Add image, from the toolbar button");
const addButton = page.getByRole("button", { name: "Add image to page" });
check("the Add image button is in the bar", (await addButton.count()) === 1);
await addButton.click();
await page.setInputFiles("[data-ink-image-input]", {
  name: "figure.png",
  mimeType: "image/png",
  buffer: imageBytes,
});
await page.waitForFunction(
  () => window.inkHarness.figures(0).length === 1,
  null,
  { timeout: 20_000 },
);
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(600);

const afterButton = await state();
check(
  "the page's text layer places the image as a figure",
  afterButton.firstLine.startsWith("![figure x=") &&
    afterButton.firstLine.includes("(vault:"),
  afterButton.firstLine,
);
check(
  "the bytes are in the vault",
  afterButton.vault.length === 1 && afterButton.vault[0].size > 10_000,
  afterButton.vault.map((v) => `${v.path} ${v.size}B`).join(", "),
);
check(
  "the figure is uploaded as WebP where the browser can make one",
  afterButton.vault[0].path.endsWith(".webp") || afterButton.vault[0].path.endsWith(".png"),
  `${afterButton.vault[0].path} (${afterButton.vault[0].type})`,
);

// And the thing the user actually asked for: is the picture *on the page*?
// Read back out of the editor's own pixels rather than assumed from the model.
// The figure's box is measured, and the probes are its own coordinates: the
// test image's blue band starts at 9% of its height, so 25% down the box is
// blue and 2% is the paper above the band.
const sheetShot = await snap("after-add-image");
const figureBox = await page.locator(".ink-figure").first().boundingBox();
const figurePixels = await probePng(
  sheetShot,
  figureBox
    ? [
        [figureBox.x + figureBox.width / 2, figureBox.y + figureBox.height * 0.25],
        [figureBox.x + figureBox.width / 2, figureBox.y + figureBox.height * 0.02],
      ]
    : [],
);
check(
  "the image is painted on the sheet where the picture's blue band is",
  Boolean(
    figureBox && isBlue(figurePixels.points[0]) && !isBlue(figurePixels.points[1]),
  ),
  figureBox
    ? `figure at ${Math.round(figureBox.x)},${Math.round(figureBox.y)} ` +
        `${Math.round(figureBox.width)}×${Math.round(figureBox.height)}: ` +
        `mid-blue ${figurePixels.points[0]}, top ${figurePixels.points[1]}`
    : "no figure on the sheet",
);

/* ------------------------------------------------ 2. paste and drag-and-drop */

console.log("\n2. Paste, then drop");
await page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "pasted.png", { type: "image/png" });
  const data = new DataTransfer();
  data.items.add(file);
  document
    .querySelector(".ink-wrap")
    ?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  window.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}, imageBase64);
await page.waitForFunction(
  () => window.inkHarness.figures(0).length === 2,
  null,
  { timeout: 20_000 },
);
await page.evaluate(() => window.inkHarness.settled());
const afterPaste = await state();
check(
  "a pasted screenshot becomes a second figure on the same page",
  afterPaste.figures === 2 && afterPaste.uploads === 2,
  `figures: ${afterPaste.figures}, uploads: ${afterPaste.uploads}`,
);

const beforeDrop = await page.evaluate(() => window.inkHarness.uploadCount());
await page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "dropped.png", { type: "image/png" });
  const data = new DataTransfer();
  data.items.add(file);
  // The *live* sheet, inside the rail's live layer — the first `.ink-sheet` in
  // the DOM is a static slot's, which takes no drop.
  const sheet = document.querySelector(".ink-live-layer .ink-sheet");
  const box = sheet?.getBoundingClientRect();
  // Where the hand would drop it: the sheet's own middle, in client
  // coordinates, because a drop without coordinates lands at 0,0 of the
  // client and the page's projection has to be told where it went.
  const at = {
    clientX: box ? box.left + box.width / 2 : 400,
    clientY: box ? box.top + box.height / 2 : 500,
  };
  sheet?.dispatchEvent(
    new DragEvent("dragover", {
      ...at,
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
    }),
  );
  sheet?.dispatchEvent(
    new DragEvent("drop", {
      ...at,
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
    }),
  );
}, imageBase64);
try {
  await page.waitForFunction(
    () => window.inkHarness.figures(0).length === 3,
    null,
    { timeout: 20_000 },
  );
} catch {
  const diagnosed = await page.evaluate(() => ({
    problems: window.inkHarness.problems(),
    uploads: window.inkHarness.uploadCount(),
    firstLines: window.inkHarness.pages()[0]?.split("\n").slice(0, 4),
  }));
  console.log("  [drop never landed]", JSON.stringify(diagnosed, null, 2));
  throw new Error("the drop did not become a figure");
}
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(600);
const afterDrop = await state();
check(
  "an image dropped on the sheet becomes a third figure, not a replacement",
  afterDrop.figures === 3 && afterDrop.uploads === beforeDrop + 1,
  `figures: ${afterDrop.figures}, uploads: ${afterDrop.uploads}`,
);
await snap("after-drop");

/* --------------------------------------------------- 3. ink over the picture */

console.log("\n3. Draw over it");
const box = await page.locator(".ink-canvas").boundingBox();
if (!box) throw new Error("no ink canvas");
await page.mouse.move(box.x + 120, box.y + 420);
await page.mouse.down();
for (let i = 0; i < 24; i += 1) {
  await page.mouse.move(box.x + 120 + i * 22, box.y + 420 + Math.sin(i / 3) * 60, {
    steps: 3,
  });
}
await page.mouse.up();
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(600);
const afterInk = await page.evaluate(async () => ({
  saves: window.inkHarness.saves.length,
  chunkBytes: (await window.inkHarness.chunkBase64(0))?.length ?? 0,
  figures: window.inkHarness.figures(0).length,
}));
check(
  "a stroke over the figures leaves every figure where it was",
  afterInk.figures === 3,
  `figures: ${afterInk.figures}`,
);
check("the page's chunk was written", afterInk.chunkBytes > 0);
await snap("ink-over-image");

/* ------------------------------------------- 4. insert a page from an image */

console.log("\n4. Insert a page from an image");
const beforeInsert = await page.evaluate(() => window.inkHarness.pages().length);
await page.getByRole("button", { name: "Insert page from PDF or image" }).click();
await page.setInputFiles("[data-ink-page-input]", {
  name: "inserted.png",
  mimeType: "image/png",
  buffer: imageBytes,
});
await page.waitForFunction(
  (before) => window.inkHarness.pages().length > before,
  beforeInsert,
  { timeout: 20_000 },
);
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(800);
const inserted = await page.evaluate(async () => ({
  pages: window.inkHarness.pages().length,
  onNewPage: window.inkHarness.backgroundPath(1),
  chunkBackground: await window.inkHarness.chunkBackground(1),
}));
check(
  "the image becomes a new page with the image on it",
  inserted.pages === beforeInsert + 1 && inserted.onNewPage !== null,
  `${beforeInsert} → ${inserted.pages} pages, page 2 background: ${inserted.onNewPage}`,
);
check(
  "and page 2's own chunk carries the note's latest attachment",
  // The index is the page's place among the *note's* image refs, not a per-page
  // flag (§4.8): page 1's three figures came first, so page 2's background is
  // the fourth `vault:` ref in the body.
  inserted.chunkBackground === 4,
  `page 2 chunk background index: ${inserted.chunkBackground}`,
);
await snap("inserted-page");

/* ---------------------------------------------------- 5. print, PNG and SVG */

console.log("\n5. The print menu");
// The reader is on page 2 — the inserted image with no ink on it. Export it here
// as the control for the ink count further down, then go back to page 1, which
// has both an image and a pen stroke, so its export has to carry both.
const pageTwoPng = await download(/Full-page PNG/).catch((error) => {
  console.log(`  [no page-2 PNG] ${String(error).split("\n")[0]}`);
  return null;
});
await page.getByRole("button", { name: "Previous page" }).click();
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(600);
// The counter is three spans (page, separator, total), so its text is read
// without the whitespace the layout puts between them.
const onPage = (await page.locator(".ink-page-count").textContent())?.replace(/\s+/g, "");
check("the reader can go back to the page with ink on it", onPage === "1/2", onPage);
await page.getByRole("button", { name: "Print or export this page" }).click();
const menu = page.getByRole("menu", { name: "Print or export" });
check("the print menu opens", await menu.isVisible().catch(() => false));
await snap("print-menu");
const items = await menu.getByRole("menuitem").allTextContents();
check(
  "it offers print, PNG and SVG",
  items.length === 3 &&
    /Print or save as PDF/.test(items[0]) &&
    /PNG/.test(items[1]) &&
    /SVG/.test(items[2]),
  items.join(" | "),
);

/**
 * Where the menu actually is, and what is painted over it.
 *
 * A list that is `visible` to a query engine can still be unclickable — clipped
 * by an ancestor's `overflow`, or behind something — and the only honest test
 * is the hit test the browser itself would do.
 */
const menuGeometry = await page.evaluate(() => {
  const list = document.querySelector(".ink-menu-list");
  const item = list?.querySelector(".ink-menu-item");
  if (!list || !item) return null;
  const rect = item.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const hit = document.elementFromPoint(x, y);
  const clipping = [];
  for (let node = list.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflow !== "visible" || style.contain !== "none") {
      clipping.push(
        `${node.className || node.tagName}: overflow ${style.overflow}, contain ${style.contain}`,
      );
    }
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    list: list.getBoundingClientRect().toJSON(),
    item: rect.toJSON(),
    hit: hit ? `${hit.tagName}.${hit.className}` : "none",
    inside: Boolean(hit && (hit === item || item.contains(hit))),
    clipping,
  };
});
check(
  "the menu item is the thing a click at its centre actually hits",
  Boolean(menuGeometry?.inside),
  menuGeometry
    ? `hit ${menuGeometry.hit} at ${Math.round(menuGeometry.item.left)},${Math.round(menuGeometry.item.top)} ` +
        `(${Math.round(menuGeometry.item.width)}×${Math.round(menuGeometry.item.height)}) in ` +
        `${menuGeometry.viewport.width}×${menuGeometry.viewport.height}` +
        (menuGeometry.clipping.length
          ? `; clipped by ${menuGeometry.clipping.join("; ")}`
          : "; nothing clips it")
    : "no menu",
);
if (process.argv.includes("--probe-menu")) {
  console.log(JSON.stringify(menuGeometry, null, 2));
  await cleanUp();
  process.exit(0);
}

/**
 * The print menu, open. Idempotent: the button toggles, so this looks at
 * whether the list is actually showing and clicks until it is, rather than
 * assuming how many clicks it takes from wherever the previous step left it.
 */
async function openMenu() {
  const trigger = page.getByRole("button", { name: "Print or export this page" });
  const list = page.getByRole("menu", { name: "Print or export" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await list.isVisible().catch(() => false)) return list;
    await trigger.click();
    await page.waitForTimeout(150);
  }
  await list.waitFor({ state: "visible", timeout: 5000 });
  return list;
}

/**
 * Click a menu item and hand back what the browser downloaded.
 *
 * The wait is attached to a catch the moment it is created: a headless GPU
 * renders A4 at 2× in software, which is slow enough that the wait and the
 * click can both time out, and an orphaned `waitForEvent` rejection takes the
 * process down instead of reporting itself.
 */
async function download(label, timeoutMs = 180_000) {
  const waiting = page
    .waitForEvent("download", { timeout: timeoutMs })
    .then((file) => ({ file }))
    .catch((error) => ({ error }));
  const started = Date.now();
  await openMenu();
  await page.getByRole("menuitem", { name: label }).click({ timeout: 15_000 });
  const outcome = await waiting;
  if (outcome.error) throw outcome.error;
  const file = outcome.file;
  const saved = path.join(SHOTS, file.suggestedFilename());
  await file.saveAs(saved);
  console.log(
    `   ${file.suggestedFilename()} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return { saved, name: file.suggestedFilename() };
}

let png = null;
// What the compose is about to see, from the harness's own model: the figures
// on the page being exported, and whether their bytes decode in this browser.
const composeInput = await page.evaluate(async () => {
  const figures = window.inkHarness.figures(0);
  const vault = window.inkHarness.vault();
  const decode = await Promise.all(
    vault.map(async (entry) => {
      try {
        const blob = await window.inkHarness.fetchBlobFor(entry.path);
        const bitmap = await createImageBitmap(blob);
        const size = `${bitmap.width}x${bitmap.height}`;
        bitmap.close();
        return `${entry.path} decodes (${size})`;
      } catch (error) {
        return `${entry.path} FAILED: ${String(error)}`;
      }
    }),
  );
  return { figures, decode };
});
console.log(
  `  [compose input] ${composeInput.figures.length} figures: ` +
    composeInput.figures.map((f) => `${f.path}@${f.x},${f.y}`).join(", "),
);
console.log(`  [compose input] ${composeInput.decode.join("; ")}`);
try {
  png = await download(/Full-page PNG/);
} catch (error) {
  console.log(`  [no PNG] ${String(error).split("\n")[0]}`);
}
// A page at 2× is 4200×5940. The blue probe sits inside a figure's own band:
// 25 % down the figure is blue (the band starts at 9 % of the image), and the
// paper above it is white. Page 2's background has its band at a third.
const firstFigure = await page.evaluate(() => window.inkHarness.figures(0)[0]);
const pageOneProbe = firstFigure
  ? [
      // A fifth of the way in, not the centre: the stroke of step 3 peaks
      // through the middle of the band, and the probe wants the paint under it.
      [
        Math.round((firstFigure.x + firstFigure.w * 0.2) * 2),
        Math.round((firstFigure.y + firstFigure.h * 0.25) * 2),
      ],
      [2100, Math.round(5940 * 0.02)],
    ]
  : [
      [2100, Math.round(5940 * 0.5)],
      [2100, Math.round(5940 * 0.02)],
    ];
const pageTwoProbe = [
  [2100, Math.round(5940 * 0.34)],
  [2100, Math.round(5940 * 0.02)],
];
const pageOnePixels = png ? await probePng(png.saved, pageOneProbe) : null;
const pageTwoPixels = pageTwoPng
  ? await probePng(pageTwoPng.saved, pageTwoProbe)
  : null;
check(
  "the PNG is the whole A4 page at 2× (508 dpi)",
  Boolean(
    pageOnePixels &&
      pageOnePixels.width === 4200 &&
      pageOnePixels.height === 5940,
  ),
  pageOnePixels && png
    ? `${pageOnePixels.width}×${pageOnePixels.height}, ` +
        `${(fs.statSync(png.saved).size / 1024 / 1024).toFixed(1)} MB → ${png.name}`
    : "nothing was downloaded",
);
check(
  "the exported page carries the image (blue) on paper (white)",
  Boolean(
    pageOnePixels &&
      isBlue(pageOnePixels.points[0]) &&
      !isBlue(pageOnePixels.points[1]),
  ),
  pageOnePixels
    ? `mid-blue ${pageOnePixels.points[0]}, top ${pageOnePixels.points[1]}`
    : "no export to read",
);
// Page 2 is the control: the same image, no pen. So anything near-black in
// page 1's export is the ink, and the gap between the two is the stroke.
check(
  "the pen stroke is in the export, and not on the page that has no ink",
  Boolean(
    pageOnePixels &&
      pageTwoPixels &&
      pageOnePixels.dark > 0 &&
      pageTwoPixels.dark === 0,
  ),
  pageOnePixels && pageTwoPixels
    ? `near-black pixels — page 1 (ink + image): ${pageOnePixels.dark}, ` +
        `page 2 (image only): ${pageTwoPixels.dark}`
    : "no exports to compare",
);

let svg = null;
try {
  svg = await download(/Vector SVG/);
} catch (error) {
  console.log(`  [no SVG] ${String(error).split("\n")[0]}`);
}
const svgText = svg ? fs.readFileSync(svg.saved, "utf8") : "";
check(
  "the SVG is vector strokes with the figures embedded",
  svgText.includes("<svg") &&
    /<path d="M/.test(svgText) &&
    /xlink:href="data:image\/(webp|png);base64,/.test(svgText) &&
    svgText.includes("<clipPath"),
  svg
    ? `${(svgText.length / 1024).toFixed(0)} KB, ` +
        `${(svgText.match(/<path /g) ?? []).length} paths, ` +
        `${(svgText.match(/<clipPath /g) ?? []).length} figures → ${svg.name}`
    : "nothing was downloaded",
);

// Print has no file to hand back: it opens the preview, a frame holding the
// print document — the sheet rebuilt for paper (§ink-print) — with the print
// button beside it. What is asserted is that every layer is in the document:
// the paper at A4, the figure as an embedded picture, and the ink raster.
await openMenu();
await page
  .getByRole("menuitem", { name: /Print or save as PDF/ })
  .click({ timeout: 15_000 });
// The document carries the same 2× raster, so it lands on the same slow path
// a headless GPU takes to render it.
const printFrame = page.locator(".ink-print-preview-frame");
await printFrame.waitFor({ timeout: 180_000 }).catch(() => undefined);
const printDoc = await printFrame.getAttribute("srcdoc").catch(() => null);
check(
  "Print previews an A4 print document with every layer of the page in it",
  typeof printDoc === "string" &&
    printDoc.includes("@page { size: 210mm 297mm; margin: 0; }") &&
    printDoc.includes('class="ink-sheet paper-') &&
    printDoc.includes('class="ink-figure"') &&
    printDoc.includes('class="ink-print-ink" src="data:image/png;base64,'),
  printDoc ? `${printDoc.length} bytes of print HTML` : "no print preview",
);
await snap("print-preview");
await page.getByRole("button", { name: "Close", exact: true }).first().click();
await page.locator(".ink-print-preview-frame").waitFor({ state: "detached", timeout: 5_000 });

/* ------------------------------------ 6. moving, resizing, cropping, removing */

// A figure is content on the page, so it is handled like content: dragged by
// the body, resized by a corner (the aspect holds unless Shift is held),
// cropped by insets in a dialog, and removable. Every one of these is a write
// to the note's text — the geometry in the alt — so what is asserted is the
// saved model and the pixels both.
console.log("\n6. Moving, resizing and cropping a figure");
// The export step above already came back to page 1; go there only if the
// reader is somewhere else, because the button is honestly disabled there.
const onPageOne = await page.evaluate(() => {
  const shown = document.querySelector(".ink-page-count")?.textContent?.replace(/\s+/g, "");
  return shown?.startsWith("1/") ?? true;
});
if (!onPageOne) {
  await page.getByRole("button", { name: "Previous page" }).click();
}
await page.evaluate(() => window.inkHarness.settled());
await page.waitForTimeout(600);

const beforeMove = await page.evaluate(() => {
  // The figures land nearly stacked, so the one a gesture reaches is the one
  // on top: the last of the page's own order.
  const all = window.inkHarness.figures(0);
  return all[all.length - 1];
});
const figureHandle = page.locator(".ink-figure").last();
const moveBox = await figureHandle.boundingBox();
check(
  "the figures came back with the page",
  Boolean(beforeMove && moveBox),
  beforeMove
    ? `topmost figure at ${beforeMove.x},${beforeMove.y} ${beforeMove.w}×${beforeMove.h}`
    : "no figures",
);
if (moveBox) {
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down();
  // Straight down by 150 px: the box follows, the page's own geometry says so.
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(
      moveBox.x + moveBox.width / 2,
      moveBox.y + moveBox.height / 2 + (150 * i) / 10,
      { steps: 2 },
    );
  }
  await page.mouse.up();
  // The write is debounced (§the host's save), so the move is *polled for*
  // in the saved model rather than read once after a guessed delay.
  await page.waitForFunction(
    () => {
      const all = window.inkHarness.figures(0);
      const moved = all[all.length - 1];
      return Boolean(moved && moved.y > 1150);
    },
    null,
    { timeout: 20_000 },
  );
}
const afterMove = await page.evaluate(() => {
  const all = window.inkHarness.figures(0);
  return all[all.length - 1];
});
check(
  "a drag of the body moves the figure, in the note's own units",
  Boolean(
    beforeMove &&
      afterMove &&
      Math.abs(afterMove.x - beforeMove.x) < 30 &&
      afterMove.y - beforeMove.y > 100,
  ),
  beforeMove && afterMove
    ? `y ${beforeMove.y} → ${afterMove.y} (x ${beforeMove.x} → ${afterMove.x})`
    : "no figure to move",
);

// Resize: the south-east corner grows the box, aspect held.
const beforeResize = await page.evaluate(() => {
  const all = window.inkHarness.figures(0);
  return all[all.length - 1];
});
const resizeBox = await figureHandle.boundingBox();
if (resizeBox) {
  const corner = {
    x: resizeBox.x + resizeBox.width - 3,
    y: resizeBox.y + resizeBox.height - 3,
  };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(corner.x + (120 * i) / 10, corner.y + (90 * i) / 10, {
      steps: 2,
    });
  }
  await page.mouse.up();
  // Poll the debounced save, the same as the move above.
  await page.waitForFunction(
    () => {
      const all = window.inkHarness.figures(0);
      const grown = all[all.length - 1];
      return Boolean(grown && grown.w > 1150);
    },
    null,
    { timeout: 20_000 },
  );
}
const afterResize = await page.evaluate(() => {
  const all = window.inkHarness.figures(0);
  return all[all.length - 1];
});
check(
  "a corner drag grows the figure with its aspect held",
  Boolean(
    beforeResize &&
      afterResize &&
      afterResize.w > beforeResize.w + 100 &&
      afterResize.h > beforeResize.h + 70 &&
      Math.abs(
        afterResize.w / afterResize.h - beforeResize.w / beforeResize.h,
      ) < 0.05,
  ),
  beforeResize && afterResize
    ? `${beforeResize.w}×${beforeResize.h} → ${afterResize.w}×${afterResize.h} (aspect ${(beforeResize.w / beforeResize.h).toFixed(2)} → ${(afterResize.w / afterResize.h).toFixed(2)})`
    : "no figure to resize",
);

// Crop: a double-click on the figure opens its controls — a second one, on
// the frame of an active figure, goes straight to cropping — and the crop is
// the frame's own handles: the kept rectangle, dragged in, then applied. The
// bytes stay; what changes is the figure's geometry in the note.
const controlsBox = await figureHandle.boundingBox();
if (controlsBox) {
  await page.mouse.dblclick(
    controlsBox.x + controlsBox.width / 2,
    controlsBox.y + controlsBox.height / 2,
  );
}
// Exact: "Crop this image" is a toolbar too, and the name match is a substring.
const popover = page.getByRole("toolbar", { name: "This image", exact: true });
const cropFrame = page.getByRole("group", { name: "Crop: the part of the image to keep" });
if (await popover.isVisible().catch(() => false)) {
  await popover.getByRole("button", { name: "Crop", exact: true }).click({ timeout: 5000 });
}
await cropFrame.waitFor({ state: "visible", timeout: 5000 });
check("a double-click opens the figure's controls, and Crop is the frame's handles", true);
const keptBox = await cropFrame.boundingBox();
if (keptBox) {
  // The north-west handle, dragged a tenth of the way in on both axes.
  const from = { x: keptBox.x, y: keptBox.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(
      from.x + (keptBox.width * 0.1 * i) / 10,
      from.y + (keptBox.height * 0.1 * i) / 10,
      { steps: 2 },
    );
  }
  await page.mouse.up();
}
await page.getByRole("toolbar", { name: "Crop this image" }).getByRole("button", { name: "Apply" }).click();
await page.waitForFunction(
  () => /c=\d+(\.\d+)?,\d+(\.\d+)?,0,0/.test(window.inkHarness.pages()[0] ?? ""),
  null,
  { timeout: 10_000 },
);
await page.evaluate(() => window.inkHarness.settled());
check(
  "the crop is geometry in the note, not new bytes",
  (await page.evaluate(() => window.inkHarness.uploadCount())) ===
    (await page.evaluate(() => window.inkHarness.figures(0).length)) + 1,
  `uploads: ${await page.evaluate(() => window.inkHarness.uploadCount())}`,
);
await snap("after-crop");

// Remove: from the same controls, and the text layer says it is gone. The
// figure is still the active one after its crop, so its toolbar is up.
if (!(await popover.isVisible().catch(() => false))) {
  const removeBox = await figureHandle.boundingBox();
  if (removeBox) {
    await page.mouse.dblclick(
      removeBox.x + removeBox.width / 2,
      removeBox.y + removeBox.height / 2,
    );
  }
}
await popover.getByRole("button", { name: "Remove" }).click();
await page.waitForFunction(
  () => window.inkHarness.figures(0).length === 2,
  null,
  { timeout: 10_000 },
);
await page.evaluate(() => window.inkHarness.settled());
check(
  "removing a figure leaves the others where they are",
  (await page.evaluate(() => window.inkHarness.figures(0).length)) === 2,
  `${await page.evaluate(() => window.inkHarness.figures(0).length)} figures left`,
);
await snap("final");

/* -------------------------------------------------------------------- report */

await finish(`  renderer: ${backend}`);
