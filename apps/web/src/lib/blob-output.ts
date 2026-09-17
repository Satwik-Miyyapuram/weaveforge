/**
 * Handing a file to the user: a download, or a data URL to embed.
 *
 * Two small things that several features need and none of them owns.
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
