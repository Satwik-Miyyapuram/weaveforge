// What the app sees of the vendored Overleaf IDE. The app imports
// `@overleaf-ide`: tsc resolves it here (so the app's typecheck never walks
// Overleaf's source), webpack resolves it to `mount.tsx`.

import type { Forward } from './fetch-bridge'
import type { LiveTransport } from './io-bridge'

export type { Forward, ForwardRequest, ForwardResponse } from './fetch-bridge'
export type { LiveEvent, LiveTransport } from './io-bridge'

export type MountOptions = {
  projectId: string
  transport: LiveTransport
  /** Carries the IDE's requests to Overleaf's server and output host. */
  forward: Forward
}

export function mountOverleafIde(container: HTMLElement, options: MountOptions): Promise<() => void>

/** Puts the IDE's top bar into `el` (the host's toolbar row); null puts it back. */
export function setToolbarTarget(el: HTMLElement | null): void
