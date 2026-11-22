import assert from "node:assert/strict";
import { test } from "node:test";

import { INSTALL_ID_PATH, readOrCreateInstallId } from "../browser-install-id";

/** An in-memory folder that throws ENOENT for a missing file, as BrowserWorkspaceFs does. */
function folder(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async readText(path: string): Promise<string> {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
      files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
  };
}

test("the install id lives under the gitignored .weaveforge/local/ folder", () => {
  assert.equal(INSTALL_ID_PATH, ".weaveforge/local/install-id");
});

test("first use creates an id and stores it", async () => {
  const fs = folder();
  const id = await readOrCreateInstallId(fs, () => "web-first-id");
  assert.equal(id, "web-first-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-first-id");
});

test("later uses return the same stored id and do not create a new one", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "web-stored-id\n" });
  let created = 0;
  const id = await readOrCreateInstallId(fs, () => {
    created += 1;
    return "web-new-id";
  });
  assert.equal(id, "web-stored-id");
  assert.equal(created, 0);
});

test("a stored id that is not a plain token is replaced", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "../../etc" });
  assert.equal(await readOrCreateInstallId(fs, () => "web-clean-id"), "web-clean-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-clean-id");
});

test("a failed write rejects, so the caller can fail closed", async () => {
  const fs = folder();
  fs.writeFile = async () => {
    throw new Error("quota");
  };
  await assert.rejects(readOrCreateInstallId(fs, () => "web-x"), /quota/);
});
