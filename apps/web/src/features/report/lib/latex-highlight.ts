import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * LaTeX colours as Overleaf's editor has them: commands, their environment and
 * option arguments, math, comments and braces. Classes only; the colours come
 * from theme tokens in markdown.css, so every site theme gets its own.
 */
export const latexHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.keyword], class: "cm-tex-command" },
  { tag: [t.attributeValue, t.typeName], class: "cm-tex-arg" },
  { tag: [t.string, t.literal], class: "cm-tex-math" },
  { tag: t.comment, class: "cm-tex-comment" },
  { tag: [t.brace, t.squareBracket], class: "cm-tex-bracket" },
]);
