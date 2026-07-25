/**
 * Markdown → LaTeX subset for Overleaf export packages.
 * KaTeX HTML is never used — equations stay as raw TeX delimiters.
 * `reportimg:` markdown images become `\includegraphics` under `figures/`.
 * `[[Paper Title]]` wikilinks become `\cite{key}` when a cite map is provided.
 * Other unsupported constructs become warnings, not silent drops.
 */

import { normalizeTitleKey } from "../../vault/domain/vault-page.js";

export interface MarkdownToLatexImageRef {
  /** Storage path after `reportimg:`. */
  path: string;
  /** Relative path used in `\includegraphics{...}` (under `figures/`). */
  fileName: string;
}

export interface MarkdownToLatexOptions {
  /**
   * Map of `normalizeTitleKey(paper.title)` → biblatex cite key.
   * When set, matching `[[wikilinks]]` become `\cite{key}`.
   */
  citeByTitle?: ReadonlyMap<string, string>;
}

export interface MarkdownToLatexResult {
  latex: string;
  warnings: string[];
  images: MarkdownToLatexImageRef[];
  /** Bib keys emitted via `\cite{...}` (unique, insertion order). */
  citedKeys: string[];
}

const UNSUPPORTED = [
  { re: /\|.+\|[\r\n]+\|[-:| ]+\|/m, label: "markdown table" },
  { re: /<[^>]+>/, label: "raw HTML" },
  { re: /!\[[^\]]*\]\((?!reportimg:)[^)\s]+\)/, label: "non-report image (include assets separately)" },
];

function escapeLatexText(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}$&#^_%])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}");
}

function figureFileName(storagePath: string, used: Set<string>): string {
  const raw = storagePath.split("/").pop() || "figure.bin";
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, "_") || "figure.bin";
  let name = safe;
  let n = 2;
  while (used.has(name)) {
    const dot = safe.lastIndexOf(".");
    name = dot > 0 ? `${safe.slice(0, dot)}_${n}${safe.slice(dot)}` : `${safe}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/** Rewrite `![alt](reportimg:path)` into a LaTeX figure and collect asset refs. */
function rewriteReportImages(md: string): { text: string; images: MarkdownToLatexImageRef[] } {
  const images: MarkdownToLatexImageRef[] = [];
  const used = new Set<string>();
  const text = md.replace(/!\[([^\]]*)\]\(reportimg:([^)\s]+)\)/g, (_m, alt: string, path: string) => {
    const fileName = figureFileName(path, used);
    images.push({ path, fileName });
    const caption = escapeLatexText((alt || "Figure").trim() || "Figure");
    return [
      "",
      "\\begin{figure}[ht]",
      "\\centering",
      `\\includegraphics[width=\\linewidth]{figures/${fileName}}`,
      `\\caption{${caption}}`,
      "\\end{figure}",
      "",
    ].join("\n");
  });
  return { text, images };
}

function applyInlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1\\emph{$2}")
    .replace(/`([^`]+)`/g, "\\texttt{$1}")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "\\href{$2}{$1}");
}

/** Parse `Target`, `Target|alias`, `Target#Heading` from a wikilink inner. */
function parseWikilinkTarget(inner: string): { target: string; alias?: string } {
  const pipe = inner.indexOf("|");
  const link = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
  const hash = link.indexOf("#");
  const target = (hash === -1 ? link : link.slice(0, hash)).trim();
  return { target, alias };
}

/**
 * Escape markdown text and turn matching `[[Paper]]` into `\cite{key}`.
 * Unresolved links become escaped display text (alias or target).
 */
function textWithCites(
  s: string,
  citeByTitle: ReadonlyMap<string, string> | undefined,
  warnings: string[],
  citedKeys: Set<string>,
): string {
  if (!s) return "";
  const re = /\[\[([^\[\]\n]+?)\]\]/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out += applyInlineMarkdown(escapeLatexText(s.slice(last, m.index)));
    const { target, alias } = parseWikilinkTarget(m[1]!);
    const key = target ? citeByTitle?.get(normalizeTitleKey(target)) : undefined;
    if (key) {
      out += `\\cite{${key}}`;
      citedKeys.add(key);
    } else {
      const label = alias || target || m[1]!.trim();
      out += applyInlineMarkdown(escapeLatexText(label));
      if (target && citeByTitle) {
        warnings.push(`Wikilink [[${target}]] is not a paper in the library — left as text.`);
      }
    }
    last = m.index + m[0].length;
  }
  out += applyInlineMarkdown(escapeLatexText(s.slice(last)));
  return out;
}

