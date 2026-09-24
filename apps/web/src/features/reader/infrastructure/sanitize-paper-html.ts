/**
 * Turn a fetched web page into the article the reader keeps — browser only.
 *
 * DOMPurify does the part that must be right: no scripts, no event handlers,
 * no forms, frames or embeds, no `javascript:` links. Around it, this picks the
 * article out of the page's chrome (navigation, cookie banners, footers),
 * makes every link and image absolute against the address the page came
 * from, and opens links outside the frame.
 *
 * Also run again on a file read back from the folder, so a file changed by
 * hand is never shown unsanitised.
 */

import DOMPurify from "dompurify";

export interface SanitizedPaperHtml {
  html: string;
  text: string;
  title: string;
}

/** Page furniture that is never the paper. */
const CHROME_SELECTOR = [
  "script",
  "noscript",
  "style",
  "link",
  "nav",
  "header[role=banner]",
  "footer",
  "form",
  "[role=navigation]",
  "[role=search]",
  "[aria-hidden=true]",
  ".cookie-banner",
  "#cookie-banner",
].join(",");

const FORBID_TAGS = [
  "form", "input", "button", "select", "textarea", "option",
  "iframe", "frame", "frameset", "object", "embed", "applet",
  "style", "link", "meta", "base", "script", "noscript", "template",
  "dialog", "portal",
];

function metaContent(doc: Document, names: string[]): string | undefined {
  for (const name of names) {
    const value = doc
      .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
      ?.getAttribute("content")
      ?.trim();
    if (value) return value;
  }
  return undefined;
}

function pickArticle(doc: Document): Element {
  const candidates = [
    doc.querySelector("article.ltx_document"), // arXiv / LaTeXML
    doc.querySelector("main article"),
    doc.querySelector("article"),
    doc.querySelector("main"),
    doc.querySelector("[role=main]"),
  ];
  return candidates.find((el): el is Element => el !== null) ?? doc.body;
}

function absolutize(root: Element, baseUrl: string): void {
  for (const el of Array.from(root.querySelectorAll("[href]"))) {
    const href = el.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    try {
      el.setAttribute("href", new URL(href, baseUrl).toString());
    } catch {
      el.removeAttribute("href");
    }
  }
  for (const el of Array.from(root.querySelectorAll("[src]"))) {
    const src = el.getAttribute("src") ?? "";
    if (src.startsWith("data:")) continue;
    try {
      el.setAttribute("src", new URL(src, baseUrl).toString());
    } catch {
      el.removeAttribute("src");
    }
  }
  // Lazy-loading pages keep the real image in a data attribute.
  for (const img of Array.from(root.querySelectorAll("img[data-src]"))) {
    try {
      img.setAttribute("src", new URL(img.getAttribute("data-src") ?? "", baseUrl).toString());
    } catch {
      /* leave it */
    }
  }
  for (const el of Array.from(root.querySelectorAll("[srcset]"))) el.removeAttribute("srcset");
}

export function collapseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sanitizePaperHtml(raw: string, baseUrl: string): SanitizedPaperHtml {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const title =
    metaContent(doc, ["citation_title", "dc.title", "DC.title", "og:title"]) ??
    (doc.querySelector("h1")?.textContent ?? doc.title ?? "").trim();
  const article = pickArticle(doc);
  for (const el of Array.from(article.querySelectorAll(CHROME_SELECTOR))) el.remove();
  absolutize(article, baseUrl);

  const purifier = DOMPurify(window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (href && !href.startsWith("#")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (node.nodeName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
  const html = purifier.sanitize(article.innerHTML, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS,
    FORBID_ATTR: ["style", "srcset", "formaction", "ping"],
    ALLOWED_URI_REGEXP: /^(?:https:|http:|mailto:|#|data:image\/(?:png|jpe?g|gif|webp);)/i,
    ADD_ATTR: ["target"],
  });
  const text = collapseText(new DOMParser().parseFromString(html, "text/html").body.textContent ?? "");
  return { html, text, title: collapseText(title) || "Untitled" };
}

/** The readable text of a kept page, for search. */
export function paperHtmlText(html: string): string {
  return collapseText(new DOMParser().parseFromString(html, "text/html").body.textContent ?? "");
}
