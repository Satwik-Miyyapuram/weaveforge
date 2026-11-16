import type { PdfLib } from "./parts";

type DocumentInitParameters = import("pdfjs-dist/types/src/display/api").DocumentInitParameters;

type PdfLoadingTask = ReturnType<PdfLib["getDocument"]>;
type PdfWorker = InstanceType<PdfLib["PDFWorker"]>;

/** The worker the open documents share, and how many hold it. */
let sharedPdfWorker: { worker: PdfWorker; users: number } | null = null;

/**
 * `lib.getDocument`, on one pdf.js worker shared by every document opened here.
 *
 * pdf.js starts a worker per document by default, a thread and ~8 MB each, and
 * the workspace keeps every PDF tab's document open behind the visible one.
 * Shared, it is one worker however many are open. It ends when the last of them
 * is destroyed, as a document's own worker did. Background reads (search
 * indexing, a dropped PDF) keep their own, so they never queue in front of the
 * page being read.
 */
export function openPdfDocument(lib: PdfLib, params: DocumentInitParameters): PdfLoadingTask {
  if (!sharedPdfWorker) sharedPdfWorker = { worker: new lib.PDFWorker(), users: 0 };
  const held = sharedPdfWorker;
  held.users += 1;
  const task = lib.getDocument({ ...params, worker: held.worker });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    held.users -= 1;
    if (held.users > 0) return;
    held.worker.destroy();
    if (sharedPdfWorker === held) sharedPdfWorker = null;
  };
  // A document's own `destroy` goes through its task, so this covers both.
  const destroy = task.destroy.bind(task);
  task.destroy = () => destroy().finally(release);
  // A document that never loads may never be destroyed by its caller.
  task.promise.catch(() => task.destroy().catch(() => {}));
  return task;
}
