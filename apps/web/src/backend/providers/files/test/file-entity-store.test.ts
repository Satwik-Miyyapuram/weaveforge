import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore } from "../file-entity-store";

before(loadTestCore);

interface Row {
  id: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  metrics: Record<string, unknown>;
  artifacts: string[];
  createdAt: string;
  resultNote?: string;
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: "0123456789abcdef",
    name: "Ablation",
    status: "planned",
    config: {},
    metrics: {},
    artifacts: [],
    createdAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

async function files(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of fs.walk("")) out.push(entry.path);
  return out.sort();
}

function setup(root = "thesis") {
  const fs = new MemoryWorkspaceFs();
  const store = new FileEntityStore<Row>(fs, () => root, "experiment");
  return { fs, store };
}

test("T4: a saved row reads back unchanged, at the codec's path", async () => {
  const { fs, store } = setup();
  const saved = row({ name: "Ünïcode — “run”", resultNote: "Line 1\nLine 2" });
  await store.save(saved);
  assert.deepEqual(await store.get(saved.id), saved);
  assert.deepEqual(await store.all(), [saved]);
  assert.deepEqual(await files(fs), [readyCore().entityPath("experiment", { ...saved }, "thesis")]);
});

test("the workspace root ('') keeps entity folders at the top", async () => {
  const { fs, store } = setup("");
  await store.save(row());
  const [path] = await files(fs);
  assert.ok(path?.startsWith("experiments/"), path);
});

test("duplicate titles get distinct files", async () => {
  const { fs, store } = setup();
  await store.save(row({ id: "aaaaaaaa1" }));
  await store.save(row({ id: "bbbbbbbb2" }));
  assert.equal((await files(fs)).length, 2);
  assert.equal((await store.all()).length, 2);
});

test("a save keeps the path and every key the kind does not own", async () => {
  const { fs, store } = setup();
  await store.save(row());
  const [path] = await files(fs);
  assert.ok(path);
  const text = await fs.readText(path);
  await fs.writeFile(path, text.replace("---\n", "---\nmine: hello\n"));
  await store.save(row({ name: "Renamed", status: "done" }));
  assert.deepEqual(await files(fs), [path]);
  const after = await fs.readText(path);
  assert.match(after, /mine: hello/);
  assert.equal((await store.get(row().id))?.name, "Renamed");
});

test("a save never overwrites a file changed on disk since it was read", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FileEntityStore<Row>(fs, () => "", "experiment");
  await store.save(row());
  const [path] = await files(fs);
  assert.ok(path);
  const original = fs.writeTextIf!.bind(fs);
  fs.writeTextIf = async (p, text, _expected) => original(p, text, "something else");
  await assert.rejects(store.save(row({ status: "done" })), /changed on disk/);
});

test("a filesystem without conditional writes refuses to save", async () => {
  const fs = new MemoryWorkspaceFs();
  (fs as { writeTextIf?: unknown }).writeTextIf = undefined;
  const store = new FileEntityStore<Row>(fs, () => "", "experiment");
  await assert.rejects(store.save(row()), /cannot save without overwriting/);
});

test("delete moves the file to .weaveforge/trash/<day>/, a second delete takes a fresh name", async () => {
  const { fs, store } = setup();
  await store.save(row());
  await store.delete(row().id);
  await store.save(row());
  await store.delete(row().id);
  const all = await files(fs);
  assert.equal(all.length, 2);
  assert.ok(all.every((p) => p.startsWith(".weaveforge/trash/")), all.join());
  assert.equal(await store.get(row().id), null);
  await store.delete("missing");
});

test("unreadable, empty, foreign and newer files are skipped, not fatal", async () => {
  const { fs, store } = setup();
  await store.save(row());
  await fs.writeFile("thesis/experiments/empty.experiment.md", "");
  await fs.writeFile("thesis/experiments/plain.md", "# just a note\n");
  await fs.writeFile(
    "thesis/experiments/log.log.md",
    "---\nweaveforge-id: x\nweaveforge-type: log_entry\n---\nbody\n",
  );
  await fs.writeFile(
    "thesis/experiments/newer.experiment.md",
    "---\nweaveforge-id: n\nweaveforge-type: experiment\nwf: 99\n---\n",
  );
  const warn = console.warn;
  const warned: unknown[] = [];
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    assert.deepEqual((await store.all()).map((r) => r.id), [row().id]);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1, "only the newer file is reported");
});

