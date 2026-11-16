/**
 * An import preview names each file it left out and says why.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { SkippedFiles } from "../ui/skipped-files";

function text(skipped: { path: string; reason: string }[]): string {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(SkippedFiles, { skipped }));
  });
  const json = JSON.stringify(r.toJSON());
  act(() => r.unmount());
  return json;
}

test("each left-out file is named with its reason", () => {
  const out = text([
    { path: "assets/big.bin", reason: "it is over the 32 MB file limit" },
    { path: "../evil", reason: "its name could reach outside the folder" },
  ]);
  assert.match(out, /"2"," file","s"," left out"/);
  assert.match(out, /assets\/big\.bin.*it is over the 32 MB file limit/);
  assert.match(out, /\.\.\/evil.*its name could reach outside the folder/);
});

test("one file reads singular", () => {
  assert.match(text([{ path: "a", reason: "r" }]), /"1"," file",""," left out"|"1"," file"," left out"/);
});

test("nothing left out shows nothing", () => {
  assert.equal(text([]), "null");
});

test("past ten files the rest are counted, not named", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ path: `f${i}`, reason: "r" }));
  const out = text(many);
  assert.match(out, /f9/);
  assert.doesNotMatch(out, /f10/);
  assert.match(out, /"and ","3"," more"/);
});
