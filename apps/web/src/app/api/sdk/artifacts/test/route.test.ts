import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import {
  MAX_ARTIFACT_BYTES,
  MAX_BODY_BYTES,
  base64ByteLength,
  exceedsDeclaredLimit,
  isSafeSegment,
  parseArtifactRequest,
} from "../artifact-request";

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

// -------------------------------------------------------------- path safety

test("a name carrying a path separator is refused", () => {
  for (const name of ["../escape", "a/b", "a\\b", "..", ".", "/etc/passwd"]) {
    assert.equal(isSafeSegment(name), false, `${name} should not be a safe segment`);
  }
});

test("an experiment id carrying a separator is refused", () => {
  const result = parseArtifactRequest({
    experimentId: "../../other-user",
    name: "loss.png",
    dataBase64: b64(8),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /path separators/);
});

test("ordinary filenames are accepted", () => {
  for (const name of ["loss.png", "metrics_final.json", "run-3.csv", "a"]) {
    assert.equal(isSafeSegment(name), true, `${name} should be a safe segment`);
  }
});

test("an absurdly long segment is refused", () => {
  assert.equal(isSafeSegment("a".repeat(129)), false);
  assert.equal(isSafeSegment("a".repeat(128)), true);
});

// --------------------------------------------------------------- size limits

test("the decoded size is estimated without decoding", () => {
  assert.equal(base64ByteLength(b64(3_000)), 3_000);
  assert.equal(base64ByteLength(b64(1)), 1);
  assert.equal(base64ByteLength(""), 0);
});

test("an oversized artifact is refused with 413", () => {
  const result = parseArtifactRequest({
    experimentId: "e1",
    name: "weights.bin",
    dataBase64: b64(MAX_ARTIFACT_BYTES + 1_024),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.match(result.error, /exceeds the 25 MB limit/);
  }
});

test("an artifact at the limit is accepted", () => {
  const result = parseArtifactRequest({
    experimentId: "e1",
    name: "plot.png",
    dataBase64: b64(MAX_ARTIFACT_BYTES),
  });
  assert.equal(result.ok, true);
});

test("a declared body length past the limit is caught before the body is read", () => {
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES + 1)), true);
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES)), false);
  assert.equal(exceedsDeclaredLimit(null), false, "an absent header is not a claim to reject on");
  assert.equal(exceedsDeclaredLimit("not a number"), false);
});

test("an unauthenticated upload never reaches the size gate or storage", async () => {
  const response = await POST(
    new Request("http://localhost/api/sdk/artifacts", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES * 4) },
      body: "{}",
    }),
  );

  // Auth first, deliberately: an anonymous caller must not be able to probe
  // the limit, and must not be able to make the route buffer anything.
  assert.equal(response.status, 401);
});

// -------------------------------------------------------------- other fields

test("a missing field is named rather than being a generic failure", () => {
  const result = parseArtifactRequest({ experimentId: "e1", name: "a.png" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /experimentId, name, dataBase64/);
});

test("a non-string payload is refused", () => {
  const result = parseArtifactRequest({ experimentId: "e1", name: "a.png", dataBase64: 12 });
  assert.equal(result.ok, false);
});

test("a payload that decodes to nothing is refused", () => {
  const result = parseArtifactRequest({ experimentId: "e1", name: "a.png", dataBase64: "!!!!" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no bytes/);
});

test("a body that is not an object is refused", () => {
  assert.equal(parseArtifactRequest(null).ok, false);
  assert.equal(parseArtifactRequest("string").ok, false);
});

test("an absent content type falls back to bytes, never to something renderable", () => {
  const result = parseArtifactRequest({ experimentId: "e1", name: "a.png", dataBase64: b64(8) });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.contentType, "application/octet-stream");
});
