// The IDE shows project images with `<img src="/project/<id>/blob/<hash>">`.
// An `<img>` load skips `window.fetch`, so the fetch bridge never sees it and
// the host has no such route: the image fails unless something cached it.
// Loading it through fetch sends it through the bridge like every other call.

/** Fetches an image and returns a blob URL for it; revoke it when done. */
export async function fetchImageUrl(url: string, fetchFn: typeof fetch = globalThis.fetch): Promise<string> {
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  return URL.createObjectURL(await res.blob())
}
