import test from "node:test";
import assert from "node:assert/strict";
import { readWorkshopRequest, readWorkshopSessionId } from "../infrastructure/overleaf-workshop-request";

const SESSION = "3f6c2a9e-1b2d-4c5e-8f70-123456789abc";
const valid = { sessionId: SESSION, projectId: "p1", rootResourcePath: " main.tex " };

test("a complete body is trimmed and accepted", () => {
  assert.deepEqual(readWorkshopRequest(valid), { ok: true, value: { sessionId: SESSION, projectId: "p1", rootResourcePath: "main.tex" } });
});

test("missing or malformed session ids are rejected", () => {
  for (const bad of [{ ...valid, sessionId: undefined }, { ...valid, sessionId: "" }, { ...valid, sessionId: 5 }, { ...valid, sessionId: "../x" }]) {
    assert.equal(readWorkshopRequest(bad).ok, false, JSON.stringify(bad));
  }
});

test("a raw cookie in the body is not accepted in place of a session id", () => {
  assert.equal(readWorkshopRequest({ cookies: "overleaf_session2=abc", projectId: "p1", rootResourcePath: "main.tex" }).ok, false);
});

test("missing project id or blank root file are rejected", () => {
  for (const bad of [{ ...valid, projectId: undefined }, { ...valid, rootResourcePath: " " }]) {
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

test("readWorkshopSessionId accepts only a uuid session id", () => {
  assert.deepEqual(readWorkshopSessionId({ sessionId: SESSION }), { ok: true, value: SESSION });
  assert.equal(readWorkshopSessionId({ sessionId: "not-a-uuid" }).ok, false);
  assert.equal(readWorkshopSessionId({ cookies: "a=b" }).ok, false);
  assert.equal(readWorkshopSessionId(null).ok, false);
});
