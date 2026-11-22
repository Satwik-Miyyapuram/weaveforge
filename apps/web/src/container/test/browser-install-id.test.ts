import assert from "node:assert/strict";
import { test } from "node:test";

import { INSTALL_ID_PATH, readOrCreateInstallId } from "../browser-install-id";

/**
 * An in-memory folder that throws ENOENT for a missing file, as BrowserWorkspaceFs does. `renames`
 * records every rename. `otherTabWritesAfterRename`, when set, stands for a second tab that stores
 * its own id right after this tab's rename.
 */
function folder(initial: Record<string, string> = {}, otherTabWritesAfterRename?: string) {
  const files = new Map(Object.entries(initial));
  const renames: Array<[string, string]> = [];
  return {
    files,
    renames,
    async readText(path: string): Promise<string> {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    async writeFile(path: string, data: Uint8Array | string): Promise<void> {
      files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    async rename(from: string, to: string): Promise<void> {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
      renames.push([from, to]);
      if (otherTabWritesAfterRename !== undefined) files.set(to, otherTabWritesAfterRename);
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

test("the id is written to a temp file and renamed into place", async () => {
  const fs = folder();
  await readOrCreateInstallId(fs, () => "web-atomic-id");
  assert.deepEqual(fs.renames, [[`${INSTALL_ID_PATH}.part`, INSTALL_ID_PATH]]);
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-atomic-id");
  assert.equal(fs.files.has(`${INSTALL_ID_PATH}.part`), false);
});

/** A lock manager that runs each request after the previous one finishes, as navigator.locks does. */
function serialisingLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const run = tail.then(() => callback());
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

test("with navigator.locks, two concurrent calls are serialised and both return the same id", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { locks: serialisingLocks() }, configurable: true });
  try {
    const fs = folder();
    const [a, b] = await Promise.all([
      readOrCreateInstallId(fs, () => "web-lock-a"),
      readOrCreateInstallId(fs, () => "web-lock-b"),
    ]);
    assert.equal(a, "web-lock-a");
    assert.equal(b, "web-lock-a");
    assert.equal(fs.files.get(INSTALL_ID_PATH), "web-lock-a");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

/** Runs `run` with navigator.locks replaced by `locks`, then restores navigator. */
async function withLocks<T>(locks: unknown, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  try {
    return await run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

/** A lock manager whose every request rejects with the given error, as a denied lock does. */
function rejectingLocks(error: unknown) {
  return {
    request<T>(_name: string, _callback: () => Promise<T>): Promise<T> {
      return Promise.reject(error);
    },
  };
}

test("a SecurityError from navigator.locks falls back to the unlocked path and still returns an id", async () => {
  const denied = Object.assign(new Error("lock denied"), { name: "SecurityError" });
  const fs = folder();
  const id = await withLocks(rejectingLocks(denied), () => readOrCreateInstallId(fs, () => "web-fallback-id"));
  assert.equal(id, "web-fallback-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-fallback-id");
});

test("any other navigator.locks rejection still fails closed and writes no id", async () => {
  const fs = folder();
  await assert.rejects(
    withLocks(rejectingLocks(new Error("lock broke")), () => readOrCreateInstallId(fs, () => "web-x")),
    /lock broke/,
  );
  assert.equal(fs.files.size, 0);
});

test("two tabs creating an id at once both return the id that ended up stored", async () => {
  const fs = folder({}, "web-other-tab-id");
  const id = await readOrCreateInstallId(fs, () => "web-this-tab-id");
  assert.equal(id, "web-other-tab-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-other-tab-id");
});
