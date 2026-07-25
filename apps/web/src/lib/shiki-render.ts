import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type ColorMode = "light" | "dark";

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("@shikijs/themes/github-light"),
        import("@shikijs/themes/github-dark"),
      ],
      langs: [
        import("@shikijs/langs/javascript"),
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/python"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/bash"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/yaml"),
        import("@shikijs/langs/rust"),
        import("@shikijs/langs/go"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

async function resolveLang(highlighter: HighlighterCore, info: string): Promise<string> {
  const raw = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!raw) return "markdown";
  const lang = LANG_ALIASES[raw] ?? raw;
  if (highlighter.getLoadedLanguages().includes(lang)) return lang;
  try {
    await highlighter.loadLanguage(lang as Parameters<HighlighterCore["loadLanguage"]>[0]);
    return lang;
  } catch {
    return "markdown";
  }
}

/** Highlight a fenced code block with Shiki (display / read mode only). */
export async function highlightCodeBlock(
  code: string,
  info: string,
  mode: ColorMode,
): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = await resolveLang(highlighter, info);
  return highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang,
    theme: mode === "dark" ? "github-dark" : "github-light",
  });
}
