"use client";

/**
 * Whether a markdown editor shows its live preview, and on which side: one
 * choice for the whole app, shared by the View control in a header and every
 * editor under it, so choosing Split in one place opens it everywhere.
 *
 * Remembered the way the pen guard is (`weaveforge.ink.penOnly`), because it
 * is a preference about the person, not about a document.
 */

import { useSyncExternalStore } from "react";

import { readStored, writeStored } from "@/lib/safe-storage";

/** The localStorage key, one per app like the pen guard's. */
export const MD_PREVIEW_KEY = "weaveforge.md.preview";
/** The side Split opens on, kept while the preview is off. */
export const MD_SPLIT_KEY = "weaveforge.md.split";

export type MdSplitSide = "side" | "below";
export type MdPreviewMode = "off" | MdSplitSide;

const isSide = (value: string | null): value is MdSplitSide => value === "side" || value === "below";

/** The remembered choice, `off` for anything the key does not hold. */
export function readMdPreviewMode(): MdPreviewMode {
  const value = readStored(MD_PREVIEW_KEY);
  return isSide(value) ? value : "off";
}

/** The side Split opens on: the last one used, beside by default. */
export function readMdSplitSide(): MdSplitSide {
  const value = readStored(MD_SPLIT_KEY);
  return isSide(value) ? value : "side";
}

let current: MdPreviewMode | null = null;
const listeners = new Set<() => void>();

export function mdPreviewSnapshot(): MdPreviewMode {
  return (current ??= readMdPreviewMode());
}

export function subscribeMdPreviewMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setMdPreviewMode(next: MdPreviewMode): void {
  current = next;
  // A private window that refuses: the choice lasts the session, which is
  // still a choice.
  writeStored(MD_PREVIEW_KEY, next);
  if (next !== "off") writeStored(MD_SPLIT_KEY, next);
  for (const listener of listeners) listener();
}

/** Pick the side Split opens on; an open split moves to it. */
export function setMdSplitSide(side: MdSplitSide): void {
  if (mdPreviewSnapshot() === "off") writeStored(MD_SPLIT_KEY, side);
  else setMdPreviewMode(side);
}

export function useMdPreviewMode(): [MdPreviewMode, (mode: MdPreviewMode) => void] {
  const mode = useSyncExternalStore(subscribeMdPreviewMode, mdPreviewSnapshot, () => "off" as const);
  return [mode, setMdPreviewMode];
}
