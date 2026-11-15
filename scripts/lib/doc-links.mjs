/**
 * Sync layer 6: internal markdown links and anchors resolve to tracked files.
 * Pure: the CLI in scripts/check-doc-links.mjs supplies the tracked files and
 * the working-tree text.
 */

import path from "node:path";

const EXTERNAL = /^(https?:|mailto:|tel:|data:)/i;
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`]*`/g;
const LINK = /\[[^\]]*\]\(\s*([^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const ATX = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSING = /(^|[ \t]+)#+$/;
const ANCHOR_TAG = /<a\s+(?:id|name)="([^"]+)"/gi;

/** Lines outside fenced code blocks, with 1-based line numbers. */
function prose(md) {
  const out = [];
  let fence = null;
  md.split(/\r?\n/).forEach((line, index) => {
    const mark = line.match(FENCE)?.[1];
    if (mark) {
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      return;
    }
    if (fence === null) out.push({ text: line, line: index + 1 });
  });
  return out;
}

/** GitHub heading slug: lowercase, drop punctuation, spaces become hyphens. */
export function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .replace(/ /g, "-");
}

/** Inline links and images as `{ target, line }`; external and autolink targets are left out. */
export function extractLinks(md) {
  const links = [];
  for (const { text, line } of prose(md)) {
    for (const [, target] of text.replace(INLINE_CODE, "").matchAll(LINK)) {
      if (!target || target.startsWith("<") || EXTERNAL.test(target)) continue;
      links.push({ target, line });
    }
  }
  return links;
}

/** Heading slugs with GitHub's `-1`, `-2` suffixes for repeats, plus explicit `<a id>`/`<a name>` anchors. */
export function anchors(md) {
  const set = new Set();
  const seen = new Map();
  for (const { text } of prose(md)) {
    const heading = text.match(ATX);
    if (heading) {
      const base = slug((heading[1] ?? "").replace(CLOSING, "").trim());
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      set.add(count ? `${base}-${count}` : base);
    }
    for (const [, name] of text.matchAll(ANCHOR_TAG)) set.add(name);
  }
  return set;
}

const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** Links whose file or directory is not tracked, or whose `.md` anchor is missing, as `{ line, target, why }`. */
export function brokenLinks(fromRel, links, trackedSet, readTracked) {
  const dirs = new Set(["."]);
  for (const file of trackedSet) {
    for (let dir = path.posix.dirname(file); dir !== "." && !dirs.has(dir); dir = path.posix.dirname(dir)) {
      dirs.add(dir);
    }
  }
  const broken = [];
  for (const { target, line } of links) {
    const hash = target.indexOf("#");
    const rawPath = hash === -1 ? target : target.slice(0, hash);
    const frag = hash === -1 ? "" : decode(target.slice(hash + 1));
    const pathPart = decode(rawPath);

    let rel = fromRel;
    if (pathPart) {
      const joined = pathPart.startsWith("/")
        ? path.posix.normalize(pathPart.slice(1))
        : path.posix.join(path.posix.dirname(fromRel), pathPart);
      rel = joined.replace(/\/$/, "");
      if (!trackedSet.has(rel) && !dirs.has(rel)) {
        broken.push({ line, target, why: "not tracked" });
        continue;
      }
    }

    if (frag && rel.endsWith(".md") && trackedSet.has(rel) && !anchors(readTracked(rel)).has(frag)) {
      broken.push({ line, target, why: `no heading #${frag}` });
    }
  }
  return broken;
}
