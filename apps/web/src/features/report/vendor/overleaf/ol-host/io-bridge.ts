// A stand-in for the socket.io 0.9 client that Overleaf's IDE expects on
// `window.io`. Overleaf's real socket lives in the desktop shell (the live
// link); this relays the IDE's emits to it and replays its events here, so the
// vendored connection code runs unchanged.

type Listener = (...args: any[]) => void

export type LiveEvent = { name: string; args: unknown[] }

/** The live link, as the host reaches it. */
export interface LiveTransport {
  open(): Promise<{ ok: true; liveId: string; join: unknown[] } | { ok: false; message: string }>
  emit(
    liveId: string,
    name: string,
    args: unknown[],
  ): Promise<{ ok: true; reply: unknown[] } | { ok: false; closed: boolean; message: string }>
  events(
    liveId: string,
  ): Promise<{ ok: true; events: LiveEvent[]; closed: boolean } | { ok: false; closed: boolean; message: string }>
  close(liveId: string): Promise<void>
}

/** Answered here: the live link keeps Overleaf's heartbeat itself. */
const LOCAL: Record<string, (cb?: Listener) => void> = {
  clientPong: () => {},
  'debug.getHostname': (cb) => cb?.('weaveforge'),
}

const RETRY_MS = 1000

function createSocket(transport: LiveTransport) {
  const listeners = new Map<string, Listener[]>()
  // Bumped on every connect and disconnect, so a reply from an old link is dropped.
  let generation = 0

  const fire = (name: string, ...args: unknown[]) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args)
  }

  const drop = (gen: number) => {
    if (gen !== generation || !inner.connected) return
    generation++
    inner.connected = false
    fire('disconnect')
  }

  const poll = async (gen: number, liveId: string) => {
    while (gen === generation) {
      const result = await transport.events(liveId)
      if (gen !== generation) return
      if (result.ok) {
        for (const event of result.events) {
          if (gen !== generation) return
          if (event.name !== 'disconnect') fire(event.name, ...event.args)
        }
      }
      if (result.closed) return drop(gen)
      if (!result.ok) await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }

  // Plain and configurable: Overleaf's shim redefines `transport` on it.
  const inner = {
    connected: false,
    connecting: false,
    sessionid: undefined as string | undefined,
    transports: [] as string[],
    transport: undefined as unknown,
    heartbeatTimeoutTimer: undefined as unknown,
    connect() {
      if (inner.connected || inner.connecting) return
      const gen = ++generation
      inner.connecting = true
      void transport.open().then((result) => {
        if (gen !== generation) return
        inner.connecting = false
        if (!result.ok) return fire('connect_failed', new Error(result.message))
        inner.connected = true
        inner.sessionid = result.liveId
        fire('connect')
        fire('joinProjectResponse', ...result.join)
        void poll(gen, result.liveId)
      })
    },
    disconnect() {
      const liveId = inner.sessionid
      const wasConnected = inner.connected
      generation++
      inner.connecting = false
      inner.connected = false
      if (liveId) void transport.close(liveId)
      if (wasConnected) fire('disconnect')
    },
  }

  return {
    socket: inner,
    on(name: string, fn: Listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn])
      return this
    },
    removeListener(name: string, fn: Listener) {
      listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn))
      return this
    },
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
    emit(name: string, ...rest: unknown[]) {
      const cb = typeof rest[rest.length - 1] === 'function' ? (rest.pop() as Listener) : undefined
      const local = LOCAL[name]
      if (local) return local(cb)
      if (name === 'joinDoc' && rest[1] && typeof rest[1] === 'object') {
        // History OT is shimmed out of this build, so ask for plain ShareJS ops.
        const { supportsHistoryOT: _, ...options } = rest[1] as Record<string, unknown>
        rest[1] = options
      }
      const liveId = inner.sessionid
      if (!inner.connected || !liveId) return cb?.({ message: 'Not connected to Overleaf.' })
      void transport.emit(liveId, name, rest).then((result) => {
        if (result.ok) cb?.(...result.reply)
        else cb?.({ message: result.message })
      })
    },
  }
}

/** Builds the `io` global for Overleaf's socket shim (it reads `version` "0.x"). */
export function createIoBridge(getTransport: () => LiveTransport) {
  return {
    version: '0.9.17',
    Transport: { websocket: class {}, 'xhr-polling': class {} },
    connect(_url: string, options: Record<string, unknown> = {}) {
      const socket = createSocket(getTransport())
      if (options['auto connect'] !== false) socket.connect()
      return socket
    },
  }
}
