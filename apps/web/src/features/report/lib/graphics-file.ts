/** A binary file in an Overleaf project: its id and path from the root. */
export type ProjectFile = { id: string; path: string };

/** The extensions pdflatex tries, in its order, when `\includegraphics` names none. */
const TRIED = ["png", "pdf", "jpg", "jpeg", "PNG", "PDF", "JPG", "JPEG"];

/** The project file an `\includegraphics` path names, or null. */
export function graphicsFileFor(
  files: readonly ProjectFile[],
  path: string,
): (ProjectFile & { extension: string }) | null {
  const wanted = path.replace(/^\.\//, "");
  if (!wanted) return null;
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const candidate of [wanted, ...TRIED.map((ext) => `${wanted}.${ext}`)]) {
    const file = byPath.get(candidate);
    if (file) return { ...file, extension: file.path.slice(file.path.lastIndexOf(".") + 1) };
  }
  return null;
}

/** Files the Visual editor can draw: images and PDFs. */
const PREVIEWABLE = /\.(png|jpe?g|gif|webp|svg|pdf)$/i;

/** The project files worth fetching for Visual previews. */
export function previewableFiles<T extends ProjectFile>(files: readonly T[]): T[] {
  return files.filter((f) => PREVIEWABLE.test(f.path));
}

/**
 * Overleaf's `previewByPath` for our project: an `\includegraphics` path to the
 * fetched file's URL, or null while it is not fetched.
 */
export function previewResolver(
  files: readonly ProjectFile[],
  urls: ReadonlyMap<string, string>,
): (path: string) => { url: string; extension: string } | null {
  return (path) => {
    const file = graphicsFileFor(files, path);
    const url = file && urls.get(file.id);
    return file && url ? { url, extension: file.extension } : null;
  };
}