test("an empty or missing folder lists nothing", async () => {
  const { store } = setup();
  assert.deepEqual(await store.all(), []);
});

test("reads the exporter's shape: a 0.9.5 serializer file", async () => {
  const { fs, store } = setup("");
  await fs.writeFile(
    "experiments/run-a--e1.experiment.md",
    "---\nweaveforge-id: e1\nweaveforge-type: experiment\ntitle: Run A\nstatus: done\ncreated-at: 2026-01-01T00:00:00Z\n---\n## Result\n\nR text\n",
  );
  const got = await store.get("e1");
  assert.equal(got?.name, "Run A");
  assert.equal(got?.resultNote, "R text");
});

test("an unreadable file keeps its id and name: a save never overwrites or duplicates it", async () => {
  const { fs, store } = setup();
  await store.save(row());
  const [kept] = await files(fs);
  assert.ok(kept);
  const text = (await fs.readText(kept)).replace("wf: 3", "wf: 99");
  await fs.writeFile(kept, text);
  const warn = console.warn;
  console.warn = () => {};
  try {
    // The row's own file is unreadable now: refuse, rather than write a second file with the same id.
    await assert.rejects(store.save(row({ status: "done" })), /could not be read/);
    // Another item whose name would land on that exact file takes a different name.
    const clash = readyCore().entityPath("experiment", { id: "bbbbbbbb2", name: "Ablation" }, "thesis");
    const clashText = "---\nweaveforge-id: zzz\nweaveforge-type: experiment\nwf: 99\n---\n";
    await fs.writeFile(clash, clashText);
    await store.save(row({ id: "bbbbbbbb2" }));
    assert.equal(await fs.readText(clash), clashText);
  } finally {
    console.warn = warn;
  }
  assert.equal(await fs.readText(kept), text);
  assert.equal((await files(fs)).length, 3);
  assert.equal((await store.get("bbbbbbbb2"))?.name, "Ablation");
});

test("a read that fails (I/O) on the row's own file blocks the save: no duplicate id", async () => {
  const { fs, store } = setup();
  await store.save(row());
  const [path] = await files(fs);
  assert.ok(path);
  const realRead = fs.readText.bind(fs);
  fs.readText = async (p) => {
    if (p === path) throw new Error("EIO");
    return realRead(p);
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(store.save(row({ status: "done" })), /could not be read/);
  } finally {
    console.warn = warn;
  }
  assert.equal((await files(fs)).length, 1);
});

test("a concurrent readAll does not clear the refusal of an in-flight save", async () => {
  const { fs, store } = setup();
  await store.save(row());
  const [path] = await files(fs);
  assert.ok(path);
  const realRead = fs.readText.bind(fs);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fs.readText = async (p) => {
    if (p !== path) return realRead(p);
    calls += 1;
    if (calls === 1) {
      await gate;
      throw new Error("EIO");
    }
    return realRead(p);
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const saving = store.save(row({ status: "done" })).then(() => "saved", (e: Error) => e.message);
    while (calls < 1) await new Promise((r) => setImmediate(r));
    await store.readAll();
    release();
    assert.match(await saving, /could not be read/);
  } finally {
    console.warn = warn;
  }
  assert.equal((await files(fs)).length, 1);
});

test("a log entry whose codec path is taken gets a numbered name that keeps its --id", async () => {
  const fs = new MemoryWorkspaceFs();
  const store = new FileEntityStore<{ id: string; entryDate: string }>(fs, () => "thesis", "log_entry");
  const base = readyCore().entityPath("log_entry", { id: "logid01", entryDate: "2026-06-24" }, "thesis");
  await fs.writeFile(base, "# a hand-made note at that path\n");
  await store.save({ id: "logid01", entryDate: "2026-06-24" });
  const numbered = base.replace("--logid01", "-2--logid01");
  assert.equal(await fs.readText(base), "# a hand-made note at that path\n");
  assert.ok(await fs.stat(numbered), `expected ${numbered}`);
  assert.deepEqual(await store.get("logid01"), { id: "logid01", entryDate: "2026-06-24", body: "" });
});
