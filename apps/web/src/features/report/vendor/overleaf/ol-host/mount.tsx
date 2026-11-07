// Mounts Overleaf's IDE, as its own `pages/ide.tsx` does, into a container the
// host owns. Before any IDE module loads, the host installs what Overleaf's
// server page would have provided: the socket.io global and the meta values.

import { createRoot } from 'react-dom/client'
import { installFetchBridge, type Forward } from './fetch-bridge'
import { createIoBridge, type LiveTransport } from './io-bridge'
import { buildMeta, installMeta } from './meta'

export type MountOptions = {
  projectId: string
  transport: LiveTransport
  forward: Forward
}

/** Returns a function that unmounts the IDE. */
export async function mountOverleafIde(container: HTMLElement, { projectId, transport, forward }: MountOptions) {
  window.io = createIoBridge(() => transport)
  const uninstallFetch = installFetchBridge(window, forward)
  // Overleaf's stylesheet, built by `scripts/build-overleaf-assets.mjs`; linked
  // only while the IDE is up so Bootstrap never styles the rest of the app.
  const style = document.createElement('link')
  style.rel = 'stylesheet'
  style.href = '/overleaf/ide.css'
  document.head.appendChild(style)
  // The stylesheet is scoped to `.ol-ide`: the container, and the overlays the
  // IDE appends to document.body while it is up.
  container.classList.add('ol-ide')
  const overlays = tagOverlays(document.body)
  window.metaAttributesCache = window.metaAttributesCache || new Map()
  const { defaultSettings } = await import('../frontend/js/shared/context/user-settings-context')
  installMeta(
    buildMeta({
      projectId,
      dark: document.documentElement.dataset.mode === 'dark',
      settings: defaultSettings,
    }),
    window.metaAttributesCache,
  )

  // Loaded only now: the socket shim reads window.io when its module runs.
  const { default: IdeRoot } = await import('../frontend/js/features/ide-react/components/ide-root')
  const root = createRoot(container)
  root.render(<IdeRoot />)
  return () => {
    root.unmount()
    overlays.disconnect()
    container.classList.remove('ol-ide')
    style.remove()
    // Set by Overleaf's useThemedPage while the IDE is up.
    delete document.body.dataset.theme
    uninstallFetch()
  }
}

const OVERLAY = /^(modal|modal-backdrop|tooltip|popover|dropdown-menu|context-menu)$/

function tagOverlays(body: HTMLElement) {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && [...node.classList].some((c) => OVERLAY.test(c))) {
          node.classList.add('ol-ide')
        }
      }
    }
  })
  observer.observe(body, { childList: true })
  return observer
}
