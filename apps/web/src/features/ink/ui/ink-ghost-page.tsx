"use client";

/**
 * The rail's ghost pages: the neighbours a continuous scroll scrolls through.
 *
 * Only the page being written on is live — its canvas, its worker, its
 * camera. The rest of the note is still one scroll away, so the rail puts a
 * placeholder of the page's own size above and below it: same width, same
 * height, same paper, same background image, so the scroll lands somewhere
 * that looks like the page it will become when it is reached.
 *
 * A ghost is deliberately nothing more. No canvas is created — the whole
 * point of the one-live-page window is that the compositor is never asked for
 * a second page-sized surface — and no pointer routing: a ghost is not the
 * page, and reaching it flips the note to it (the host's scroll watcher),
 * which is what turns it into the live page.
 */

export interface InkGhostPageProps {
  /** 0-based, for the label a reader sees on the sheet. */
  index: number;
  /** The page's size in 0.1 mm, so the slot is exactly the live page's box. */
  pageSize: { width: number; height: number };
  /** CSS pixels per 0.1 mm, the same fit the live sheet is drawn at. */
  scale: number;
  /** The page's paper, so a ruled page reads as ruled from a distance. */
  paper: string;
  /** The page's background attachment, when its text layer names one. */
  backgroundUrl?: string | null;
  /** How far through the vault the image has loaded; `null` while pending. */
  onLoadError?: () => void;
}

export function InkGhostPage({
  index,
  pageSize,
  scale,
  paper,
  backgroundUrl,
  onLoadError,
}: InkGhostPageProps) {
  const width = Math.max(1, Math.round(pageSize.width * scale));
  const height = Math.max(1, Math.round(pageSize.height * scale));
  return (
    <div
      className="ink-page"
      data-ghost={index}
      aria-hidden="true"
    >
      <div
        className={`ink-sheet ink-ghost paper-${paper}`}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {backgroundUrl ? (
          // The sheet's cover: `object-fit: contain` keeps the same placement
          // the live page's background draws with (`placeOnSheet`), so the
          // ghost does not jump when the page becomes live.
          //
          // A plain `<img>`: `backgroundUrl` is a `blob:` URL from
          // `use-ghost-images.ts`, made and revoked in this tab, which the
          // `next/image` optimizer has no route for.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="ink-ghost-image"
            src={backgroundUrl}
            alt=""
            onError={onLoadError}
          />
        ) : null}
        <span className="ink-ghost-label">{index + 1}</span>
      </div>
    </div>
  );
}
