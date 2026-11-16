/**
 * Overleaf's stylesheet is compiled nested under `.ol-ide` (see
 * `build-overleaf-assets.mjs`). Three kinds of rule then need their selector
 * fixed so they still match:
 *
 * - `:root`, `html` or `body` rules apply to the `.ol-ide` element itself. A
 *   rule whose subject is `html` or `body` (height, background, font) styles a
 *   page, so it skips the overlays tagged `ol-ide`; `:root` variables do not.
 * - Theme rules (`[data-theme=light] …`) key off the attribute Overleaf sets on
 *   document.body, which is an ancestor of `.ol-ide`, not inside it.
 * - Overlays the IDE appends to document.body carry `ol-ide` themselves, so a
 *   rule aimed at one (`.ol-ide .modal …`) also gets a form that matches it
 *   directly (`.ol-ide.modal …`).
 */
const OVERLAY = "modal|modal-backdrop|tooltip|popover|dropdown-menu|context-menu";

const NOT_OVERLAY = `:not(${OVERLAY.split("|").map((c) => `.${c}`).join(",")})`;

export function scopeRoots(text) {
  return text
    .replace(/\.ol-ide (?:html|body)(?=[,{])/g, `.ol-ide${NOT_OVERLAY}`)
    .replace(/\.ol-ide (?::root|html|body)(?=[\s,{.:[>~+])/g, ".ol-ide")
    .replace(/(^|[{},])\.ol-ide (\[data-theme=[\w-]+\])/g, "$1body$2 .ol-ide")
    .replace(
      new RegExp(
        String.raw`(^|[{},])((?:body\[data-theme=[\w-]+\] )?)\.ol-ide (\.(?:${OVERLAY})(?![\w-])[^,{()]*)(?=[,{])`,
        "g",
      ),
      "$1$2.ol-ide $3,$2.ol-ide$3",
    );
}
