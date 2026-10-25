import { logToApp, type AppLogInput } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";

/**
 * Remember where a fetched PDF came from, so the paper can fetch it again.
 *
 * The bytes are already kept, so a failed link must not fail the fetch; the
 * link is a convenience for next time. It is logged rather than dropped.
 */
export async function linkPdfSource(
  setPdfSource: (paperId: string, url: string) => Promise<unknown>,
  paperId: string,
  url: string,
  log: (input: AppLogInput) => void = logToApp,
): Promise<void> {
  try {
    await setPdfSource(paperId, url);
  } catch (err) {
    log({
      level: "warn",
      source: "reader",
      message: "Could not link the fetched PDF to its paper",
      detail: `${paperId} ${url}: ${describeRejection(err)}`,
    });
  }
}
