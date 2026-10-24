/**
 * The repository read memo (`cacheRepo`): what it may keep, and for how long.
 *
 * A read that started before a write must not memoise the pre-write answer,
 * and a memoised answer must not outlive the screen's revalidation window, or
 * revalidation never reaches the network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheRepo } from "@/lib/cache/cache-repo";
import { SCREEN_REVALIDATE_AFTER_MS } from "@/lib/cache/cache-policy";
import { invalidateAllRepoCaches, invalidateForWrite } from "@/lib/cache/project-lww-invalidator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A repo whose `list` answers are handed out one at a time by the test. */
function makeRepo() {
  const answers: Array<ReturnType<typeof deferred<string>>> = [];
  let calls = 0;
  const inner = {
    list: () => {
      calls += 1;
      const next = deferred<string>();
      answers.push(next);
      return next.promise;
    },
    save: async (value: string) => value,
  };
  const repo = cacheRepo(inner, ["list"], ["save"], () => "p1", { resourceType: "paper" });
  return { repo, answers, calls: () => calls };
}

test("cache repo: a read in flight across a write does not memoise the old answer", async () => {
  const { repo, answers, calls } = makeRepo();
  const before = repo.list();
  await repo.save("new");
  answers[0]!.resolve("old");
  assert.equal(await before, "old", "the caller that asked still gets its answer");

  const after = repo.list();
  assert.equal(calls(), 2, "the next read goes back to the store");
  answers[1]!.resolve("new");
  assert.equal(await after, "new");
});

test("cache repo: a read in flight across invalidateForWrite does not memoise", async () => {
  const { repo, answers, calls } = makeRepo();
  const before = repo.list();
  invalidateForWrite("paper");
  answers[0]!.resolve("old");
  await before;
  void repo.list();
  assert.equal(calls(), 2);
});

test("cache repo: a read in flight across invalidateAllRepoCaches does not memoise", async () => {
  const { repo, answers, calls } = makeRepo();
  const before = repo.list();
  invalidateAllRepoCaches();
  answers[0]!.resolve("old");
  await before;
  void repo.list();
  assert.equal(calls(), 2);
});

test("cache repo: a failed read in flight across a write leaves the newer read alone", async () => {
  const { repo, answers, calls } = makeRepo();
  const before = repo.list();
  await repo.save("new");
  const fresh = repo.list();
  answers[0]!.reject(new Error("network"));
  await assert.rejects(before, /network/);
  answers[1]!.resolve("new");
  assert.equal(await fresh, "new");
  assert.equal(await repo.list(), "new", "the newer answer stays memoised");
  assert.equal(calls(), 2);
});

test("cache repo: concurrent identical reads share one request", async () => {
  const { repo, answers, calls } = makeRepo();
  const a = repo.list();
  const b = repo.list();
  assert.equal(calls(), 1);
  answers[0]!.resolve("one");
  assert.deepEqual(await Promise.all([a, b]), ["one", "one"]);
});

test("cache repo: a memoised answer is reused inside the revalidation window", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const { repo, answers, calls } = makeRepo();
  const first = repo.list();
  answers[0]!.resolve("one");
  await first;
  now += SCREEN_REVALIDATE_AFTER_MS - 1;
  assert.equal(await repo.list(), "one");
  assert.equal(calls(), 1);
});

test("cache repo: a memoised answer older than the revalidation window is refetched", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const { repo, answers, calls } = makeRepo();
  const first = repo.list();
  answers[0]!.resolve("one");
  await first;
  now += SCREEN_REVALIDATE_AFTER_MS + 1;

  const a = repo.list();
  const b = repo.list();
  assert.equal(calls(), 2, "one refetch, shared by both readers");
  answers[1]!.resolve("two");
  assert.deepEqual(await Promise.all([a, b]), ["two", "two"]);
  assert.equal(await repo.list(), "two");
  assert.equal(calls(), 2, "the refetched answer is memoised again");
});

test("cache repo: an expired answer is still served when the refetch fails (offline)", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const { repo, answers, calls } = makeRepo();
  const first = repo.list();
  answers[0]!.resolve("one");
  await first;
  now += SCREEN_REVALIDATE_AFTER_MS + 1;

  const offline = repo.list();
  answers[1]!.reject(new Error("offline"));
  assert.equal(await offline, "one");

  const retry = repo.list();
  assert.equal(calls(), 3, "still expired, so the next read tries the network again");
  answers[2]!.resolve("two");
  assert.equal(await retry, "two");
});

test("cache repo: a cold read that fails still rejects and is not memoised", async () => {
  const { repo, answers, calls } = makeRepo();
  const first = repo.list();
  answers[0]!.reject(new Error("down"));
  await assert.rejects(first, /down/);
  const second = repo.list();
  assert.equal(calls(), 2);
  answers[1]!.resolve("up");
  assert.equal(await second, "up");
});
