import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Paste and image handling in the real editor, in a real browser.
 *
 * The rest of the suite needs a database and a signed-in user, so it is skipped
 * on a checkout without credentials. This file needs neither: it bundles the
 * editor into a page of its own and drives that. The behaviour being tested is
 * entirely between the clipboard, CodeMirror and the DOM, and none of it is any
 * more true when a server is involved — so it runs everywhere, every time.
 *
 * Two bugs came out of it that the unit tests could not have found, both about
 * a placeholder's position surviving what the writer does while an upload is in
 * flight: text typed at either edge was being swallowed, and undo left the
 * image to reappear a second later.
 */

const ROOT = path.resolve(__dirname, "..");

let pageUrl: string;
let outDir: string;

test.beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "weaveforge-editor-"));
  await build({
    entryPoints: [path.join(ROOT, "e2e/fixtures/editor-harness.ts")],
    bundle: true,
    outfile: path.join(outDir, "bundle.js"),
    format: "iife",
    platform: "browser",
    target: "es2020",
    // The app's own `@/…` specifiers; there is no tsconfig-paths step here.
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "warning",
  });
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>editor</title>` +
      `<div id="editor" style="height:320px"></div><script src="bundle.js"></script>`,
  );
  pageUrl = `file://${path.join(outDir, "index.html")}`;
});

test.afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

// No session: this page is not the app.
test.use({ storageState: undefined });

/** The harness, freshly reset. */
async function open(page: Page, mode: "manual" | "instant" = "manual") {
  await page.goto(pageUrl);
  await page.waitForFunction(() => Boolean((window as any).editorHarness));
  await page.evaluate((m) => {
    const h = (window as any).editorHarness;
    h.setDoc("");
    h.errors.length = 0;
    h.resetUploads();
    h.mode(m);
    h.focus();
  }, mode);
  return {
    doc: () => page.evaluate(() => (window as any).editorHarness.doc() as string),
    cursor: () => page.evaluate(() => (window as any).editorHarness.cursor() as number),
    errors: () => page.evaluate(() => (window as any).editorHarness.errors as string[]),
    uploads: () => page.evaluate(() => (window as any).editorHarness.pending() as number),
    uploadCount: () => page.evaluate(() => (window as any).editorHarness.uploadCount() as number),
    pending: () => page.evaluate(() => (window as any).editorHarness.decorations() as number),
  };
}

/** Run a snippet against the harness. */
function act(page: Page, body: string, arg?: unknown) {
  return page.evaluate(
    ([source, value]) => {
      const h = (window as any).editorHarness;
      // eslint-disable-next-line no-new-func -- the source is this file's own, not user input
      return new Function("h", "arg", source as string)(h, value);
    },
    [body, arg] as [string, unknown],
  );
}

/** CodeMirror dispatches and promise callbacks both settle within a frame or two. */
async function settle(page: Page, ms = 60) {
  await page.waitForTimeout(ms);
}

