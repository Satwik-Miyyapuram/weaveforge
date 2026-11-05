import type { MenuItem } from "./menu";
import { VIEWPORT_PAD } from "./viewport-pad";

/**
 * The app's one right-click menu, as state.
 *
 * Any surface calls `openContextMenu(event, items)`; the single
 * `<ContextMenuHost />` in the shell draws it with the same `Menu` the kebabs
 * use, so a card's right-click and its kebab list the same actions.
 */
export interface ContextMenuState {
  x: number;
  y: number;
  items: readonly MenuItem[];
}

let current: ContextMenuState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Opens the menu at the pointer and stops the browser's own menu. */
export function openContextMenu(
  at: { clientX: number; clientY: number; preventDefault?: () => void },
  items: readonly MenuItem[],
): void {
  if (items.length === 0) return;
  at.preventDefault?.();
  current = { x: at.clientX, y: at.clientY, items };
  emit();
}

export function closeContextMenu(): void {
  if (!current) return;
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
  const left = x + width + VIEWPORT_PAD > viewWidth ? x - width : x;
  const top = y + height + VIEWPORT_PAD > viewHeight ? y - height : y;
  const clamp = (value: number, size: number, view: number) =>
    Math.max(VIEWPORT_PAD, Math.min(value, view - size - VIEWPORT_PAD));
  return { left: clamp(left, width, viewWidth), top: clamp(top, height, viewHeight) };
}

/** True when a right-click there should keep the browser's own text menu. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/** What counts as a card for right-click: the box a card menu sits in. */
export const CARD_SELECTOR = ".paper-card, .entity-card, .card:not(.popover-panel)";
