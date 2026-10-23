"use client";

/**
 * A paper kept as a web page, shown in the reader's place.
 *
 * The frame is sandboxed without `allow-scripts` or `allow-same-origin`: the
 * page cannot run code, read this app's storage or reach its APIs, and its
 * own CSP allows nothing but images. Links open in a new window, outside the
 * sandbox, so following a reference works as it would on the site.
 */

import { useMemo } from "react";
import { buildPaperHtmlDocument, type PaperHtmlPage } from "../application/paper-html";
import { useDarkPdf } from "./pdf-reader/use-dark-pdf";

export interface PaperHtmlViewProps {
  page: PaperHtmlPage;
  /** Shown at the end of the bar — the pane's "Load PDF…". */
  toolbarExtra?: React.ReactNode;
  /** Forget the kept page, so the pane looks for a PDF again. */
  onRemove?: () => void;
}

export function PaperHtmlView({ page, toolbarExtra, onRemove }: PaperHtmlViewProps) {
  const dark = useDarkPdf();
  const doc = useMemo(() => buildPaperHtmlDocument(page, { scheme: dark ? "dark" : "light" }), [page, dark]);
  const host = useMemo(() => {
    try {
      return new URL(page.url).hostname;
    } catch {
      return page.url;
    }
  }, [page.url]);

  return (
    <div className="paper-html-view">
      <div className="paper-html-bar" role="toolbar" aria-label="Web page">
        <span className="paper-html-kind">Web page</span>
        <a className="paper-html-source" href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
          {host} ↗
        </a>
        <span className="paper-html-spacer" />
        <button
          type="button"
          className="btn-secondary btn-sm"
          title="Print this page or save it as a PDF"
          onClick={() => printPaperHtml(page)}
        >
          Save as PDF…
        </button>
        {onRemove ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            title="Forget this page and look for a PDF again"
            onClick={onRemove}
          >
            Remove page
          </button>
        ) : null}
        {toolbarExtra}
      </div>
      <iframe
        className="paper-html-frame"
        title={page.title || "Paper"}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={doc}
      />
    </div>
  );
}

/**
 * Print the page from a frame of its own, so the dialog's "Save as PDF" keeps
 * real text. Still no scripts in it; same-origin and modals only so it can print.
 */
export function printPaperHtml(page: PaperHtmlPage): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  frame.srcdoc = buildPaperHtmlDocument(page, { scheme: "light", print: true });
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) return frame.remove();
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    win.focus();
    win.print();
  });
  document.body.appendChild(frame);
}
