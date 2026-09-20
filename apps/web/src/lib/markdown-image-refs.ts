/**
 * Drop image references the caller could not resolve to a blob URL.
 *
 * Paper notes and report sections both write images as `<prefix><path>` and
 * both have to remove the ones whose blob never arrived — otherwise the reader
 * sees a broken image for a file they cannot fetch. Only the prefix differs.
 *
 * One compiled pattern and one pass. The previous version compiled a fresh
 * `RegExp` per unresolved path *inside* a loop and ran a full `replace` over the
 * whole body each time, so a note with thirty missing figures scanned itself
 * thirty times and allocated thirty intermediate strings — on every render of
 * its preview. Alternating over the unresolved paths removes them together:
 * cost is one scan, and one allocation per *surviving* image rather than one per
 * missing one.
 */
export function stripUnresolvedImageRefs(
  body: string,
  prefix: string,
  paths: readonly string[],
  urls: Map<string, string>,
): string {
  const unresolved = paths.filter((path) => !urls.has(path));
  if (unresolved.length === 0) return body;
  // The captured group is what keeps a path containing `)` or a regex
  // metacharacter working: the paths are escaped and alternated, rather than
  // pattern-matched loosely and tested afterwards.
  const alternatives = unresolved.map((path) => escapeRegExp(`${prefix}${path}`)).join("|");
  return body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${alternatives}\\)`, "g"), "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
