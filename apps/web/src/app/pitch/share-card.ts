import type { Metadata } from "next";

/**
 * The link-preview card for the pitch — one copy, for both hosts that serve it.
 *
 * The page is shared the same way: `apps/pitch/app/page.tsx` re-exports
 * `@/app/pitch/page` rather than copying it, so the scrollytelling a visitor
 * scrolls is the code the product runs. The metadata has to follow that rule or
 * the two hosts drift, and a card that drifts is worse than the missing one this
 * replaces: it is the title and description someone reads *before* deciding to
 * click, so a stale one is a claim the page then contradicts.
 *
 * Both hosts call this and differ only in where they answer and what their asset
 * paths are prefixed with.
 */

export const PITCH_TITLE = "WeaveForge — one workspace for research";

export const PITCH_DESCRIPTION =
  "Papers, notes, plan, experiments and writing in one project, so the reasoning behind your research survives the years it takes to do it.";

/**
 * The card image, in `public/` on both hosts.
 *
 * One file rather than two: `apps/web/public/og.png` is the copy that is
 * committed, and `apps/pitch/scripts/copy-assets.mjs` puts it in the export's
 * `public/` at build time for the reason it records — a brand asset committed
 * twice is one that silently goes stale.
 */
const OG_IMAGE = "og.png";

/** The shipped deployment's origin: what an unset override means. */
export const DEFAULT_APP_ORIGIN = "https://app.weaveforge.org";

/**
 * Resolve the origin an app deployment answers on, for `metadataBase`.
 *
 * `NEXT_PUBLIC_APP_URL` is the variable the project already uses for "where the
 * app lives" — the exported site is built with it so its "Open the app" button
 * points somewhere real — so a self-hosted copy that sets it gets a card naming
 * its own host instead of ours.
 *
 * Parsed rather than trusted, and a module of its own rather than a line in the
 * layout, because the call runs at build time: `new URL()` on a bad value would
 * fail the build over a link-preview card. A value that is not an absolute
 * http(s) URL is ignored, not honoured — including the bare path the pitch's own
 * `links.ts` falls back to, which is the shape a mis-set variable takes.
 */
export function appOriginFrom(configured: string | undefined): string {
  if (!configured) return DEFAULT_APP_ORIGIN;
  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : DEFAULT_APP_ORIGIN;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

export interface PitchShareCardOptions {
  /** Absolute origin this host answers on. Becomes `metadataBase`. */
  origin: string;
  /** Path prefix for a deploy that does not sit at the domain root. */
  basePath?: string;
  /** The pitch's own path, after that prefix. */
  path?: string;
}

/**
 * Build the `Metadata` for a host serving the pitch.
 *
 * `metadataBase` is not a nicety here: without it Next resolves the relative
 * `og:image` against nothing and warns, and most crawlers then drop the image
 * and render a card with no picture — the failure this exists to prevent.
 */
export function pitchShareMetadata({
  origin,
  basePath = "",
  path = "/",
}: PitchShareCardOptions): Metadata {
  const image = `${basePath}/${OG_IMAGE}`;
  return {
    metadataBase: new URL(origin),
    title: PITCH_TITLE,
    description: PITCH_DESCRIPTION,
    openGraph: {
      type: "website",
      siteName: "WeaveForge",
      locale: "en",
      url: `${basePath}${path}`,
      title: PITCH_TITLE,
      description: PITCH_DESCRIPTION,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${PITCH_TITLE}.`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: PITCH_TITLE,
      description: PITCH_DESCRIPTION,
      images: [image],
    },
  };
}
