import type { SearchSettings, WorkspaceSnapshot } from "@weaveforge/core";
import type { BuildIndexRequest, BuildIndexResponse } from "./search-index-worker";

/**
 * Running an index build in a worker, with an in-thread fallback.
 *
 * The fallback matters: a browser without workers, or a bundler configuration
 * that fails to emit one, must still get a working search rather than none.
 * Callers see one promise either way and cannot tell which path ran.
 */

export interface BuildResult {
  serialized: string;
  revision: string;
  documentCount: number;
  pdfPageCounts: [string, number][];
  annotationCount: number;
}

export function supportsIndexWorker(): boolean {
  return typeof Worker !== "undefined";
}

let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  worker ??= new Worker(new URL("./search-index-worker.ts", import.meta.url));
  return worker;
}

/** Free the worker's memory once a session is done with it. */
function disposeIndexWorker(): void {
  worker?.terminate();
  worker = null;
}

export function buildIndexInWorker(
  snapshot: WorkspaceSnapshot,
  projectId: string | null,
  settings: SearchSettings | undefined,
): Promise<BuildResult> {
  const instance = ensureWorker();
  const id = nextId++;

  return new Promise<BuildResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent<BuildIndexResponse>) => {
      if (event.data.id !== id) return;
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
      if (event.data.type === "error") reject(new Error(event.data.message));
      else resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      instance.removeEventListener("message", onMessage);
      instance.removeEventListener("error", onError);
      // A worker that failed to start will fail again; drop it so the next
      // build takes the in-thread path rather than retrying a dead one.
      disposeIndexWorker();
      reject(new Error(event.message || "The index worker failed."));
    };

    instance.addEventListener("message", onMessage);
    instance.addEventListener("error", onError);
    instance.postMessage({ id, snapshot, projectId, settings } satisfies BuildIndexRequest);
  });
}
