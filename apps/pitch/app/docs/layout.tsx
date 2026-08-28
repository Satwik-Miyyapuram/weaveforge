import Link from "next/link";
import { ATLAS, docsBySection, SECTION_LABELS } from "../../lib/docs";
import "./docs.css";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const sections = docsBySection();

  return (
    <div className="docs-shell">
      <aside className="docs-nav">
        <Link href="/" className="docs-home">
          ← WeaveForge
        </Link>
        <nav>
          {sections.map(({ section, pages }) => (
            <section key={section || "root"} className="docs-nav-group">
              <h2>{SECTION_LABELS[section] ?? section.replace(/[-_]/g, " ")}</h2>
              <ul>
                {pages.map((page) => (
                  <li key={page.slug.join("/")}>
                    <Link href={`/docs/${page.slug.join("/")}/`}>{page.title}</Link>
                  </li>
                ))}
                {/* Sits with the rest of "how it is built" even though it is not
                    a Markdown page: a reader looking for the map should find it
                    where the map belongs, not only by knowing the URL. */}
                {section === "building" && (
                  <li>
                    <a href={ATLAS.href}>{ATLAS.title}</a>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
