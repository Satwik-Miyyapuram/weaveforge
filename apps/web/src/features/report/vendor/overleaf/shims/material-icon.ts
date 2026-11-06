/** The two icons the preamble widget uses, as plain glyphs instead of Material Symbols. */
const GLYPHS: Record<string, string> = { expand_more: "▾", help: "?" };

export function materialIcon(type: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "material-symbols";
  el.setAttribute("aria-hidden", "true");
  el.textContent = GLYPHS[type] ?? "";
  return el;
}
