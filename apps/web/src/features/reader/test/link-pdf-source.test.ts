/**
 * Linking a fetched PDF's address to its paper (xlog-12): the bytes are kept
 * either way, so a failed link must not fail the fetch, but it is logged.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { AppLogInput } from "@/lib/error-report/app-log";
import { linkPdfSource } from "../application/link-pdf-source";

test("a link that saves logs nothing", async () => {
  const linked: string[] = [];
  const logs: AppLogInput[] = [];
  await linkPdfSource(async (id, url) => void linked.push(`${id} ${url}`), "p1", "https://x.org/a.pdf", (e) => void logs.push(e));
  assert.deepEqual(linked, ["p1 https://x.org/a.pdf"]);
  assert.deepEqual(logs, []);
});

test("a link that fails is logged, and does not reject", async () => {
  const logs: AppLogInput[] = [];
  await linkPdfSource(() => Promise.reject(new Error("409 conflict")), "p1", "https://x.org/a.pdf", (e) => void logs.push(e));
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "reader");
  assert.match(logs[0]!.detail ?? "", /p1/);
  assert.match(logs[0]!.detail ?? "", /409 conflict/);
});

test("a link that throws synchronously is logged too", async () => {
  const logs: AppLogInput[] = [];
  await linkPdfSource(
    () => {
      throw "no container";
    },
    "p2",
    "https://x.org/b.pdf",
    (e) => void logs.push(e),
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0]!.detail ?? "", /no container/);
});
