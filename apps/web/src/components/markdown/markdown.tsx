import { renderToString } from "katex";

/**
 * Minimal markdown-to-HTML for prose blocks (headings, lists, inline). Fenced
 * code blocks are handled separately by Shiki in display mode.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/** Slug for heading anchor ids (so `[[Note#Heading]]` can target them). */
function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolve a `[[wikilink]]` target to a destination; unresolved = offer-to-create. */
export interface WikilinkResolution {
  href: string;
  unresolved: boolean;
}
export type WikilinkResolver = (target: string, heading?: string) => WikilinkResolution;

/** Render one `[[inner]]` (inner already stripped of the brackets) to an anchor. */
function renderWikilink(inner: string, resolve: WikilinkResolver): string {
  const pipe = inner.indexOf("|");
  const link = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? "" : inner.slice(pipe + 1).trim();
  const hash = link.indexOf("#");
  const target = (hash === -1 ? link : link.slice(0, hash)).trim();
  const fragment = hash === -1 ? undefined : link.slice(hash + 1).trim();
  const isBlock = fragment?.startsWith("^") ?? false;
  const heading = isBlock ? undefined : fragment;
  const block = isBlock ? fragment!.slice(1).trim() || undefined : undefined;
  const label =
    alias ||
    (target && block ? `${target} › ^${block}` : target && heading ? `${target} › ${heading}` : target || heading || (block ? `^${block}` : ""));
  const res = resolve(target, heading ?? (block ? `^${block}` : undefined));
  let href = res.href;
  if (!res.unresolved) {
    if (block) href = `${res.href}#^${encodeURIComponent(block)}`;
    else if (heading) href = `${res.href}#${headingSlug(heading)}`;
  }
  const cls = res.unresolved ? "wikilink wikilink--unresolved" : "wikilink";
  const create = res.unresolved ? ` data-create="${escapeAttr(target)}"` : "";
  return `<a class="${cls}" href="${escapeAttr(href)}" data-wikilink="1"${create}>${escapeHtml(label)}</a>`;
}

function formatText(s: string): string {
  // Escape the whole string once for text nodes, then rebuild media/links with
  // attribute escaping applied to the *raw* captures (escapeAttr includes &quot;
  // and re-runs & → &amp; — so do not pass already-escaped strings into it).
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\b_([^_]+)_\b/g, "<em>$1</em>")
    .replace(
      /!\[([^\]]*)\]\((blob:[^\s)]+|vault:[^\s)]+|https?:\/\/[^\s)]+)\)/g,
      (_m, alt: string, src: string) => {
        // Captures here are already HTML-escaped; only quote-escape for attrs.
        const safeAlt = alt.replace(/"/g, "&quot;");
        const safeSrc = src.replace(/"/g, "&quot;");
        return `<img src="${safeSrc}" alt="${safeAlt}" class="md-image" loading="lazy" />`;
      },
    )
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, label: string, href: string) => {
        const safeHref = href.replace(/"/g, "&quot;");
        return `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`;
      },
    )
    // A root-relative target stays in the app, so it gets no new tab. Only a
    // leading slash qualifies: `foo.md` beside the file means nothing once the
    // text is on a route, and is left as plain text rather than guessed at.
    .replace(/\[([^\]]+)\]\((\/[^\s)]*)\)/g, (_m, label: string, href: string) => {
      const safeHref = href.replace(/"/g, "&quot;");
      return `<a href="${safeHref}">${label}</a>`;
    });
}

function renderMath(source: string, displayMode: boolean): string {
  return renderToString(source, {
    displayMode,
    throwOnError: false,
    // Never allow TeX commands to introduce links, HTML, or external content.
    trust: false,
    // Each formula gets KaTeX's default empty macro store, so definitions never
    // leak from one encrypted note into another.
    macros: {},
  });
}

function closingDollar(s: string, from: number): number {
  for (let index = from; index < s.length; index += 1) {
    if (s[index] === "\\") {
      index += 1;
    } else if (s[index] === "$") {
      return index;
    }
  }
  return -1;
}

/** Render inline Markdown while treating code, URLs, and escaped dollars as text. */
function inline(s: string, resolve?: WikilinkResolver): string {
  const out: string[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(formatText(text));
    text = "";
  };

  for (let index = 0; index < s.length; index += 1) {
    if (s[index] === "\\" && s[index + 1] === "$") {
      text += "$";
      index += 1;
      continue;
    }

    // `[[wikilink]]` — resolved to a note/paper link, or an offer-to-create.
    if (resolve && s[index] === "[" && s[index + 1] === "[") {
      const end = s.indexOf("]]", index + 2);
      if (end !== -1) {
        flush();
        out.push(renderWikilink(s.slice(index + 2, end), resolve));
        index = end + 1;
        continue;
      }
    }

    if (s[index] === "`") {
      const end = s.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        out.push(`<code>${escapeHtml(s.slice(index + 1, end))}</code>`);
        index = end;
        continue;
      }
    }

    // A URL is formatted as one unit below. Do not interpret currency or query
    // parameter dollars inside it as an equation delimiter.
    if (s.startsWith("https://", index) || s.startsWith("http://", index)) {
      const end = s.slice(index).search(/\s/);
      const url = end === -1 ? s.slice(index) : s.slice(index, index + end);
      text += url;
      index += url.length - 1;
      continue;
    }

    if (s[index] === "$" && s[index + 1] !== "$") {
      const end = closingDollar(s, index + 1);
      const source = end === -1 ? "" : s.slice(index + 1, end);
      if (source && !source.includes("\n")) {
        flush();
        out.push(renderMath(source, false));
        index = end;
        continue;
      }
    }

    text += s[index];
  }
  flush();
  return out.join("");
}

