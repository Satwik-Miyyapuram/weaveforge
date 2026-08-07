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
 * `docs/` is the working folder for the project, not a manual: most of it is
 * plans, strategy notes and engineering reports written for whoever is building
 * the thing. A visitor looking for "how do I use this" should not have to walk
 * past a competitive analysis and a backlog to find it.
 *
 * Excluded by folder, because everything in these is internal by nature:
 */
const PRIVATE_DIRS = new Set(["plans", "future-work", "demo"]);

/**
 * Excluded by name — internal even though they sit at the top level. Strategy,
 * competitive research, release process and one-off engineering reports.
 *
 * Nothing here is secret; it is all in a public repository, and each of these
 * is one click away on GitHub. It is simply not documentation.
 */
const PRIVATE_FILES = new Set([
  // Documents client-side E2EE under a heading that reads "What is
  // implemented". It is not: SECURITY.md says plainly that E2EE was dropped and
  // that row-level security is now the sole access boundary. Publishing both
  // would tell a reader their data is end-to-end encrypted when it is not,
  // which is the one kind of stale documentation that does harm.
  "CRYPTO_RECOVERY.md",
  "DEEP_RESEARCH_PRODUCT_BRIEF.md",
  "PRODUCT_AND_ICON_BRIEF.md",
  "DESIGN.md",
  "UI-SPEC.md",
  "PRIVACY_TEST_MATRIX.md",
  "competitive-scan.md",
  "competitive-research-verified-2026-07.md",
  "research-app-analysis.md",
  "pricing-strategy.md",
  "performance-bundle-report.md",
  "supabase-advisor-disposition.md",
  "publishing-checklist.md",
  "release.md",
  "changelog-sdk-legacy.md",
  "self-host-roadmap.md",
]);

function isPublished(relPath: string): boolean {
  const [head] = relPath.split("/");
  if (head && PRIVATE_DIRS.has(head)) return false;
  return !PRIVATE_FILES.has(relPath);
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
 * `storage/README.md` is that folder's index, so it becomes `/docs/storage/`
 * rather than `/docs/storage/README/` — a page titled "README" is an artefact
 * of the filesystem, not something a reader asked for.
 */
function slugFor(relPath: string): string[] {
  const withoutExt = relPath.replace(/\.md$/, "");
  if (withoutExt.endsWith("/README")) return withoutExt.slice(0, -"/README".length).split("/");
  return withoutExt.split("/");
}

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
    // A link to a document this site does not publish would 404 here. Send it
    // to the repository instead: the target still exists, it is just not part
    // of the manual.
    if (!isPublished(resolved)) return `${REPO_BLOB}/docs/${resolved}${suffix}`;
    return `/docs/${slugFor(resolved).join("/")}/${suffix}`;
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
