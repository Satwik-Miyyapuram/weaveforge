import { strict as assert } from "node:assert";
import { test } from "node:test";

import { readerPrintDocument, readerPrintOrientation } from "../reader-print";

const note = { top: 50, colour: "#ffd400", quote: "a line", comment: "why <this>?" };
const page = (notes = [note]) => ({ image: "data:image/jpeg;base64,AA", width: 100, height: 200, notes });

test("comments print landscape, and only when there are any", () => {
  assert.equal(readerPrintOrientation(true, [page()]), "landscape");
  assert.equal(readerPrintOrientation(true, [page([])]), "portrait");
  assert.equal(readerPrintOrientation(false, [page()]), "portrait");
});

test("with comments the cards sit beside the page, level with their mark", () => {
  const html = readerPrintDocument({ title: "Paper", pages: [page()], withComments: true });
  assert.match(html, /size: A4 landscape/);
  assert.match(html, /class="note" style="top:25\.000%/);
  assert.match(html, /why &lt;this&gt;\?/);
});

test("without comments the page is fitted to a portrait sheet and no card is drawn", () => {
  const html = readerPrintDocument({ title: "Paper", pages: [page(), page()], withComments: false });
  assert.match(html, /size: A4 portrait/);
  assert.doesNotMatch(html, /class="note"/);
  assert.equal(html.match(/class="sheet"/g)?.length, 2);
});

test("a colour that is not a colour does not reach the style attribute", () => {
  const bad = { ...note, colour: 'red;background:url("x")' };
  const html = readerPrintDocument({ title: "P", pages: [page([bad])], withComments: true });
  assert.doesNotMatch(html, /url\(/);
});

test("a sheet is a bare A4: no page margin and no frame round the page", () => {
  const html = readerPrintDocument({ title: "P", pages: [page()], withComments: true });
  assert.match(html, /margin: 0; \}/);
  assert.doesNotMatch(html, /img \{[^}]*border/);
  assert.doesNotMatch(html, /\.note \{[^}]*border: /);
});
