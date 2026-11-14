/**
 * Turns the HTML that `marked` makes from a `docs/using` page into the docs
 * site's markup: ids on headings, numbered how-to steps that a view of the app
 * can follow, links between pages, and callouts. Pure string work, so it is tested
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
 * Each how-to step gets `data-ring="page/task/step"`, the control a view rings
 * for it. `viewOf(key)` names the captured view that shows the step, or null;
 * steps with one also get `data-view`. An ordered list counts as a how-to
 * when it sits under an h3 (`### Create a note`); lists under an h2 do not.
 */
export function decorate(html, page, viewOf) {
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
      const view = viewOf(key);
      return `<li class="wf-item docs-step" data-step="${step}"${view ? ` data-view="views/${view}"` : ""} data-ring="${key}">`;
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

/** Splits a decorated page at its h2s: the HTML before the first h2, then each section. */
export function sections(html) {
  const chunks = html.split(/(?=<h2 id=")/);
  const head = chunks[0].startsWith('<h2 id="') ? "" : chunks.shift();
  const parts = chunks.map((chunk) => {
    const m = chunk.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>\n?/);
    return { id: m[1], title: plainText(m[2]), body: chunk.slice(m[0].length) };
  });
  return { head, parts };
}

/** A "Stuck?" paragraph opens with the question in bold or italics; it becomes a fold-out. */
export function stuckToDetails(body) {
  return body.replace(/<p><(em|strong)>([\s\S]*?)<\/\1>\s*([\s\S]+?)<\/p>/g, (_, _tag, question, answer) => {
    const q = question.replace(/^Q:\s*/, "");
    return `<details class="docs-stuck"><summary>${q}</summary><p>${answer.replace(/^A:\s*/, "")}</p></details>`;
  });
}

/** The pages a "Related" list links to, in order. */
export function relatedStems(body) {
  return [...body.matchAll(/<li><a href="([a-z0-9-]+)\.html[^"]*">/g)].map((m) => m[1]);
}

/** The first `max` rows of the first table, as plain [name, value] pairs. */
export function tableFacts(body, max) {
  const table = body.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  return [...table.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g)].slice(0, max).map((m) => [plainText(m[1]), plainText(m[2])]);
}

export function listItems(body) {
  return [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

/** The first sentence that names a key shortcut, for the "Faster way" card. */
export function fasterWay(text) {
  return text.match(/[^.!?]*\b(?:Ctrl|Cmd|Alt|Shift)\+[^.!?]*[.!?]/)?.[0].trim() ?? "";
}

export function readMinutes(text) {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
}

/** A small hand-written "N steps" beside each how-to heading. */
export function noteSteps(body) {
  return body.replace(/(<h3 id="[^"]+">[\s\S]*?<\/h3>)([\s\S]*?)(?=<h3 |$)/g, (_, heading, rest) => {
    const n = (rest.match(/class="wf-item docs-step"/g) ?? []).length;
    return n ? `${heading}<span class="docs-hand docs-aside-note">${n} step${n === 1 ? "" : "s"}</span>${rest}` : heading + rest;
  });
}
