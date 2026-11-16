/**
 * Static redirects from the retired in-app docs (/docs/...) to the help site.
 *
 * GitHub Pages cannot send server redirects, so each old URL gets an
 * index.html that redirects in the browser. Only the pages that exist in the
 * help site map to their own page; every other old URL goes to its home.
 */

export const DOCS_ORIGIN = "https://docs.weaveforge.org";

/**
 * @param {string} oldRel  the old route under /docs/, e.g. "using/notes" or "" for /docs/
 * @param {string[]} stems the help site's page names, from docs/using/*.md
 */
export function redirectTarget(oldRel, stems) {
  const match = /^using\/([^/]+)$/.exec(oldRel);
  if (match && stems.includes(match[1])) return `${DOCS_ORIGIN}/${match[1]}.html`;
  return `${DOCS_ORIGIN}/`;
}

export function redirectPage(target) {
  const href = target.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const js = JSON.stringify(target).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${href}">
<link rel="canonical" href="${href}">
<title>Moved to the help site</title>
</head>
<body>
<p>The help has moved to <a href="${href}">${href}</a>.</p>
<script>location.replace(${js});</script>
</body>
</html>
`;
}

/**
 * @param {string[]} oldRels every old route under /docs/
 * @param {string[]} stems
 * @returns {Map<string, string>} path under the export -> page HTML
 */
export function redirectFiles(oldRels, stems) {
  const files = new Map();
  for (const rel of oldRels) {
    const dir = rel === "" ? "docs" : `docs/${rel}`;
    files.set(`${dir}/index.html`, redirectPage(redirectTarget(rel, stems)));
  }
  return files;
}
