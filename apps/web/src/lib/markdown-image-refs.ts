/**
 * Drop image references the caller could not resolve to a blob URL.
 *
 * Paper notes and report sections both write images as `<prefix><path>` and
 * both have to remove the ones whose blob never arrived — otherwise the reader
 * sees a broken image for a file they cannot fetch. Only the prefix differs.
 */
export function stripUnresolvedImageRefs(
  body: string,
  prefix: string,
  paths: readonly string[],
  urls: Map<string, string>,
): string {
  let next = body;
  for (const path of paths) {
    if (urls.has(path)) continue;
    const ref = escapeRegExp(`${prefix}${path}`);
    next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\(${ref}\\)`, "g"), "");
  }
  return next;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
