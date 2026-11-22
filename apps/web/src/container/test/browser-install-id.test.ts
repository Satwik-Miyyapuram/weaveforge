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
    async remove(path: string): Promise<void> {
      files.delete(path);
    },
  };
}

/** A lock manager that grants every request at once, as navigator.locks does with no contention. */
const grantedLocks = { request: <T>(_name: string, callback: () => Promise<T>) => callback() };

/** Runs readOrCreateInstallId as a tab that holds the install-id lock. */
function createId(fs: ReturnType<typeof folder>, newId: () => string): Promise<string> {
  return withLocks(grantedLocks, () => readOrCreateInstallId(fs, newId));
}

test("the install id lives under the gitignored .weaveforge/local/ folder", () => {
  assert.equal(INSTALL_ID_PATH, ".weaveforge/local/install-id");
});

test("first use creates an id and stores it", async () => {
  const fs = folder();
  const id = await createId(fs, () => "web-first-id");
  assert.equal(id, "web-first-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-first-id");
});

test("later uses return the same stored id and do not create a new one", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "web-stored-id\n" });
  let created = 0;
  const id = await createId(fs, () => {
    created += 1;
    return "web-new-id";
  });
  assert.equal(id, "web-stored-id");
  assert.equal(created, 0);
});

test("a stored id that is not a plain token is replaced", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "../../etc" });
  assert.equal(await createId(fs, () => "web-clean-id"), "web-clean-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-clean-id");
});

/** Makes only the first read fail with `error`, so the read-back after the rename still works. */
function absentOnFirstRead(fs: ReturnType<typeof folder>, error: () => unknown): void {
  const readFile = fs.readText.bind(fs);
  let first = true;
  fs.readText = async (path: string) => {
    if (first) {
      first = false;
      throw error();
    }
    return readFile(path);
  };
}

test("a NotFoundError (DOMException name) reads as absent and a new id is created", async () => {
  const fs = folder();
  absentOnFirstRead(fs, () => new DOMException("A requested file or directory could not be found.", "NotFoundError"));
  assert.equal(await createId(fs, () => "web-dom-missing-id"), "web-dom-missing-id");
});

test("an error with code ENOENT reads as absent and a new id is created", async () => {
  const fs = folder();
  absentOnFirstRead(fs, () => Object.assign(new Error("gone"), { code: "ENOENT" }));
  assert.equal(await createId(fs, () => "web-code-missing-id"), "web-code-missing-id");
});

test("a read error other than not-found refuses and does not replace the stored id", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "web-kept-id" });
  fs.readText = async () => {
    throw Object.assign(new Error("I/O error"), { code: "EIO" });
  };
  await assert.rejects(createId(fs, () => "web-rotated-id"), /I\/O error/);
  assert.equal(fs.renames.length, 0);
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-kept-id");
});

test("a rename that fails removes the temp file, rejects, and writes no id", async () => {
  const fs = folder();
  fs.rename = async () => {
    throw new Error("rename refused");
  };
  await assert.rejects(createId(fs, () => "web-lost-id"), /rename refused/);
  assert.equal(fs.files.get(INSTALL_ID_PATH), undefined);
  assert.deepEqual(
    [...fs.files.keys()].filter((path) => path.endsWith(".part")),
    [],
  );
});

test("a failed write rejects, so the caller can fail closed", async () => {
  const fs = folder();
  fs.writeFile = async () => {
    throw new Error("quota");
  };
  await assert.rejects(createId(fs, () => "web-x"), /quota/);
});

test("the id is written to a temp file and renamed into place", async () => {
  const fs = folder();
  await createId(fs, () => "web-atomic-id");
  assert.equal(fs.renames.length, 1);
  const [from, to] = fs.renames[0] as [string, string];
  assert.equal(to, INSTALL_ID_PATH);
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-atomic-id");
  assert.equal(fs.files.has(from), false);
});

test("each create uses its own temp file name, so two creates never share one", async () => {
  const fs = folder();
  await createId(fs, () => "web-same-id");
  fs.files.delete(INSTALL_ID_PATH);
  await createId(fs, () => "web-same-id");
  assert.equal(fs.renames.length, 2);
  assert.notEqual(fs.renames[0]?.[0], fs.renames[1]?.[0]);
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

test("without navigator.locks the id is refused, not created unlocked", async () => {
  const fs = folder({ [INSTALL_ID_PATH]: "web-stored-id" });
  await assert.rejects(
    withLocks(undefined, () => readOrCreateInstallId(fs, () => "web-unlocked-id")),
    /navigator\.locks/,
  );
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-stored-id");
  assert.equal(fs.renames.length, 0);
});

test("a SecurityError from navigator.locks that was never granted refuses and writes no id", async () => {
  const denied = Object.assign(new Error("lock denied"), { name: "SecurityError" });
  const fs = folder();
  await assert.rejects(
    withLocks(rejectingLocks(denied), () => readOrCreateInstallId(fs, () => "web-fallback-id")),
    /lock denied/,
  );
  assert.equal(fs.files.size, 0);
});

test("a SecurityError raised by the file work after the lock is granted fails closed and writes no id", async () => {
  const fs = folder();
  const realWrite = fs.writeFile;
  let writes = 0;
  fs.writeFile = async (path: string, data: Uint8Array | string) => {
    writes += 1;
    // Only the first write is denied, so a wrong fallback would retry and succeed.
    if (writes === 1) throw Object.assign(new Error("file denied"), { name: "SecurityError" });
    return realWrite(path, data);
  };
  const lockGranted = { request: <T>(_name: string, callback: () => Promise<T>) => callback() };
  await assert.rejects(
    withLocks(lockGranted, () => readOrCreateInstallId(fs, () => "web-granted")),
    (error: unknown) => (error as { name?: unknown }).name === "SecurityError",
  );
  assert.equal(fs.files.has(INSTALL_ID_PATH), false);
  assert.equal(writes, 1, "no retry through the unlocked path after the lock was granted");
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
  const id = await createId(fs, () => "web-this-tab-id");
  assert.equal(id, "web-other-tab-id");
  assert.equal(fs.files.get(INSTALL_ID_PATH), "web-other-tab-id");
});
