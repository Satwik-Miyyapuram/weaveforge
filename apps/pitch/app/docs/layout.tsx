import Link from "next/link";
import { docsBySection } from "../../lib/docs";
import "./docs.css";

const SECTION_LABELS: Record<string, string> = {
  "": "Overview",
  backend: "Backend & hosting",
  storage: "Storage",
  plans: "Plans",
  "future-work": "Future work",
};

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
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
