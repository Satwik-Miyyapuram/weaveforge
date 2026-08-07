import Link from "next/link";
import { docsBySection } from "../../lib/docs";

export const metadata = { title: "Documentation — WeaveForge" };

const SECTION_LABELS: Record<string, string> = {
  "": "Overview",
  backend: "Backend & hosting",
  storage: "Storage",
  plans: "Plans",
  "future-work": "Future work",
};

export default function DocsIndex() {
  const sections = docsBySection();

  return (
    <article className="docs-article">
      <h1>Documentation</h1>
      <p className="docs-lede">
        Everything in the repository’s <code>docs/</code> folder, rendered. Each page links back to
        its source, so what you read here is what is in the tree.
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
