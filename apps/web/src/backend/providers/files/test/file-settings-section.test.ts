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

describe("file settings section: concurrent writers", () => {
  it("two concurrent saves of different keys from separate handles both survive", async () => {
    const fs = new MemoryWorkspaceFs();
    const a = await openFileSettingsSection(fs, ROOT);
    const b = await openFileSettingsSection(fs, ROOT);
    await Promise.all([a.set(["zoteroLibrary"], "users/1"), b.set(["appearance"], { mode: "dark" })]);
    const reopened = await openFileSettingsSection(fs, ROOT);
    assert.equal(reopened.get(["zoteroLibrary"]), "users/1");
    assert.deepEqual(reopened.get(["appearance"]), { mode: "dark" });
  });

  it("a failed write rejects the set that caused it", async () => {
    const fs = new FailingPartFs();
    await fs.mkdirp(`${ROOT}/.weaveforge`);
    const s = await openFileSettingsSection(fs, ROOT);
    fs.failPart = true;
    await assert.rejects(s.set(["theme"], "dark"), /disk full/);
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
    const write = s.set(["appearance", "theme"], "super-secret-value-123").catch(() => undefined);
    await assert.rejects(() => s.flush(), /disk full/);
    await write;
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

describe("file settings section: browser root", () => {
  it("with the empty OPFS root, writes .weaveforge/settings.json without a leading slash", async () => {
    const fs = new MemoryWorkspaceFs();
    const s = await openFileSettingsSection(fs, "");
    s.set(["theme"], "dark");
    await s.flush();
    assert.equal(await fs.stat(".weaveforge/settings.json") !== null, true);
    const again = await openFileSettingsSection(fs, "");
    assert.equal(again.get(["theme"]), "dark");
  });
});

describe("file settings section: P2/P3 write ordering, cross-writer, rollback", () => {
  it("a queued set is not lost when an earlier set finishes first", async () => {
    const fs = new MemoryWorkspaceFs();
    const s = await openFileSettingsSection(fs, ROOT);
    const a = s.set(["a"], 1);
    const b = s.set(["b"], 2);
    await a;
    assert.equal(s.get(["b"]), 2);
    await b;
    assert.equal(s.get(["b"]), 2);
    assert.equal(JSON.parse(await fs.readText(PATH)).b, 2);
  });

  it("a change another writer makes between read and rename is re-applied, not overwritten", async () => {
    class OtherWriterFs extends MemoryWorkspaceFs {
      inject = true;
      override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        if (this.inject && path === PART) {
          this.inject = false;
          await super.writeFile(PATH, JSON.stringify({ other: 1 }));
        }
        return super.writeFile(path, data);
      }
    }
    const fs = new OtherWriterFs();
    const s = await openFileSettingsSection(fs, ROOT);
    await s.set(["mine"], "x");
    const disk = JSON.parse(await fs.readText(PATH));
    assert.equal(disk.other, 1);
    assert.equal(disk.mine, "x");
  });

  it("gives up after three tries when the file keeps changing, and rejects", async () => {
    class ChurningFs extends MemoryWorkspaceFs {
      override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
        if (path === PART) await super.writeFile(PATH, JSON.stringify({ churn: Math.random() }));
        return super.writeFile(path, data);
      }
    }
    const s = await openFileSettingsSection(new ChurningFs(), ROOT);
    await assert.rejects(s.set(["mine"], "x"), /another writer|tries/);
  });

  it("a failed write rolls the in-memory value back to what was committed", async () => {
    const fs = new FailingPartFs();
    const s = await openFileSettingsSection(fs, ROOT);
    await s.set(["theme"], "old");
    fs.failPart = true;
    await assert.rejects(s.set(["theme"], "new"));
    assert.equal(s.get(["theme"]), "old");
  });

  it("an unreadable settings.json written by someone else is moved aside, and the in-session value is kept", async () => {
    const fs = new MemoryWorkspaceFs();
    const s = await openFileSettingsSection(fs, ROOT);
    await s.set(["kept"], "yes");
    await fs.writeFile(PATH, "{not json");
    await s.set(["after"], 1);
    const disk = JSON.parse(await fs.readText(PATH));
    assert.equal(disk.kept, "yes");
    assert.equal(disk.after, 1);
  });
});
