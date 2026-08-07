import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";

/**
 * The `docs/` folder, rendered as a static site.
 *
 * Reads at build time only — this module is imported by server components in a
 * `output: "export"` app, so every page is HTML on disk before anything is
 * served. Nothing here runs in a browser.
 */

const DOCS_ROOT = path.resolve(process.cwd(), "../../docs");
const REPO_BLOB = "https://github.com/Satwik-Miyyapuram/weaveforge/blob/main";

export interface DocPage {
  /** URL segments after /docs — `["backend", "oracle-shift-guide"]`. */
  slug: string[];
  /** Path relative to `docs/`, with extension — used for links between files. */
  relPath: string;
  title: string;
  /** Top-level folder, or "" for files directly in `docs/`. */
  section: string;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

/** The first `# heading`, falling back to the filename. */
function titleOf(markdown: string, relPath: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/[*_`]/g, "");
  return path
    .basename(relPath, ".md")
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

let cached: DocPage[] | null = null;

export function allDocs(): DocPage[] {
  if (cached) return cached;
  cached = walk(DOCS_ROOT)
    .map((full) => {
      const relPath = path.relative(DOCS_ROOT, full).split(path.sep).join("/");
      const slug = relPath.replace(/\.md$/, "").split("/");
      return {
        slug,
        relPath,
        title: titleOf(readFileSync(full, "utf8"), relPath),
        section: slug.length > 1 ? slug[0]! : "",
      };
    })
    // Files directly in docs/ first, then folders alphabetically — an index
    // that opens with the overview rather than with `backend/`.
    .sort((a, b) =>
      a.section === b.section
        ? a.title.localeCompare(b.title)
        : a.section === ""
          ? -1
          : b.section === ""
            ? 1
            : a.section.localeCompare(b.section),
    );
  return cached;
}

export function findDoc(slug: string[]): DocPage | undefined {
  const joined = slug.join("/");
  return allDocs().find((d) => d.slug.join("/") === joined);
}

/**
 * Rewrite a relative markdown link to where it lives on this site.
 *
 * A link to another `.md` file becomes a route here. A link to anything else in
 * the repository — a script, a SQL migration, a compose file — becomes a
 * GitHub link, because those are source and there is nothing to render.
 */
function rewriteHref(href: string, fromRel: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;

  const fromDir = path.posix.dirname(fromRel);
  const [pathPart, hash] = href.split("#");
  const resolved = path.posix.normalize(path.posix.join(fromDir, pathPart ?? ""));
  const suffix = hash ? `#${hash}` : "";

  // Outside docs/ — `../../scripts/foo.mjs`, `../../supabase/migrations/…`.
  if (resolved.startsWith("..")) {
    return `${REPO_BLOB}/${resolved.replace(/^(\.\.\/)+/, "")}${suffix}`;
  }
  if (resolved.endsWith(".md")) {
    return `/docs/${resolved.replace(/\.md$/, "")}/${suffix}`;
  }
  return `${REPO_BLOB}/docs/${resolved}${suffix}`;
}

export function renderDoc(page: DocPage): string {
  const source = readFileSync(path.join(DOCS_ROOT, page.relPath), "utf8");

  // A fresh instance per render: `marked` walkTokens is instance state, and the
  // link rewrite depends on which file we are rendering.
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    walkTokens(token) {
      if (token.type === "link" || token.type === "image") {
        token.href = rewriteHref(token.href, page.relPath);
      }
    },
  });

  return marked.parse(source, { async: false }) as string;
}

/** Docs grouped by folder, for the sidebar. */
export function docsBySection(): { section: string; pages: DocPage[] }[] {
  const groups = new Map<string, DocPage[]>();
  for (const page of allDocs()) {
    const list = groups.get(page.section) ?? [];
    list.push(page);
    groups.set(page.section, list);
  }
  return [...groups.entries()].map(([section, pages]) => ({ section, pages }));
}
