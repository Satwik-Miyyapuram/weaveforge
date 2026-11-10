/**
 * The first page of an Overleaf project's PDF, as a small picture for its card.
 *
 * Getting the PDF means asking Overleaf to compile, so a picture is made once
 * per project and kept on this device. Opening the project's PDF refreshes it
 * (see `WorkshopPdfViewer`). Signed out, a kept picture still shows.
 */

import { readyCore } from "@/lib/rust-core";

export interface ThumbStore {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

export interface OverleafThumbDeps {
  store: ThumbStore;
  /** The compiled PDF, or null when Overleaf could not give one. */
  fetchPdf: (sessionId: string, projectId: string) => Promise<Blob | null>;
  /** Page 1 of the PDF as a data URL. */
  render: (pdf: Blob) => Promise<string>;
}

const keyOf = (projectId: string) => readyCore().thumbKey(projectId);

export function readOverleafThumb(store: ThumbStore, projectId: string): string | null {
  try {
    return store.get(keyOf(projectId));
  } catch {
    return null;
  }
}

export function saveOverleafThumb(store: ThumbStore, projectId: string, dataUrl: string): void {
  if (!readyCore().thumbFits(dataUrl.length)) return;
  try {
    store.set(keyOf(projectId), dataUrl);
  } catch {
    // Storage full or denied: the picture lasts until the card unmounts.
  }
}

/** The kept picture, else one made now when signed in. Null on any failure. */
export async function loadOverleafThumb(
  deps: OverleafThumbDeps,
  sessionId: string | null,
  projectId: string,
): Promise<string | null> {
  const kept = readOverleafThumb(deps.store, projectId);
  if (kept) return kept;
  if (!sessionId) return null;
  try {
    const pdf = await deps.fetchPdf(sessionId, projectId);
    if (!pdf) return null;
    const dataUrl = await deps.render(pdf);
    saveOverleafThumb(deps.store, projectId, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Runs tasks one after another, so a long list does not start every compile at once. */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}
