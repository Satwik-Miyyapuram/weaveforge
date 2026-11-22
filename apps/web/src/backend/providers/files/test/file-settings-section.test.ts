import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { openFileSettingsSection } from "../file-settings-section";

const ROOT = "ws";
const PATH = `${ROOT}/.weaveforge/settings.json`;
const PART = `${PATH}.part`;

/** Fails every write to the `.part` file, as a full disk or a revoked handle would. */
class FailingPartFs extends MemoryWorkspaceFs {
  failPart = false;
  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    if (this.failPart && path === PART) throw new Error("disk full");
    return super.writeFile(path, data);
  }
}

describe("file settings section: crash recovery of settings.json.part", () => {
  it("drops a half-written .part and keeps the last good settings.json", async () => {
    const fs = new MemoryWorkspaceFs();
    await fs.mkdirp(`${ROOT}/.weaveforge`);
    await fs.writeFile(PATH, JSON.stringify({ theme: "old" }));
    await fs.writeFile(PART, '{"theme": "ne');
    const s = await openFileSettingsSection(fs, ROOT);
    assert.equal(s.get(["theme"]), "old");
    assert.equal(await fs.stat(PART), null);
  });

  it("a complete .part from a crash before the rename is discarded; the committed settings.json stays", async () => {
    const fs = new MemoryWorkspaceFs();
    await fs.mkdirp(`${ROOT}/.weaveforge`);
    await fs.writeFile(PATH, JSON.stringify({ theme: "old" }));
    await fs.writeFile(PART, JSON.stringify({ theme: "new" }));
    const s = await openFileSettingsSection(fs, ROOT);
    assert.equal(s.get(["theme"]), "old");
    assert.equal(await fs.stat(PART), null);
    assert.equal(JSON.parse(await fs.readText(PATH)).theme, "old");
  });
});

describe("file settings section: corrupt settings.json", () => {
  it("moves a corrupt file aside, starts empty and reports a notice", async () => {
    const fs = new MemoryWorkspaceFs();
    await fs.mkdirp(`${ROOT}/.weaveforge`);
    await fs.writeFile(PATH, "{ not json");
    const s = await openFileSettingsSection(fs, ROOT);
    assert.equal(s.get(["theme"]), undefined);
    assert.ok(s.notice && s.notice.includes("settings.json.bad-"), String(s.notice));
    const moved = s.notice!.match(/settings\.json\.bad-\S+/)![0];
    assert.equal(await fs.readText(`${ROOT}/.weaveforge/${moved}`), "{ not json");
  });
});

describe("file settings section: persist errors", () => {
  let errors: unknown[][];
  let original: typeof console.error;
  beforeEach(() => {
    errors = [];
    original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
  });
  afterEach(() => {
    console.error = original;
  });

  it("does not swallow a failed write: flush rejects and the log names keys, not values", async () => {
    const fs = new FailingPartFs();
    const s = await openFileSettingsSection(fs, ROOT);
    fs.failPart = true;
    s.set(["appearance", "theme"], "super-secret-value-123");
    await assert.rejects(() => s.flush(), /disk full/);
    assert.ok(errors.length > 0, "failed write must be logged");
    const logged = JSON.stringify(errors);
    assert.ok(logged.includes("appearance.theme"));
    assert.equal(logged.includes("super-secret-value-123"), false);
  });
});

describe("file settings section: secret guard", () => {
  it("keeps author metadata legal (auth followed by 'or' is not a credential)", async () => {
    const fs = new MemoryWorkspaceFs();
    const s = await openFileSettingsSection(fs, ROOT);
    assert.doesNotThrow(() => s.set(["paper", "authors"], ["A. Writer"]));
    assert.doesNotThrow(() => s.set(["paper", "authorName"], "B"));
  });
});
