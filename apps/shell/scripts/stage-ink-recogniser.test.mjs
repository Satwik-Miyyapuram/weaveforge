import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageInkRecogniser } from "./stage-ink-recogniser.mjs";

/** A `native/` root holding `ink-recogniser/win-<arch>/` with the given relative files. */
function nativeWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ink-native-"));
  for (const rel of files) {
    const p = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "x");
  }
  return root;
}

test("copies the exe and its sibling files into native/ink-recogniser/win-x64", () => {
  const native = nativeWith(["ink-recogniser/win-x64/ink-recogniser.exe", "ink-recogniser/win-x64/sibling.dll"]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ink-stage-"));
  try {
    const dest = stageInkRecogniser(native, stage, "x64");
    assert.equal(dest, path.join(stage, "native", "ink-recogniser", "win-x64"));
    assert.equal(fs.readFileSync(path.join(dest, "ink-recogniser.exe"), "utf8"), "x");
    assert.equal(fs.readFileSync(path.join(dest, "sibling.dll"), "utf8"), "x");
  } finally {
    fs.rmSync(native, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test("arm64 goes to win-arm64", () => {
  const native = nativeWith(["ink-recogniser/win-arm64/ink-recogniser.exe"]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ink-stage-"));
  try {
    const dest = stageInkRecogniser(native, stage, "arm64");
    assert.equal(dest, path.join(stage, "native", "ink-recogniser", "win-arm64"));
    assert.ok(fs.existsSync(path.join(dest, "ink-recogniser.exe")));
    assert.ok(!fs.existsSync(path.join(stage, "native", "ink-recogniser", "win-x64")));
  } finally {
    fs.rmSync(native, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test("throws when the exe is missing", () => {
  const native = nativeWith(["ink-recogniser/win-x64/sibling.dll"]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ink-stage-"));
  try {
    assert.throws(() => stageInkRecogniser(native, stage, "x64"), /build-ink-recogniser\.mjs/);
    assert.ok(!fs.existsSync(path.join(stage, "native")));
  } finally {
    fs.rmSync(native, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test("leaves other stage contents untouched", () => {
  const native = nativeWith(["ink-recogniser/win-x64/ink-recogniser.exe"]);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wf-ink-stage-"));
  try {
    fs.mkdirSync(path.join(stage, "postgres"), { recursive: true });
    fs.writeFileSync(path.join(stage, "postgres", "x.txt"), "x");
    stageInkRecogniser(native, stage, "x64");
    assert.equal(fs.readFileSync(path.join(stage, "postgres", "x.txt"), "utf8"), "x");
  } finally {
    fs.rmSync(native, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
});
