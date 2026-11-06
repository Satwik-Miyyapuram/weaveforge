import type { SemanticStatus } from "@/features/search/application/semantic-search";

/** The one line saying what the meaning-search arm is doing, and when done, that it works. */
export function semanticStatusText(status: SemanticStatus): string {
  switch (status.phase) {
    case "downloading":
      return `Downloading the model — ${Math.round((status.loaded / Math.max(status.total, 1)) * 100)}%`;
    case "loading":
      return "Starting the model…";
    case "embedding":
      return status.total
        ? `Reading your workspace — ${status.done.toLocaleString()} of ${status.total.toLocaleString()} passages`
        : "Reading your workspace…";
    case "ready":
      return status.upgrading
        ? `On (${status.model}). Upgrading to ${status.upgrading.to} in the background${
            status.upgrading.total
              ? ` — ${status.upgrading.done.toLocaleString()} of ${status.upgrading.total.toLocaleString()} passages`
              : "…"
          }. Search keeps using the current model until it is done.`
        : `On — ${status.passages.toLocaleString()} passages searchable by meaning (${status.model}). New and edited items are added as you work.${
            status.fallback ? " The app's own encoder did not load, so the browser's is used." : ""
          }`;
    case "error":
      return `Not working: ${status.message}. Keyword search is unaffected.`;
    default:
      return "Waiting to start…";
  }
}