/** Convert a limited Markdown subset to LaTeX body (no document wrapper). */
export function markdownToLatex(md: string, opts: MarkdownToLatexOptions = {}): MarkdownToLatexResult {
  const warnings: string[] = [];
  const citedKeys = new Set<string>();
  if (!md?.trim()) return { latex: "", warnings, images: [], citedKeys: [] };

  const { text: withFigures, images } = rewriteReportImages(md);

  for (const u of UNSUPPORTED) {
    if (u.re.test(withFigures)) warnings.push(`Unsupported Markdown: ${u.label} — left as comments or omitted.`);
  }

  const lines = withFigures.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("\\end{itemize}");
      inList = false;
    }
  };

  const inline = (s: string) => textWithCites(s, opts.citeByTitle, warnings, citedKeys);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith("```")) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = line.trim().slice(3).trim();
        codeBuf = [];
      } else {
        inCode = false;
        out.push("\\begin{verbatim}");
        out.push(...codeBuf);
        out.push("\\end{verbatim}");
        if (codeLang) warnings.push(`Code fence language "${codeLang}" ignored in verbatim.`);
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // Pass through figure blocks already rewritten from reportimg:
    if (
      line.startsWith("\\begin{figure}") ||
      line.startsWith("\\centering") ||
      line.startsWith("\\includegraphics") ||
      line.startsWith("\\caption{") ||
      line === "\\end{figure}"
    ) {
      closeList();
      out.push(line);
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1]!.length;
      const cmd = level === 1 ? "section" : level === 2 ? "subsection" : "subsubsection";
      out.push(`\\${cmd}{${inline(h[2]!)}}`);
      continue;
    }

    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) {
        out.push("\\begin{itemize}");
        inList = true;
      }
      out.push(`\\item ${inline(li[1]!)}`);
      continue;
    }

    if (line.trim() === "") {
      closeList();
      out.push("");
      continue;
    }

    const display = /^\$\$(.+)\$\$$/.exec(line.trim());
    if (display) {
      closeList();
      out.push(`\\[${display[1]!}\\]`);
      continue;
    }
    if (line.trim() === "$$") {
      const closing = lines.findIndex((c, j) => j > i && c.trim() === "$$");
      if (closing !== -1) {
        closeList();
        out.push("\\[");
        out.push(...lines.slice(i + 1, closing));
        out.push("\\]");
        i = closing;
        continue;
      }
    }

    closeList();
    out.push(inlineToLatex(line, opts.citeByTitle, warnings, citedKeys));
  }
  closeList();
  if (inCode) {
    warnings.push("Unclosed code fence — content omitted from export.");
  }

  return { latex: out.join("\n").trim(), warnings, images, citedKeys: [...citedKeys] };
}

function inlineToLatex(
  s: string,
  citeByTitle: ReadonlyMap<string, string> | undefined,
  warnings: string[],
  citedKeys: Set<string>,
): string {
  const parts: { kind: "text" | "math"; value: string }[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "$") {
      const end = s.indexOf("$$", i + 2);
      if (end !== -1) {
        parts.push({ kind: "math", value: `\\[${s.slice(i + 2, end)}\\]` });
        i = end + 2;
        continue;
      }
    }
    if (s[i] === "$") {
      const end = s.indexOf("$", i + 1);
      if (end !== -1 && !s.slice(i + 1, end).includes("\n")) {
        parts.push({ kind: "math", value: `$${s.slice(i + 1, end)}$` });
        i = end + 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < s.length && s[j] !== "$") j++;
    parts.push({ kind: "text", value: s.slice(i, j) });
    i = j;
  }

  return parts
    .map((p) => {
      if (p.kind === "math") return p.value;
      return textWithCites(p.value, citeByTitle, warnings, citedKeys);
    })
    .join("");
}
