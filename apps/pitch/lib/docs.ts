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

/**
 * What gets published.
 *
 * `docs/` is the working folder for the project, not a manual: a good deal of
 * it is plans, strategy notes and engineering reports written for whoever is
 * building the thing. A visitor looking for "how do I use this" should not have
 * to walk past a competitive analysis and a backlog to find it.
 *
 * The rule used to be a list of sixteen filenames kept here, which meant every
 * new document was published until somebody remembered to add it. It is now a
 * property of where the file lives: `internal/` is for the working notes and
 * nothing in it is published; `using/`, `building/` and `running/` are the
 * manual. Nothing in `internal/` is secret — it is all one click away in a
 * public repository — it is simply not documentation.
 */
const PRIVATE_DIRS = new Set(["internal", "demo"]);

/**
 * `docs/README.md` is the folder's index for somebody reading the repository.
 * This site has its own index at `/docs`, so publishing it too would put two
 * lists of the same pages one click apart.
 */
const FOLDER_INDEX = "README.md";

/**
 * The files GitHub reads out of `docs/`.
 *
 * A code of conduct and a security policy live here because GitHub looks for
 * them in the root, `.github/` or `docs/` and nowhere else. They are repository
 * governance, shown by GitHub in its own places — they are not part of the
 * manual, and as pages they made the site open on a section of paperwork
 * before anything about the product.
 */
const GITHUB_FILES = new Set(["CODE_OF_CONDUCT.md", "SECURITY.md"]);

/**
 * The atlas is a generated HTML page, not Markdown, so it is not one of the
 * pages this module renders — `apps/pitch/scripts/copy-assets.mjs` copies it
 * into the export and it is served from the site root. It is named here so the
 * sidebar, the index and the links inside documents all point at the same
 * place, and so a link to `docs/atlas.html` resolves to the copy on this site
 * rather than to the raw file on GitHub.
 */
export const ATLAS = { href: "/atlas.html", title: "The atlas", relPath: "atlas.html" };

/** What each folder is called on the site, in the order they are shown. */
export const SECTION_LABELS: Record<string, string> = {
  using: "Using WeaveForge",
  building: "How it is built",
  running: "Running it yourself",
};

function isPublished(relPath: string): boolean {
  if (relPath === FOLDER_INDEX || GITHUB_FILES.has(relPath)) return false;
  const [head] = relPath.split("/");
  return !(head && PRIVATE_DIRS.has(head));
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

/**
 * URL segments for a file.
 *
 * `running/storage/README.md` is that folder's index, so it becomes
 * `/docs/running/storage/` rather than `…/README/` — a page titled "README" is an artefact
 * of the filesystem, not something a reader asked for.
 */
function slugFor(relPath: string): string[] {
  const withoutExt = relPath.replace(/\.md$/, "");
  if (withoutExt.endsWith("/README")) return withoutExt.slice(0, -"/README".length).split("/");
  return withoutExt.split("/");
}

/** The order sections read in; anything unlisted sorts after them. */
const SECTION_ORDER = ["using", "building", "running"];
const sectionRank = (section: string) => {
  const at = SECTION_ORDER.indexOf(section);
  return at === -1 ? SECTION_ORDER.length : at;
};

let cached: DocPage[] | null = null;

export function allDocs(): DocPage[] {
  if (cached) return cached;
  cached = walk(DOCS_ROOT)
    .map((full) => path.relative(DOCS_ROOT, full).split(path.sep).join("/"))
    .filter(isPublished)
    .map((relPath) => {
      const slug = slugFor(relPath);
      return {
        slug,
        relPath,
        title: titleOf(readFileSync(path.join(DOCS_ROOT, relPath), "utf8"), relPath),
        section: slug.length > 1 ? slug[0]! : "",
      };
    })
    // In reading order rather than alphabetical: the manual for a reader
    // first, then the two for somebody working on it. Alphabetical put
    // "building" first, which is not where a visitor starts.
    .sort((a, b) =>
      a.section === b.section
        ? a.title.localeCompare(b.title)
        : sectionRank(a.section) - sectionRank(b.section),
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
  if (resolved === ATLAS.relPath) return ATLAS.href;
  if (resolved.endsWith(".md")) {
    // A link to a document this site does not publish would 404 here. Send it
    // to the repository instead: the target still exists, it is just not part
    // of the manual.
    if (!isPublished(resolved)) return `${REPO_BLOB}/docs/${resolved}${suffix}`;
    return `/docs/${slugFor(resolved).join("/")}/${suffix}`;
  }
  return `${REPO_BLOB}/docs/${resolved}${suffix}`;
}

/**
 * A heading's anchor, spelled the way GitHub spells it.
 *
 * Docs are read in two places — here and in the repository — and a `#section`
 * link written for one has to land in the other. GitHub's rule is: lowercase,
 * drop anything that is not a word character, a space or a hyphen, then spaces
 * become hyphens.
 */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function renderDoc(page: DocPage): string {
  const source = readFileSync(path.join(DOCS_ROOT, page.relPath), "utf8");

  // A fresh instance per render: `marked` walkTokens is instance state, and the
  // link rewrite depends on which file we are rendering.
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = headingId(this.parser.parseInline(tokens, this.parser.textRenderer));
        return `<h${depth} id="${id}">${text}</h${depth}>`;
      },
    },
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
