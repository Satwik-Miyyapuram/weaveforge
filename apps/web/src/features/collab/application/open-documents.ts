/**
 * Open documents are owned by the workspace, not by the pane showing them.
 *
 * The editor shell can put the same note in two panes. Letting each pane build
 * its own Yjs document would have the two instances fight over every keystroke,
 * and letting each one save independently is the last-write-wins edit loss the
 * sync work exists to prevent. So a document is created once, reference-counted,
 * and torn down by whichever pane closes it last.
 *
 * Nothing here knows about Yjs or React: a holder hands in a factory and gets
 * back whatever that factory built. That keeps the counting testable without a
 * transport, and lets a plain-markdown entity share the same bookkeeping as a
 * co-edited one.
 */

import { shouldPersistBody } from "../domain/save-policy.js";

/** A document's identity in the workspace — never a path, which can change. */
export interface DocumentRef {
  kind: string;
  id: string;
}

export function documentKey(ref: DocumentRef): string {
  return `${ref.kind}:${ref.id}`;
}

export interface OpenDocument<T> {
  value: T;
  destroy: () => void | Promise<void>;
}

interface Entry<T> extends OpenDocument<T> {
  holders: number;
  /** The body as the server last saw it, shared by every holder. */
  lastSaved: string;
  /** False until the document has finished loading; saves are refused first. */
  ready: boolean;
}

export interface DocumentRegistry<T> {
  acquire: (ref: DocumentRef, create: () => OpenDocument<T>) => T;
  release: (ref: DocumentRef) => void;
  peek: (ref: DocumentRef) => T | undefined;
  holders: (ref: DocumentRef) => number;
  markReady: (ref: DocumentRef, body: string) => void;
  /** True when `body` is worth writing — see `shouldPersistBody`. */
  shouldSave: (ref: DocumentRef, body: string) => boolean;
  markSaved: (ref: DocumentRef, body: string) => void;
}

export function createDocumentRegistry<T>(): DocumentRegistry<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    acquire(ref, create) {
      const key = documentKey(ref);
      const existing = entries.get(key);
      if (existing) {
        existing.holders += 1;
        return existing.value;
      }
      const opened = create();
      entries.set(key, { ...opened, holders: 1, lastSaved: "", ready: false });
      return opened.value;
    },

    release(ref) {
      const key = documentKey(ref);
      const entry = entries.get(key);
      if (!entry) return;
      entry.holders -= 1;
      if (entry.holders > 0) return;
      entries.delete(key);
      void entry.destroy();
    },

    peek(ref) {
      return entries.get(documentKey(ref))?.value;
    },

    holders(ref) {
      return entries.get(documentKey(ref))?.holders ?? 0;
    },

    markReady(ref, body) {
      const entry = entries.get(documentKey(ref));
      if (!entry) return;
      entry.lastSaved = body;
      entry.ready = true;
    },

    shouldSave(ref, body) {
      const entry = entries.get(documentKey(ref));
      if (!entry) return false;
      return shouldPersistBody({ ready: entry.ready, next: body, lastSaved: entry.lastSaved });
    },

    markSaved(ref, body) {
      const entry = entries.get(documentKey(ref));
      if (entry) entry.lastSaved = body;
    },
  };
}
