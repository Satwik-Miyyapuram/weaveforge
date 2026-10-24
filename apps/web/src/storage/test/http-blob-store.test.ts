/**
 * The browser blob adapter (B58).
 *
 * - 10-10: a refused signed-url batch is still all-null, but no longer silent.
 * - 10-11: batches go out together, and the answer keeps the caller's order.
 * - 10-12: upload and delete keep their own failure messages.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { HttpBlobStore } from "../providers/http/http-blob-store";
import { withEnv } from "./with-env";

type Log = { level: string; source: string; message: string; detail?: string };

const store = () => new HttpBlobStore(async () => "tok");

async function withDesktopLog<T>(run: (logs: Log[]) => Promise<T>): Promise<T> {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const before = g.window;
  // `desktop()` checks the bridge by shape, so it needs `fetchTitle` too.
  g.window = { weaveforge: { fetchTitle: async () => null, reportAppLog: (entry: Log) => void logs.push(entry) } };
  try {
    return await run(logs);
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const answering = (make: () => Response) => (async () => make()) as unknown as typeof fetch;

test("a refused batch is all null and logged once (10-10)", async () => {
  await withDesktopLog(async (logs) => {
    const urls = await withEnv(
      {},
      () => store().signedUrls("paper-images", ["a", "b"], 60),
      answering(() => json({ error: "boom" }, 500)),
    );
    assert.deepEqual(urls, [null, null]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.level, "warn");
    assert.match(logs[0]!.detail ?? "", /500/);
  });
});

test("a good batch returns its urls in order and logs nothing", async () => {
  await withDesktopLog(async (logs) => {
    const urls = await withEnv(
      {},
      () => store().signedUrls("paper-images", ["a", "b"], 60),
      answering(() => json({ urls: ["u-a", null] })),
    );
    assert.deepEqual(urls, ["u-a", null]);
    assert.deepEqual(logs, []);
  });
});

test("no paths sends nothing", async () => {
  let calls = 0;
  const urls = await withEnv(
    {},
    () => store().signedUrls("paper-images", [], 60),
    answering(() => {
      calls += 1;
      return json({ urls: [] });
    }),
  );
  assert.deepEqual(urls, []);
  assert.equal(calls, 0);
});

test("450 paths go out as 3 requests at once, answered in input order (10-11)", async () => {
  const paths = Array.from({ length: 450 }, (_, i) => `p${i}`);
  const pending: { paths: string[]; resolve: (r: Response) => void }[] = [];
  const fetchStub = ((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      pending.push({ paths: (JSON.parse(String(init.body)) as { paths: string[] }).paths, resolve });
    })) as unknown as typeof fetch;
  const urls = await withEnv(
    {},
    async () => {
      const result = store().signedUrls("paper-images", paths, 60);
      for (let i = 0; i < 20 && pending.length < 3; i++) await new Promise((r) => setTimeout(r, 0));
      assert.equal(pending.length, 3, "every batch is in flight before any answers");
      assert.deepEqual(
        pending.map((p) => p.paths.length),
        [200, 200, 50],
      );
      // Answer last first, so the order cannot come from arrival.
      for (const p of [...pending].reverse()) p.resolve(json({ urls: p.paths.map((x) => `u-${x}`) }));
      return result;
    },
    fetchStub,
  );
  assert.deepEqual(
    urls,
    paths.map((p) => `u-${p}`),
  );
});

test("upload and delete keep their own failure messages (10-12)", async () => {
  await withEnv(
    {},
    async () => {
      await assert.rejects(store().upload("paper-images", "u/p/x.png", new Blob(["x"])), {
        message: "Upload failed (500)",
      });
      await assert.rejects(store().remove("paper-images", "u/p/x.png"), { message: "Delete failed (500)" });
    },
    answering(() => new Response("", { status: 500 })),
  );
  await withEnv(
    {},
    async () => {
      await assert.rejects(store().upload("paper-images", "u/p/x.png", new Blob(["x"])), {
        message: "Forbidden blob path.",
      });
      await assert.rejects(store().remove("paper-images", "u/p/x.png"), { message: "Forbidden blob path." });
    },
    answering(() => json({ error: "Forbidden blob path." }, 403)),
  );
});

test("an ok upload and delete resolve", async () => {
  await withEnv(
    {},
    async () => {
      await store().upload("paper-images", "u/p/x.png", new Blob(["x"]), "image/png");
      await store().remove("paper-images", "u/p/x.png");
    },
    answering(() => json({})),
  );
});

test("no session is refused before any request", async () => {
  let calls = 0;
  await withEnv(
    {},
    async () => {
      await assert.rejects(new HttpBlobStore(async () => null).remove("b", "p"), { message: "Not authenticated." });
    },
    answering(() => {
      calls += 1;
      return json({});
    }),
  );
  assert.equal(calls, 0);
});
