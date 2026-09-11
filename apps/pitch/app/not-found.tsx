import Link from "next/link";
import { APP_URL } from "@/app/pitch/links";
import { RouteNotFound } from "@/app/route-not-found";

/**
 * The exported site's 404.
 *
 * `output: "export"` turns this into `out/404.html`, which is the file GitHub
 * Pages serves for a path it has no file for — so an old docs link or a typo
 * lands here rather than on the host's own page.
 *
 * Two links differ from the app's copy, and both have to:
 *   - the docs are a sibling route on this site (`/docs/`), not the separate
 *     origin the product links to, so they go through `next/link` and pick up
 *     the `basePath` the deploy is built with;
 *   - `/papers` is not a route on this site at all. It is a screen of the
 *     product, one origin over, so it is built from APP_URL
 *     (`NEXT_PUBLIC_APP_URL`, set by .github/workflows/pages.yml). A relative
 *     link here would land back on this same page.
 *
 * The page itself is the product's own component, imported the way
 * `app/page.tsx` imports the pitch body, so the two 404s cannot drift.
 */
export default function NotFound() {
  return (
    <RouteNotFound
      links={
        <>
          <Link className="btn-primary" href="/">
            Back to the home page
          </Link>
          <a className="btn-secondary" href={`${APP_URL}papers`}>
            Browse the papers
          </a>
          <Link className="btn-secondary" href="/docs/">
            Read the docs
          </Link>
        </>
      }
    />
  );
}
