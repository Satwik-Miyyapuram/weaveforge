// Overleaf's IDE fetches its server's routes on its own origin (`/project/...`,
// `/user/...`) and compiled PDFs from Overleaf's output host. The host has no
// such routes, so the bridge hands those requests to the host, which sends them
// on to Overleaf. Every other request goes to the page's own fetch.

/** First path segments of the Overleaf server routes the IDE calls. */
const OVERLEAF_PATHS = [
  '/project/',
  '/user/',
  '/spelling/',
  '/system/messages',
  '/notifications/',
  '/editingSession/',
  '/tutorial/',
  '/error/client',
]

/** Where Overleaf serves compiled output. */
const OUTPUT_HOST = 'compiles.overleafusercontent.com'

export type ForwardRequest = {
  method: string
  /** A path on our origin, or the full address on Overleaf's output host. */
  url: string
  /** Lower-case names. */
  headers: Record<string, string>
  body: Uint8Array | null
}

export type ForwardResponse = {
  status: number
  headers: Record<string, string>
  body: Uint8Array<ArrayBuffer>
}

export type Forward = (request: ForwardRequest) => Promise<ForwardResponse>

type FetchWindow = { fetch: typeof fetch; location: { origin: string } }

export function isOverleafUrl(url: URL, origin: string): boolean {
  if (url.host === OUTPUT_HOST) return true
  if (url.origin !== origin) return false
  return OVERLEAF_PATHS.some(p => url.pathname.startsWith(p))
}

/** Statuses a Response may not carry a body with. */
const NO_BODY = new Set([101, 204, 205, 304])

/** Replaces `win.fetch`; returns a function that puts the original back. */
export function installFetchBridge(win: FetchWindow, forward: Forward) {
  const own = win.fetch
  const origin = win.location.origin

  win.fetch = async (input, init) => {
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), origin),
      init
    )
    const url = new URL(request.url)
    if (!isOverleafUrl(url, origin)) return own(input, init)

    const headers: Record<string, string> = {}
    request.headers.forEach((value, name) => {
      headers[name] = value
    })
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? null
        : new Uint8Array(await request.arrayBuffer())
    const res = await forward({
      method: request.method,
      url: url.host === OUTPUT_HOST ? url.href : url.pathname + url.search,
      headers,
      body,
    })
    return new Response(NO_BODY.has(res.status) ? null : res.body, {
      status: res.status,
      headers: res.headers,
    })
  }

  return () => {
    win.fetch = own
  }
}