test.describe("text paste", () => {
  test("strips a tracking parameter and one undo takes the whole paste back out", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("https://a.example/x?utm_source=news&id=7")`);
    await settle(page);
    expect(await h.doc()).toBe("https://a.example/x?id=7");

    await act(page, `h.undo()`);
    await settle(page);
    expect(await h.doc()).toBe("");
  });

  test("leaves a paste that lands inside a code fence alone", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("intro\\n\\n\`\`\`\\n\\n\`\`\`\\n"); h.setCursor("intro\\n\\n\`\`\`\\n".length)`);
    await act(page, `h.paste("https://a.example/x?utm_source=news")`);
    await settle(page);
    expect(await h.doc()).toBe("intro\n\n```\nhttps://a.example/x?utm_source=news\n```\n");
  });

  test("the master switch stops the rules", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.settings({ cleanOnPaste: false }); h.paste("https://a.example/x?utm_source=news")`);
    await settle(page);
    expect(await h.doc()).toBe("https://a.example/x?utm_source=news");
  });

  test("a settings change reaches an editor that is already open", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.settings({ straightenQuotes: true }); h.paste("\\u201Cdon\\u2019t\\u201D")`);
    await settle(page);
    expect(await h.doc()).toBe(`"don't"`);
  });

  test("the terminal and PDF commands run from their keys, on the selection", async ({ page }) => {
    const h = await open(page);
    await act(
      page,
      `h.setDoc("npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do\\n  not use it."); h.focus(); h.key("t", { ctrlKey: true, altKey: true })`,
    );
    await settle(page);
    expect(await h.doc()).toBe(
      "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do not use it.",
    );

    await act(
      page,
      `h.setDoc("keep this\\nThe long-term expo-\\nsure was measured."); h.focus(); h.select("keep this\\n".length, h.doc().length); h.key("p", { ctrlKey: true, altKey: true })`,
    );
    await settle(page);
    expect(await h.doc()).toBe("keep this\nThe long-term exposure was measured.");
  });

  test("a URL pasted over a selection becomes a link, with its tracking gone", async ({ page }) => {
    // The markdown package offers this too, but it reads the raw clipboard: a
    // link built by it kept the campaign tag the cleanup had just removed.
    const h = await open(page);
    await act(page, `h.setDoc("the paper"); h.focus(); h.pasteOver(4, 9, "https://example.com/p?utm_source=news")`);
    await settle(page);
    expect(await h.doc()).toBe("the [paper](https://example.com/p)");
  });

  test("a bracket in the selected label is escaped", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("see [1] here"); h.focus(); h.pasteOver(4, 7, "https://example.com/p")`);
    await settle(page);
    expect(await h.doc()).toBe("see [\\[1\\]](https://example.com/p) here");
  });

  test("a URL pasted with nothing selected stays a plain URL", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("x "); h.setCursor(2); h.paste("https://example.com/p?utm_source=n")`);
    await settle(page);
    expect(await h.doc()).toBe("x https://example.com/p");
  });

  test("a spreadsheet paste becomes a Markdown table", async ({ page }) => {
    const h = await open(page);
    // Passed as an argument rather than inlined: the tabs and newlines have to
    // reach the page as data, not as escapes inside a source string.
    await act(page, `h.paste(arg)`, "model\tval_loss\nbeta-VAE\t0.1826\nResNet-18\t0.340");
    await settle(page);
    expect(await h.doc()).toBe(
      "| model | val_loss |\n| --- | ---: |\n| beta-VAE | 0.1826 |\n| ResNet-18 | 0.340 |",
    );
  });

  test("typing is never rewritten", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.focus()`);
    await page.keyboard.type("hello — world");
    expect(await h.doc()).toBe("hello — world");
  });
});

test.describe("image paste", () => {
  test("lands at the caret, not at the end of the note", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.setDoc("before after"); h.setCursor("before ".length); h.pasteImages(["loss-curve.png"])`);
    await settle(page, 120);
    expect(await h.doc()).toBe("before ![loss-curve](vault:u/p/loss-curve.png)after");
  });

  test("leaves the caret after the inserted link", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.setDoc("x"); h.setCursor(1); h.pasteImages(["a.png"])`);
    await settle(page, 120);
    expect(await h.cursor()).toBe("x![a](vault:u/p/a.png)".length);
  });

  test("shows a pending placeholder and swaps it when the upload lands", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("start "); h.setCursor(6); h.pasteImages(["diagram.png"])`);
    await settle(page);
    expect(await h.doc()).toBe("start ![Uploading diagram…]()");
    expect(await h.pending()).toBe(1);

    await act(page, `h.finish(0, "![diagram](vault:u/p/diagram.png)")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("start ![diagram](vault:u/p/diagram.png)");
    expect(await h.pending()).toBe(0);
  });

  test("the placeholder survives edits made while the upload runs", async ({ page }) => {
    // The reason its position lives in a mapped state field rather than in a
    // remembered offset. Both edges were absorbing the writer's text before.
    const h = await open(page);
    await act(page, `h.setDoc("start "); h.setCursor(6); h.pasteImages(["diagram.png"])`);
    await settle(page);
    await act(page, `h.insertAt(0, "PRE ")`);
    await act(page, `h.insertAt(h.doc().length, " POST")`);
    await settle(page, 30);
    await act(page, `h.finish(0, "![diagram](vault:u/p/diagram.png)")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("PRE start ![diagram](vault:u/p/diagram.png) POST");
  });

  test("several images keep their own slots however their uploads finish", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.pasteImages(["one.png", "two.png", "three.png"])`);
    await settle(page);
    expect(await h.uploads()).toBe(3);

    await act(page, `h.finish(1, "<TWO>")`);
    await settle(page, 40);
    await act(page, `h.finish(2, "<THREE>")`);
    await settle(page, 40);
    await act(page, `h.finish(0, "<ONE>")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("<ONE><TWO><THREE>");
  });

  test("a failed upload removes its placeholder and says why", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("keep this"); h.setCursor(9); h.pasteImages(["broken.png"])`);
    await settle(page);
    await act(page, `h.failUpload(0, "Storage is full.")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("keep this");
    expect(await h.errors()).toEqual(["Storage is full."]);
  });

  test("an oversized image is refused before anything is uploaded", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.pasteImages(["huge.png"], { bytes: 2 * 1024 * 1024 })`);
    await settle(page, 100);
    expect(await h.doc()).toBe("");
    expect(await h.uploadCount()).toBe(0);
    expect((await h.errors())[0]).toMatch(/over the 1 MB limit/);
  });

  test("an image on the clipboard wins over the text beside it", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.pasteImages(["fig.png"], { text: "some text that came along" })`);
    await settle(page, 120);
    expect(await h.doc()).toBe("![fig](vault:u/p/fig.png)");
  });

  test("a non-image file and an SVG are both left alone", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.pasteImages(["doc.pdf"], { type: "application/pdf" })`);
    await settle(page, 80);
    expect(await h.doc()).toBe("");

    // SVG carries script, so it is not accepted as a pasted image.
    await act(page, `h.pasteImages(["logo.svg"], { type: "image/svg+xml" })`);
    await settle(page, 80);
    expect(await h.uploadCount()).toBe(0);
  });

  test("a dropped image lands where it was dropped", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.setDoc("a\\nb\\nc"); h.setCursor(5); h.dropImages(["dropped.png"])`);
    await settle(page, 120);
    expect(await h.doc()).toMatch(/^!\[dropped\]\(vault:u\/p\/dropped\.png\)/);
  });

  test("an image replaces the selection it was pasted over", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.setDoc("replace me"); h.select(0, 10); h.pasteImages(["over.png"])`);
    await settle(page, 120);
    expect(await h.doc()).toBe("![over](vault:u/p/over.png)");
  });

  test("undo removes the placeholder, and a late upload does not undo the undo", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("note text"); h.setCursor(9); h.focus(); h.pasteImages(["undone.png"])`);
    await settle(page);
    await act(page, `h.undo()`);
    await settle(page, 40);
    expect(await h.doc()).toBe("note text");

    await act(page, `h.finish(0, "![undone](vault:u/p/undone.png)")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("note text");
  });
});
