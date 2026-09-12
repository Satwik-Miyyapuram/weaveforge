/**
 * The folder's PDFs: a paper's bytes land at `papers/pdf/<id>.pdf` while a
 * folder is open, and the routed store hands the reader the folder then, the
 * browser cache otherwise.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryPdfByteCache, paperPdfPath } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import {
  RoutedPdfByteCache,
  WorkspacePdfStore,
} from "../infrastructure/workspace-pdf-store";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

test("a set lands in the folder at the paper's path and reads back the same bytes", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new WorkspacePdfStore(() => fs);
  await store.set("p1", bytes(37, 80, 68, 70));
  assert.ok(await fs.stat(paperPdfPath("p1")));
  assert.equal(paperPdfPath("p1"), "papers/pdf/p1.pdf");
  assert.deepEqual(new Uint8Array((await store.get("p1"))!), new Uint8Array([37, 80, 68, 70]));
  assert.equal(await store.size(), 1);
  await store.remove("p1");
  assert.equal(await store.get("p1"), null);
});

test("with no folder open the store is empty and a set is a no-op", async () => {
  const store = new WorkspacePdfStore(() => null);
  await store.set("p1", bytes(1));
  assert.equal(await store.get("p1"), null);
  assert.equal(await store.size(), 0);
});

test("the routed store picks the folder while one is open and the browser cache otherwise", async () => {
  let fs: MemoryWorkspaceFs | null = new MemoryWorkspaceFs();
  const folder = new WorkspacePdfStore(() => fs);
  const browser = new InMemoryPdfByteCache(4);
  const routed = new RoutedPdfByteCache(() => (fs ? folder : browser));
  await routed.set("p1", bytes(1));
  assert.ok(await fs.stat(paperPdfPath("p1")));
  assert.equal(await browser.get("p1"), null);
  fs = null;
  assert.equal(await routed.get("p1"), null);
  await routed.set("p2", bytes(2));
  assert.ok(await browser.get("p2"));
});
