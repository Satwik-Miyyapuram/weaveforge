/**
 * Handing a file to the user: a download, a data URL, or the print dialog.
 *
 * Three small things that several features need and none of them owns. The
 * print path is the one with a trick in it: a page is printed from an image in
 * a hidden same-origin iframe sized to A4 with no margin, rather than by
 * printing the DOM the user is looking at — a canvas that shows a *window* onto
 * a sheet prints as the window.
 */

/** Triggers a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * A blob as a `data:` URL.
 *
 * What an exported document needs when it embeds a picture: a `blob:` URL dies
 * with the page that made it, so a saved SVG would open with a hole in it.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** How long a print frame may outlive its dialog before it is torn down. */
const PRINT_FRAME_TIMEOUT_MS = 60_000;

/**
 * Print a raster on a sheet of A4, no margin, one page.
 *
 * Chrome and Edge show "Save as PDF" in the same dialog, which is the printer
 * most people have; Firefox prints to a file the same way. The frame is torn
 * down when the dialog closes (`afterprint`) or after a minute, whichever comes
 * first, because a browser that never fires the event must not leave an iframe
 * holding a megabyte of PNG for the rest of the session.
 */
export function printBlob(
  blob: Blob,
  filename: string,
  title = filename,
): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // Visible rather than `display:none`: a hidden frame is not laid out, and a
  // frame with no layout prints blank in some builds.
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:100%;height:auto}</style></head><body><img src="${url}" alt=""></body></html>`;

  let done = false;
  const cleanUp = () => {
    if (done) return;
    done = true;
    frame.remove();
    URL.revokeObjectURL(url);
  };

  frame.addEventListener(
    "load",
    () => {
      const view = frame.contentWindow;
      if (!view) {
        cleanUp();
        return;
      }
      view.addEventListener("afterprint", cleanUp, { once: true });
      view.focus();
      view.print();
      setTimeout(cleanUp, PRINT_FRAME_TIMEOUT_MS);
    },
    { once: true },
  );
  document.body.appendChild(frame);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
