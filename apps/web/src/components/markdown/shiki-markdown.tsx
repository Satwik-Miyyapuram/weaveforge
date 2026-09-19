"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { highlightCodeBlock, type ColorMode } from "@/lib/shiki-render";
import { renderMarkdownWithShiki, renderProseMarkdown, type MarkdownRenderOptions, type WikilinkResolver } from "@/components/markdown/markdown";

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
  resolveImageSrc,
}: {
  children: string;
  className?: string;
  resolveWikilink?: WikilinkResolver;
  /** `paperimg:`/`vault:` src → a fetchable URL, or null to drop the image. */
  resolveImageSrc?: MarkdownRenderOptions["resolveImageSrc"];
}) {
  const mode = useColorMode();
  const options = useMemo<MarkdownRenderOptions>(
    () => ({ resolveWikilink, resolveImageSrc }),
    [resolveWikilink, resolveImageSrc],
  );
  const fallbackHtml = useMemo(
    () => renderProseMarkdown(children, options),
    [children, options],
  );
  const [html, setHtml] = useState<string | null>(null);
  // What the current `html` was rendered from. A resolver handed down as a
  // new closure re-runs the effect without changing the text; dropping to the
  // fallback in between rewrote the whole body on every pane focus, and a
  // link whose node died between mousedown and mouseup never got its click.
  const rendered = useRef<{ children: string; mode: ColorMode } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const current = rendered.current;
    if (!current || current.children !== children || current.mode !== mode) setHtml(null);
    void renderMarkdownWithShiki(children, mode, highlightCodeBlock, options).then((next) => {
      if (cancelled) return;
      rendered.current = { children, mode };
      setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [children, mode, options]);

  const cls = className ? `markdown shiki-markdown ${className}` : "markdown shiki-markdown";
  // One object per html string. React resets innerHTML whenever it is handed
  // a new `dangerouslySetInnerHTML` object, same text or not, so an inline
  // literal rewrote every read body on each re-render of the screen — a pane
  // focus on mousedown was enough — and the link under the pointer was gone
  // before mouseup, so no click ever fired.
  const current = html ?? fallbackHtml;
  const markup = useMemo(() => ({ __html: current }), [current]);

  return (
    <div
      className={cls}
      aria-busy={html === null}
      dangerouslySetInnerHTML={markup}
    />
  );
}
