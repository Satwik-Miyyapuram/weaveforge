import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { findUpdate, isNewer, newestRelease, parseTag, parseVersion, type Release } from "../src/update-check";

const release = (tag: string, extra: Partial<Release> = {}): Release => ({
  tag_name: tag,
  html_url: `https://example.invalid/${tag}`,
  ...extra,
});

describe("parseTag", () => {
  it("reads a desktop release tag", () => {
    assert.deepEqual(parseTag("v0.5.2"), [0, 5, 2]);
    assert.deepEqual(parseTag("  v1.0.0 "), [1, 0, 0]);
  });

  it("refuses the Android tags in the same repository", () => {
    // The whole reason this is strict: `android-v0.9.0` is newer than every
    // desktop release and would send desktop readers to download an APK.
    assert.equal(parseTag("android-v0.9.0"), null);
    assert.equal(parseTag("v0.5"), null);
    assert.equal(parseTag("0.5.2"), null);
    assert.equal(parseTag(""), null);
  });
});

describe("parseVersion", () => {
  it("reads the version a build was stamped with", () => {
    assert.deepEqual(parseVersion("0.5.2"), [0, 5, 2]);
    assert.equal(parseVersion("0.5.2-beta"), null);
  });
});

describe("isNewer", () => {
  it("compares by component, not by string", () => {
    assert.equal(isNewer([0, 10, 0], [0, 9, 9]), true);
    assert.equal(isNewer([1, 0, 0], [0, 99, 99]), true);
    assert.equal(isNewer([0, 5, 3], [0, 5, 2]), true);
  });

  it("is false for equal and for older", () => {
    assert.equal(isNewer([0, 5, 2], [0, 5, 2]), false);
    assert.equal(isNewer([0, 5, 1], [0, 5, 2]), false);
  });
});

describe("newestRelease", () => {
  it("picks the highest version, not the first in the list", () => {
    // GitHub returns releases newest-created first, so a patch to an old line
    // published today sits above the current minor.
    const found = newestRelease([release("v0.4.9"), release("v0.6.0"), release("v0.5.2")]);
    assert.deepEqual(found?.version, [0, 6, 0]);
  });

  it("skips drafts, pre-releases and other platforms", () => {
    const found = newestRelease([
      release("android-v9.9.9"),
      release("v0.9.0", { prerelease: true }),
      release("v0.8.0", { draft: true }),
      release("v0.5.2"),
    ]);
    assert.deepEqual(found?.version, [0, 5, 2]);
  });

  it("is null when nothing in the list is a desktop release", () => {
    assert.equal(newestRelease([release("android-v1.0.0")]), null);
    assert.equal(newestRelease([]), null);
  });
});

describe("findUpdate", () => {
  const releases = [release("v0.6.0"), release("v0.5.2")];

  it("announces a newer release", async () => {
    const update = await findUpdate({
      currentVersion: "0.5.2",
      fetchReleases: async () => releases,
    });
    assert.deepEqual(update, { version: "0.6.0", url: "https://example.invalid/v0.6.0" });
  });

  it("says nothing when the installed version is current or ahead", async () => {
    for (const currentVersion of ["0.6.0", "0.7.0"]) {
      const update = await findUpdate({
        currentVersion,
        fetchReleases: async () => releases,
      });
      assert.equal(update, null, currentVersion);
    }
  });

  it("keeps offering the same release, every time", async () => {
    // Deliberate. A dismissed dialog does not make a stale shell less stale,
    // and the failure this exists to prevent is a machine that was told once,
    // months ago, and is now running a preload the server no longer matches.
    const deps = { currentVersion: "0.5.2", fetchReleases: async () => releases };
    assert.equal((await findUpdate(deps))?.version, "0.6.0");
    assert.equal((await findUpdate(deps))?.version, "0.6.0");
  });

  it("stays quiet when GitHub cannot be reached", async () => {
    // A courtesy, not a dependency: an unreachable network must not surface as
    // an error dialog on a shell that is working perfectly well.
    const update = await findUpdate({
      currentVersion: "0.5.2",
      fetchReleases: async () => { throw new Error("ENOTFOUND"); },
    });
    assert.equal(update, null);
  });

  it("stays quiet when its own version is unreadable", async () => {
    const update = await findUpdate({
      currentVersion: "not-a-version",
      fetchReleases: async () => releases,
    });
    assert.equal(update, null);
  });
});
