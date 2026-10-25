import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPdfLib, type PdfLib } from "@/lib/pdf-lib";

test("a failed pdf.js load is retried on the next open, then kept (11-06)", async () => {
  const lib = { GlobalWorkerOptions: { workerSrc: "" } } as unknown as PdfLib;
  let loads = 0;
  const failing = () => {
    loads++;
    return Promise.reject(new Error("chunk load failed"));
  };
  const working = () => {
    loads++;
    return Promise.resolve(lib);
  };

  await assert.rejects(loadPdfLib(failing), /chunk load failed/);
  assert.equal(await loadPdfLib(working), lib);
  assert.equal(lib.GlobalWorkerOptions.workerSrc, "/pdf.worker.min.mjs");
  // Once loaded, the bundle is shared: a later open does not import again.
  assert.equal(await loadPdfLib(failing), lib);
  assert.equal(loads, 2);
});
