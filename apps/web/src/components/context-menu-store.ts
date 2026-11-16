import { readyCore } from "@/lib/rust-core";
import type { MenuItem } from "./menu";

/**
 * The app's one right-click menu, as state.
 *
 * Any surface calls `openContextMenu(event, items)`; the single
 * `<ContextMenuHost />` in the shell draws it with the same `Menu` the kebabs
 * use, so a card's right-click and its kebab list the same actions.
 *
 * Whether an open or close changes state, and where a menu goes on screen, are
 * decided in Rust (`wf_core::app_lib::context_menu`). This file keeps the items
 * and the listeners.
 */
export interface ContextMenuState {
  x: number;
  y: number;
  items: readonly MenuItem[];
}

type Point = { x: number; y: number };
type Reduction = { state: Point | null; accepted: boolean; changed: boolean };

let current: ContextMenuState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function pointOf(state: ContextMenuState | null): Point | null {
  return state ? { x: state.x, y: state.y } : null;
}

/** Opens the menu at the pointer and stops the browser's own menu. */
export function openContextMenu(
  at: { clientX: number; clientY: number; preventDefault?: () => void },
  items: readonly MenuItem[],
): void {
  const next = readyCore().contextMenuReduce(pointOf(current), {
    kind: "open",
    x: at.clientX,
    y: at.clientY,
    count: items.length,
  }) as Reduction;
  if (!next.accepted) return;
  at.preventDefault?.();
  current = { x: at.clientX, y: at.clientY, items };
  if (next.changed) emit();
}

export function closeContextMenu(): void {
  const next = readyCore().contextMenuReduce(pointOf(current), { kind: "close" }) as Reduction;
  if (!next.changed) return;
  current = null;
  emit();
}

export function contextMenuState(): ContextMenuState | null {
  return current;
}

export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Where a `width`×`height` menu opened at (`x`, `y`) goes so it stays on
 * screen: flipped left/up when it would overflow, then clamped to the pad.
 */
export function placeContextMenu(
  x: number,
  y: number,
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
): { left: number; top: number } {
  const placed = readyCore().contextMenuPlace(x, y, width, height, viewWidth, viewHeight) as Point;
  return { left: placed.x, top: placed.y };
}

/** True when a right-click there should keep the browser's own text menu. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/** What counts as a card for right-click: the box a card menu sits in. */
export const CARD_SELECTOR = ".paper-card, .entity-card, .card:not(.popover-panel)";
