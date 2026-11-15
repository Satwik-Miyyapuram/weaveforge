// Where the IDE's top bar goes. The host can give it a place in its own
// toolbar row so its tab strip never moves; with none, the bar stays in the IDE.
import { useSyncExternalStore } from 'react'

let target: HTMLElement | null = null
const listeners = new Set<() => void>()

export function setToolbarTarget(el: HTMLElement | null): void {
  if (el === target) return
  target = el
  for (const listener of [...listeners]) listener()
}

export function getToolbarTarget(): HTMLElement | null {
  return target
}

export function subscribeToolbarTarget(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useToolbarTarget(): HTMLElement | null {
  return useSyncExternalStore(subscribeToolbarTarget, getToolbarTarget, () => null)
}
