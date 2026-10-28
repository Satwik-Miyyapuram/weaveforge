import test from "node:test";
import assert from "node:assert/strict";
import { readWorkshopRequest } from "../infrastructure/overleaf-workshop-request";

const valid = { cookies: " overleaf_session2=abc ", projectId: "p1", rootResourcePath: "main.tex" };

test("a complete body is trimmed and accepted", () => {
  assert.deepEqual(readWorkshopRequest(valid), { ok: true, value: { cookies: "overleaf_session2=abc", projectId: "p1", rootResourcePath: "main.tex" } });
});

test("missing or blank cookies, project id or root file are rejected", () => {
  for (const bad of [{ ...valid, cookies: "" }, { ...valid, cookies: "   " }, { ...valid, cookies: 5 }, { ...valid, projectId: undefined }, { ...valid, rootResourcePath: " " }]) {
    assert.equal(readWorkshopRequest(bad).ok, false, JSON.stringify(bad));
  }
});

test("a project id with a path separator is rejected (it is spliced into a URL)", () => {
  assert.equal(readWorkshopRequest({ ...valid, projectId: "../admin" }).ok, false);
  assert.equal(readWorkshopRequest({ ...valid, projectId: "p1?x=1" }).ok, false);
});

test("a non-object body is rejected", () => {
  assert.equal(readWorkshopRequest(null).ok, false);
  assert.equal(readWorkshopRequest("text").ok, false);
});
