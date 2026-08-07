import { notFound } from "next/navigation";
import { allDocs, findDoc, renderDoc } from "../../../lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = findDoc(slug);
  return {
    title: page ? `${page.title} — WeaveForge docs` : "WeaveForge docs",
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = findDoc(slug);
  if (!page) notFound();

  return (
    <article className="docs-article">
      {/* The markdown is ours, read from the repository at build time — not
          user input, and never fetched at runtime. */}
      <div dangerouslySetInnerHTML={{ __html: renderDoc(page) }} />
      <footer className="docs-foot">
        <a
          href={`https://github.com/Satwik-Miyyapuram/weaveforge/blob/main/docs/${page.relPath}`}
          target="_blank"
          rel="noreferrer"
        >
          Edit this page on GitHub ↗
        </a>
      </footer>
    </article>
  );
}
