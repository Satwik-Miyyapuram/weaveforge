/**
 * Turns the HTML that `marked` makes from a `docs/using` page into the docs
 * site's markup: ids on headings, numbered how-to steps that a screenshot can
 * follow, links between pages, and callouts. Pure string work, so it is tested
 * without a browser; scripts/build-user-docs.mjs does the files.
 */

/** A heading's id and a task's folder name: "Create a note" -> "create-a-note". */
export function slug(text) {
  return plainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripFrontMatter(md) {
  return md.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
}

export function plainText(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const CALLOUT = { TIP: ["tip", "Good to know"], NOTE: ["note", "Note"], WARNING: ["warning", "Careful"] };

/**
 * `hasShot("page/task/step")` says whether a screenshot was captured for a
 * step; only those steps get `data-shot`. An ordered list counts as a how-to
 * when it sits under an h3 (`### Create a note`); lists under an h2 do not.
 */
export function decorate(html, page, hasShot) {
  let task = null;
  let olDepth = 0;
  let ulDepth = 0;
  let steps = false;
  let step = 0;
  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>|<\/?ol>|<\/?ul>|<li>/g, (tag, level, inner) => {
    if (level) {
      const id = slug(inner);
      task = level === "3" ? id : null;
      return `<h${level} id="${id}">${inner}</h${level}>`;
    }
    if (tag === "<ol>") {
      olDepth += 1;
      if (olDepth === 1 && ulDepth === 0 && task) {
        steps = true;
        step = 0;
        return `<ol class="docs-steps" data-task="${task}">`;
      }
      return tag;
    }
    if (tag === "</ol>") {
      olDepth -= 1;
      if (olDepth === 0) steps = false;
      return tag;
    }
    if (tag === "<ul>" || tag === "</ul>") {
      ulDepth += tag === "<ul>" ? 1 : -1;
      return tag;
    }
    if (steps && olDepth === 1 && ulDepth === 0) {
      step += 1;
      const key = `${page}/${task}/${step}`;
      const shot = hasShot(key) ? ` data-shot="shots/${key}"` : "";
      return `<li class="wf-item docs-step" data-step="${step}"${shot}>`;
    }
    return tag;
  });
  return out
    .replace(/href="(?![a-z]+:|\/|#)([^"#]+)\.md(#[^"]*)?"/g, (_, file, hash = "") => `href="${file}.html${hash}"`)
    .replace(/<blockquote>\n<p>\[!(TIP|NOTE|WARNING)\]\n?([\s\S]*?)<\/blockquote>/g, (_, kind, rest) => {
      const [cls, title] = CALLOUT[kind];
      return `<div class="callout callout--${cls}"><div class="callout-title">${title}</div><div class="callout-body">\n<p>${rest}</div></div>`;
    })
    .replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, '<div class="callout callout--note"><div class="callout-body">$1</div></div>');
}
