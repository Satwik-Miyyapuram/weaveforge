"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { ErrorReportPanel } from "@/app/error-report-panel-lazy";
import type { ReportContext } from "@/app/error-report-panel";

const HEADINGS = "h1, h2, h3, h4, .settings-group";

/**
 * The screen and section an element sits in, as a reader would name them:
 * "Experiments › Metrics".
 *
 * Read from the page rather than passed in, so every `FormError` gets it for
 * free: walk up from the button, and at each level take the last heading that
 * comes before it — the section title it is under. The page's own title is the
 * first `h1`.
 */
function locate(from: Element): string {
  const trail: string[] = [];
  let node: Element | null = from;
  while (node && trail.length < 2) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      const heading = sibling.matches(HEADINGS) ? sibling : sibling.querySelector(HEADINGS);
      const text = heading?.textContent?.trim();
      if (text) {
        if (!trail.includes(text)) trail.unshift(text);
        break;
      }
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }
  const page = document.querySelector("main h1, h1")?.textContent?.trim();
  if (page && !trail.includes(page)) trail.unshift(page);
  return trail.map((part) => (part.length > 60 ? `${part.slice(0, 57)}…` : part)).join(" › ");
}

/**
 * "Report" beside an error message, for the errors that are not crashes.
 *
 * The crash screens could always be reported; a failed save, import or sign-in
 * shown inline could not, and those are most of what goes wrong. The message is
 * read from the page when the button is pressed (`readMessage`), so it is the
 * text the reader saw, not a guess at it — and so are where it was shown and
 * when, which a report without steps otherwise has no trace of.
 */
export function ReportErrorButton({ readMessage }: { readMessage: () => string }) {
  const [report, setReport] = useState<{ message: string; context: ReportContext } | null>(null);
  return (
    <>
      <button
        type="button"
        className="error-report-link"
        onClick={(event) =>
          setReport({
            message: readMessage().trim() || "An error was shown",
            context: { where: locate(event.currentTarget), at: new Date().toISOString() },
          })
        }
      >
        Report
      </button>
      {report !== null ? (
        <Modal title="Report this problem" onClose={() => setReport(null)}>
          <ErrorReportPanel
            open
            title={report.message.length > 120 ? `${report.message.slice(0, 117)}…` : report.message}
            detail={report.message}
            context={report.context}
          />
        </Modal>
      ) : null}
    </>
  );
}
