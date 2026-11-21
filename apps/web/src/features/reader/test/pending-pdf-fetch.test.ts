/**
 * A publisher-PDF fetch that settles after another paper was opened must not
 * write its error, or re-run the ladder, in that paper's view (P2-166).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchPendingPdf } from "../ui/pending-pdf-fetch";

const URL_A = "https://publisher.example/a.pdf";

test("a fetch that lands while its paper is open reports what happened", async () => {
  assert.deepEqual(
    await fetchPendingPdf("p1", URL_A, { download: async () => true, stillOpen: () => true }),
    { kind: "fetched", host: "publisher.example" },
  );
  assert.deepEqual(
    await fetchPendingPdf("p1", URL_A, { download: async () => false, stillOpen: () => true }),
    { kind: "failed", message: "publisher.example did not answer with a PDF for this paper." },
  );
  const thrown = await fetchPendingPdf("p1", URL_A, {
    download: async () => { throw new Error("network down"); },
    stillOpen: () => true,
  });
  assert.equal(thrown.kind, "failed");
  assert.match(thrown.kind === "failed" ? thrown.message : "", /network down/);
});

test("a fetch that lands after another paper opened is stale, whatever its result (P2-166)", async () => {
  let open = true;
  const after = (result: () => Promise<boolean>) => async () => {
    const value = result();
    open = false; // the person switched papers while the download ran
    return value;
  };
  for (const download of [after(async () => true), after(async () => false), after(async () => { throw new Error("late"); })]) {
    open = true;
    assert.deepEqual(await fetchPendingPdf("p1", URL_A, { download, stillOpen: () => open }), { kind: "stale" });
  }
});

test("a malformed address is a failure, not a throw", async () => {
  const outcome = await fetchPendingPdf("p1", "not a url", { download: async () => true, stillOpen: () => true });
  assert.equal(outcome.kind, "failed");
});