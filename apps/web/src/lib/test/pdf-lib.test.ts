import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPdfLib, openPdfDocument, type PdfLib } from "@/lib/parts";

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

/** A pdf.js stand-in: counts workers, and each task's document destroys through its task, as pdf.js does. */
function fakeLib(fail = false) {
  const workers: { destroyed: boolean; destroy(): void }[] = [];
  const params: { worker?: unknown }[] = [];
  class PDFWorker {
    destroyed = false;
    constructor() {
      workers.push(this);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const getDocument = (p: { worker?: unknown }) => {
    params.push(p);
    const task = {
      destroyed: 0,
      async destroy() {
        task.destroyed += 1;
      },
      promise: fail
        ? Promise.reject(new Error("bad pdf"))
        : Promise.resolve({ destroy: () => task.destroy() }),
    };
    return task;
  };
  return { lib: { PDFWorker, getDocument } as unknown as PdfLib, workers, params };
}

test("open documents share one pdf.js worker, ended with the last of them", async () => {
  const { lib, workers, params } = fakeLib();
  const a = openPdfDocument(lib, { data: new Uint8Array(1) });
  const b = openPdfDocument(lib, { data: new Uint8Array(1) });
  assert.equal(workers.length, 1);
  assert.equal(params[0]?.worker, workers[0]);
  assert.equal(params[1]?.worker, workers[0]);

  await (await a.promise).destroy();
  assert.equal(workers[0]?.destroyed, false, "the other document still uses it");
  await b.destroy();
  await b.destroy();
  assert.equal(workers[0]?.destroyed, true);

  // The next open starts a fresh worker.
  const c = openPdfDocument(lib, { data: new Uint8Array(1) });
  assert.equal(workers.length, 2);
  assert.equal(params[2]?.worker, workers[1]);
  await c.destroy();
  assert.equal(workers[1]?.destroyed, true);
});

test("a document that fails to load lets go of the shared worker", async () => {
  const { lib, workers } = fakeLib(true);
  const task = openPdfDocument(lib, { data: new Uint8Array(1) });
  await assert.rejects(task.promise, /bad pdf/);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(workers[0]?.destroyed, true);
});
