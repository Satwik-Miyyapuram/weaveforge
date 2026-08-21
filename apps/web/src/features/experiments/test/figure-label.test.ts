import { test } from "node:test";
import assert from "node:assert/strict";
import { figureLabel } from "../ui/figure-label";

test("reads the filename out of an absolute artifact URL", () => {
  assert.equal(figureLabel("https://cdn.example.com/runs/7/loss%20curve.png", 0), "loss curve.png");
});

test("reads the filename out of a storage path", () => {
  assert.equal(figureLabel("u1/exp2/roc.png", 0), "roc.png");
});

test("drops a query string", () => {
  assert.equal(figureLabel("https://cdn.example.com/a/plot.png?sig=abc", 0), "plot.png");
});

test("keeps a malformed escape instead of throwing", () => {
  // `%zz` is a legal filename and an illegal escape; decoding it raises
  // URIError, which used to escape and take the panel down with it.
  assert.equal(figureLabel("https://cdn.example.com/a/a%zz.png", 0), "a%zz.png");
  assert.equal(figureLabel("u1/a%zz.png", 0), "a%zz.png");
});

test("falls back to a positional label when there is no filename", () => {
  assert.equal(figureLabel("https://cdn.example.com/", 4), "figure 5");
});
