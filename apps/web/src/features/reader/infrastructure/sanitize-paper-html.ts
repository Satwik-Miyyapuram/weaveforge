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
import { readyCore } from "@/lib/rust-core";

export interface SanitizedPaperHtml {
  html: string;
  text: string;
  title: string;
}

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
  const core = readyCore();
  for (const el of Array.from(root.querySelectorAll("[href]"))) {
    const href = el.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    const resolved = core.resolveAbsoluteUrl(href, baseUrl);
    if (resolved === null) el.removeAttribute("href");
    else el.setAttribute("href", resolved);
  }
  for (const el of Array.from(root.querySelectorAll("[src]"))) {
    const src = el.getAttribute("src") ?? "";
    if (src.startsWith("data:")) continue;
    const resolved = core.resolveAbsoluteUrl(src, baseUrl);
    if (resolved === null) el.removeAttribute("src");
    else el.setAttribute("src", resolved);
  }
  // Lazy-loading pages keep the real image in a data attribute.
  for (const img of Array.from(root.querySelectorAll("img[data-src]"))) {
    const resolved = core.resolveAbsoluteUrl(img.getAttribute("data-src") ?? "", baseUrl);
    if (resolved !== null) img.setAttribute("src", resolved);
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
  for (const el of Array.from(article.querySelectorAll(readyCore().paperHtmlChromeSelector()))) el.remove();
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
    FORBID_TAGS: readyCore().paperHtmlForbidTags(),
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
