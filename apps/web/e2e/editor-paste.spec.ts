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
    h.resetRemote();
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
    lookups: () => page.evaluate(() => (window as any).editorHarness.remoteCalls() as string[]),
    hasHandle: () => page.evaluate(() => (window as any).editorHarness.hasHandle() as boolean),
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

  test("a pasted DOI becomes a link to its resolver", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste(arg)`, "See 10.1145/3292500.3330701 for the method.");
    await settle(page);
    expect(await h.doc()).toBe(
      "See [10.1145/3292500.3330701](https://doi.org/10.1145/3292500.3330701) for the method.",
    );
  });

  test("every command is reachable from its key", async ({ page }) => {
    const h = await open(page);

    // Table, from a selection, with the automatic rule switched off so the
    // command is doing the work.
    await act(page, `h.settings({ tabsToTable: false })`);
    await act(page, `h.setDoc(arg); h.focus(); h.key("t", { ctrlKey: true, altKey: true, shiftKey: true })`, "a\tb\nx\ty");
    await settle(page);
    expect(await h.doc()).toBe("| a | b |\n| --- | --- |\n| x | y |");
    await act(page, `h.settings({ tabsToTable: true })`);

    // Commas, both directions.
    await act(page, `h.setDoc(arg); h.focus(); h.key(".", { ctrlKey: true, altKey: true })`, 'She called it "finished," then left.');
    await settle(page);
    expect(await h.doc()).toBe('She called it "finished", then left.');

    await act(page, `h.focus(); h.key(",", { ctrlKey: true, altKey: true })`);
    await settle(page);
    expect(await h.doc()).toBe('She called it "finished," then left.');

    // The PDF repair with the two guesses a person has to confirm.
    await act(
      page,
      `h.setDoc(arg); h.focus(); h.key("p", { ctrlKey: true, altKey: true, shiftKey: true })`,
      "the result was\n\n14\n\nmeasured again",
    );
    await settle(page);
    expect(await h.doc()).toBe("the result was measured again");
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

/**
 * The two rules that reach the internet.
 *
 * Driven through a stand-in desktop bridge rather than a stubbed `fetch`,
 * because that is the seam the app actually uses: `outboundFetch()` picks the
 * bridge when there is one and the server route otherwise, and everything above
 * it is identical either way. So these cases test the editor's half — when a
 * lookup starts, where its answer lands, and what happens when it does not
 * arrive — without a server, and they check the bridge contract at the same time.
 */
test.describe("url lookups", () => {
  test("a pasted link is usable immediately and gains its title afterwards", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("https://a.example/paper?utm_source=news")`);
    await settle(page);

    // The whole point of doing this after the paste: the link is already there.
    expect(await h.doc()).toBe("https://a.example/paper");
    expect(await h.lookups()).toEqual(["title https://a.example/paper"]);
    // Not dimmed — it is a working link, and dimming it would say otherwise.
    expect(await h.pending()).toBe(0);

    await act(page, `h.finishTitle(0, "Attention Is All You Need")`);
    await settle(page, 80);
    expect(await h.doc()).toBe("[Attention Is All You Need](https://a.example/paper)");
  });

  test("a title arriving late lands where the link has drifted to", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("see "); h.setCursor(4); h.paste("https://a.example/p")`);
    await settle(page);
    await act(page, `h.insertAt(0, "PRE ")`);
    await act(page, `h.insertAt(h.doc().length, " POST")`);
    await settle(page, 40);

    await act(page, `h.finishTitle(0, "A Page")`);
    await settle(page, 80);
    expect(await h.doc()).toBe("PRE see [A Page](https://a.example/p) POST");
  });

  test("a site that does not answer leaves the plain link", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("https://a.example/p")`);
    await settle(page);
    await act(page, `h.failRemote(0, "That page could not be read.")`);
    await settle(page, 80);
    expect(await h.doc()).toBe("https://a.example/p");
    // Quiet on purpose: the note has what was pasted, and nothing was lost.
    expect(await h.errors()).toEqual([]);
  });

  test("a title that comes back empty changes nothing", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("https://a.example/p")`);
    await settle(page);
    await act(page, `h.finishTitle(0, "")`);
    await settle(page, 80);
    expect(await h.doc()).toBe("https://a.example/p");
  });

  test("with the rule off nothing is looked up", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.settings({ fetchLinkTitles: false }); h.paste("https://a.example/p?utm_source=n")`);
    await settle(page, 80);
    // The cleanup still runs; only the lookup is gone.
    expect(await h.doc()).toBe("https://a.example/p");
    expect(await h.lookups()).toEqual([]);
  });

  test("a URL pasted over a selection becomes a link and is not looked up", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("AlphaFold"); h.pasteOver(0, 9, "https://a.example/p?utm_source=n")`);
    await settle(page, 80);
    // The writer supplied the label; asking a site for a different one would
    // overwrite what they chose.
    expect(await h.doc()).toBe("[AlphaFold](https://a.example/p)");
    expect(await h.lookups()).toEqual([]);
  });

  test("text around a URL is not a URL paste", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("see https://a.example/p for the details")`);
    await settle(page, 80);
    expect(await h.lookups()).toEqual([]);
  });

  test("a pasted image address downloads the picture and stores it", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.paste("https://a.example/figures/loss-curve.png")`);
    await settle(page);

    // Dimmed here, unlike the title case: what is on screen is not yet the
    // thing that was asked for.
    expect(await h.doc()).toBe("![Downloading loss curve…]()");
    expect(await h.pending()).toBe(1);
    expect(await h.lookups()).toEqual(["image https://a.example/figures/loss-curve.png"]);

    await act(page, `h.finishImage(0)`);
    await settle(page, 120);
    expect(await h.doc()).toBe("![loss-curve](vault:u/p/loss-curve.png)");
    expect(await h.pending()).toBe(0);
  });

  test("a download that fails puts the link back and says why", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.paste("https://a.example/fig.png")`);
    await settle(page);
    await act(page, `h.failRemote(0, "That image could not be downloaded.")`);
    await settle(page, 100);
    // Reported, unlike a failed title: the reader expected a picture.
    expect(await h.doc()).toBe("https://a.example/fig.png");
    expect(await h.errors()).toEqual(["That image could not be downloaded."]);
  });

  test("with image download off an image URL is looked up as a link instead", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.settings({ downloadPastedImages: false }); h.paste("https://a.example/fig.png")`);
    await settle(page, 80);
    expect(await h.doc()).toBe("https://a.example/fig.png");
    expect(await h.lookups()).toEqual(["title https://a.example/fig.png"]);
  });

  test("undo before the picture arrives leaves the note cleared", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("note "); h.setCursor(5); h.focus(); h.paste("https://a.example/fig.png")`);
    await settle(page);
    await act(page, `h.undo()`);
    await settle(page, 40);
    const afterUndo = await h.doc();

    await act(page, `h.finishImage(0)`);
    await settle(page, 120);
    // Whatever undo left, the late download does not add to it.
    expect(await h.doc()).toBe(afterUndo);
    expect(afterUndo).not.toContain("vault:");
  });

  test("the master switch stops the lookups along with everything else", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.settings({ cleanOnPaste: false }); h.paste("https://a.example/p")`);
    await settle(page, 80);
    expect(await h.lookups()).toEqual([]);
  });
});

/**
 * The attach-image button, which is the editor's handle rather than the
 * screen's string.
 *
 * It used to build the markdown in the screen and append it to the note, and a
 * figure chosen halfway through a paragraph landed underneath the whole thing.
 * The handle is bound here exactly as `MarkdownCodeEditor` and `CollabBodyHost`
 * bind it, so what runs is the real path.
 */
test.describe("attach image", () => {
  test("the handle exists while the editor is on screen", async ({ page }) => {
    const h = await open(page);
    expect(await h.hasHandle()).toBe(true);
  });

  test("an attached file lands at the caret, not at the end", async ({ page }) => {
    const h = await open(page, "instant");
    await act(page, `h.setDoc("before after"); h.setCursor(7); h.attach("figure.png")`);
    await settle(page, 120);
    expect(await h.doc()).toBe("before ![figure](vault:u/p/figure.png)after");
  });

  test("an attached file shows the same placeholder a pasted one does", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("note "); h.setCursor(5); h.attach("chart.png")`);
    await settle(page);
    expect(await h.doc()).toBe("note ![Uploading chart…]()");
    expect(await h.pending()).toBe(1);

    await act(page, `h.finish(0, "![chart](vault:u/p/chart.png)")`);
    await settle(page, 100);
    expect(await h.doc()).toBe("note ![chart](vault:u/p/chart.png)");
  });

  test("an attached file that is too large is refused the same way", async ({ page }) => {
    // The size limit lives with the upload path rather than with the button, so
    // the file dialog and the clipboard cannot disagree about it.
    const h = await open(page);
    await act(page, `h.attach("huge.png", 2 * 1024 * 1024)`);
    await settle(page, 80);
    expect(await h.doc()).toBe("");
    expect(await h.uploadCount()).toBe(0);
    expect((await h.errors())[0]).toMatch(/over the 1 MB limit/);
  });
});

test.describe("several carets", () => {
  test("a URL pasted at two carets lands at both, and is looked up once", async ({ page }) => {
    const h = await open(page);
    await act(page, `h.setDoc("a\\nb"); h.cursors([1, 3]); h.paste("https://x.example/p?utm_source=n")`);
    await settle(page);
    expect(await h.doc()).toBe("ahttps://x.example/p\nbhttps://x.example/p");
    // One keystroke is one lookup, and it follows the caret the writer is at.
    expect(await h.lookups()).toEqual(["title https://x.example/p"]);

    await act(page, `h.finishTitle(0, "A Page")`);
    await settle(page, 80);
    // The second insertion shifted the first; the title still lands on the
    // caret it was started for.
    expect(await h.doc()).toBe("ahttps://x.example/p\nb[A Page](https://x.example/p)");
  });
});
