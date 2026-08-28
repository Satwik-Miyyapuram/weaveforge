import Link from "next/link";
import { ATLAS, docsBySection, SECTION_LABELS } from "../../lib/docs";

export const metadata = { title: "Documentation — WeaveForge" };

export default function DocsIndex() {
  const sections = docsBySection();

  return (
    <article className="docs-article">
      <h1>Documentation</h1>
      <p className="docs-lede">
        Everything in the repository’s <code>docs/</code> folder, rendered. Each page links back to
        its source, so what you read here is what is in the tree.
      </p>

      <p className="docs-lede">
        <a href={ATLAS.href}>
          <strong>{ATLAS.title}</strong>
        </a>{" "}
        — the whole thing on one page: every feature, what talks to what, and how big each
        part is. Drawn by hand, with every figure read off the commit it was built from.
      </p>

      {sections.map(({ section, pages }) => (
        <section key={section || "root"}>
          <h2>{SECTION_LABELS[section] ?? section.replace(/[-_]/g, " ")}</h2>
          <ul className="docs-index-list">
            {pages.map((page) => (
              <li key={page.slug.join("/")}>
                <Link href={`/docs/${page.slug.join("/")}/`}>{page.title}</Link>
                <span className="docs-index-path">{page.relPath}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