/** Split one table row into cells, honouring `\|` as a literal pipe. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const DIVIDER_CELL = /^:?-+:?$/;

/** The `|---|:--:|` line that turns the row above it into a header. */
function isTableDivider(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = splitRow(trimmed);
  return cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell));
}

/** Alignment as a class, not an inline style — the page's CSP has no `unsafe-inline`. */
function alignClass(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ' class="md-center"';
  if (right) return ' class="md-right"';
  return "";
}

function renderTable(rows: readonly string[], resolve?: WikilinkResolver): string {
  const header = splitRow(rows[0]!);
  const aligns = splitRow(rows[1]!).map(alignClass);
  const head = header.map((cell, i) => `<th${aligns[i] ?? ""}>${inline(cell, resolve)}</th>`).join("");
  const body = rows
    .slice(2)
    .map((row) => {
      // A ragged row is padded rather than dropped: one bad line in a pasted
      // spreadsheet should not take the rows around it down with it.
      const cells = splitRow(row);
      const tds = header
        .map((_, i) => `<td${aligns[i] ?? ""}>${inline(cells[i] ?? "", resolve)}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Render markdown prose (no fenced code blocks) to HTML. */
export function renderProseMarkdown(md: string, resolve?: WikilinkResolver): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listTag) {
      out.push(`</${listTag}>`);
      listTag = null;
    }
  };
  const openList = (tag: "ul" | "ol") => {
    if (listTag !== tag) {
      closeList();
      out.push(`<${tag}>`);
      listTag = tag;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    const singleLineDisplay = /^\$\$([\s\S]+)\$\$$/.exec(trimmed);
    if (singleLineDisplay) {
      closeList();
      out.push(`<div class="math-display">${renderMath(singleLineDisplay[1]!, true)}</div>`);
      continue;
    }
    if (trimmed === "$$") {
      const closing = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.trim() === "$$");
      if (closing !== -1) {
        closeList();
        out.push(`<div class="math-display">${renderMath(lines.slice(index + 1, closing).join("\n"), true)}</div>`);
        index = closing;
        continue;
      }
    }
    // Blockquotes and Obsidian callouts: `> [!note] Title` … `> body`.
    if (trimmed.startsWith(">")) {
      closeList();
      const quoteLines: string[] = [];
      let j = index;
      while (j < lines.length && lines[j]!.trim().startsWith(">")) {
        quoteLines.push(lines[j]!.replace(/^\s*>\s?/, ""));
        j += 1;
      }
      index = j - 1;
      const callout = /^\[!(\w+)\]\s*(.*)$/.exec(quoteLines[0] ?? "");
      if (callout) {
        const type = callout[1]!.toLowerCase();
        const title = callout[2]!.trim() || `${type[0]!.toUpperCase()}${type.slice(1)}`;
        const bodyLines = quoteLines.slice(1);
        const body = bodyLines.some((l) => l.trim())
          ? `<div class="callout-body">${renderProseMarkdown(bodyLines.join("\n"), resolve)}</div>`
          : "";
        out.push(
          `<div class="callout callout--${escapeAttr(type)}"><div class="callout-title">${escapeHtml(title)}</div>${body}</div>`,
        );
      } else {
        out.push(`<blockquote>${renderProseMarkdown(quoteLines.join("\n"), resolve)}</blockquote>`);
      }
      continue;
    }

    // A table: the header row, its divider, and every row that follows.
    if (trimmed.startsWith("|") && isTableDivider(lines[index + 1])) {
      closeList();
      let end = index + 2;
      while (end < lines.length && lines[end]!.trim().startsWith("|")) end += 1;
      out.push(renderTable(lines.slice(index, end), resolve));
      index = end - 1;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    const oli = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1]!.length;
      out.push(`<h${level + 2} id="${escapeAttr(headingSlug(h[2]!))}">${inline(h[2]!, resolve)}</h${level + 2}>`);
    } else if (li) {
      openList("ul");
      out.push(`<li>${inline(li[1]!, resolve)}</li>`);
    } else if (oli) {
      openList("ol");
      out.push(`<li>${inline(oli[1]!, resolve)}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      // Obsidian block id: trailing ` ^blockid` becomes an element id for `[[Note#^blockid]]`.
      const blockMatch = /^(.*)\s\^([A-Za-z0-9_-]+)\s*$/.exec(line);
      if (blockMatch) {
        const text = blockMatch[1]!;
        const blockId = blockMatch[2]!;
        out.push(`<p id="^${escapeAttr(blockId)}">${inline(text, resolve)}</p>`);
      } else {
        out.push(`<p>${inline(line, resolve)}</p>`);
      }
    }
  }
  closeList();
  return out.join("");
}

/** Simple synchronous renderer (logbook, paper summaries — no Shiki). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={className ? `markdown ${className}` : "markdown"}
      dangerouslySetInnerHTML={{ __html: renderProseMarkdown(children) }}
    />
  );
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;

/** Split markdown into prose and fenced-code segments for Shiki display. */
export async function renderMarkdownWithShiki(
  md: string,
  mode: "light" | "dark",
  highlight: (code: string, info: string, mode: "light" | "dark") => Promise<string>,
  resolve?: WikilinkResolver,
): Promise<string> {
  const parts: string[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(md)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderProseMarkdown(md.slice(lastIndex, match.index), resolve));
    }
    parts.push(await highlight(match[2] ?? "", match[1] ?? "", mode));
    lastIndex = FENCE_RE.lastIndex;
  }
  if (lastIndex < md.length) {
    parts.push(renderProseMarkdown(md.slice(lastIndex), resolve));
  }
  return parts.join("");
}
