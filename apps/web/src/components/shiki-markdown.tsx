"use client";

import { useEffect, useMemo, useState } from "react";
import { highlightCodeBlock, type ColorMode } from "@/lib/shiki-render";
import { renderMarkdownWithShiki, renderProseMarkdown, type WikilinkResolver } from "./markdown";

function readColorMode(): ColorMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.mode === "dark" ? "dark" : "light";
}

function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(readColorMode);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setMode(readColorMode());
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["data-mode"] });
    sync();
    return () => obs.disconnect();
  }, []);

  return mode;
}

/**
 * Read-mode markdown: prose HTML + Shiki-highlighted fenced code blocks.
 * Shows prose immediately; upgrades code fences when Shiki finishes loading.
 */
export function ShikiMarkdown({
  children,
  className,
  resolveWikilink,
}: {
  children: string;
  className?: string;
  resolveWikilink?: WikilinkResolver;
}) {
  const mode = useColorMode();
  const fallbackHtml = useMemo(
    () => renderProseMarkdown(children, resolveWikilink),
    [children, resolveWikilink],
  );
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void renderMarkdownWithShiki(children, mode, highlightCodeBlock, resolveWikilink).then((next) => {
      if (!cancelled) setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [children, mode, resolveWikilink]);

  const cls = className ? `markdown shiki-markdown ${className}` : "markdown shiki-markdown";

  return (
    <div
      className={cls}
      aria-busy={html === null}
      dangerouslySetInnerHTML={{ __html: html ?? fallbackHtml }}
    />
  );
}
