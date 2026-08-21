/**
 * `decodeURIComponent` throws on a malformed escape, and an artifact filename
 * is user-supplied — `a%zz.png` is a legal name and an illegal escape. The
 * undecoded name is a fine label; a thrown URIError takes the whole panel down.
 */
function decodeOrRaw(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Human label for an artifact, from an absolute URL or a storage path. */
export function figureLabel(url: string, index: number): string {
  let part: string | undefined;
  try {
    part = new URL(url).pathname.split("/").pop();
  } catch {
    // Not an absolute URL — a storage path, so read it as one.
    part = url.split("/").pop();
  }
  const base = part?.split("?")[0];
  return base ? decodeOrRaw(base) : `figure ${index + 1}`;
}
