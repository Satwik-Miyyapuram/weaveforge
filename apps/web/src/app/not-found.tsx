import Link from "next/link";
import { DOCS_URL } from "./account-links";
import { RouteNotFound } from "./route-not-found";
import { Button } from "@/components/button";

/**
 * The app's 404.
 *
 * Every mistyped path, expired share link and stale bookmark used to land on
 * Next's default page — no brand, no navigation, no way back into the app. The
 * twelve `error.tsx` files already answer a failure *inside* a screen — eleven
 * per-segment boundaries plus the root one — and this is the case none of them
 * could reach, because a path that matches no segment has no boundary to render
 * in.
 *
 * The docs link is absolute rather than `/docs`, matching the sidebar's own
 * "Help & docs" entry: inside the product `/docs` is not a route, and the
 * documentation is a separate origin.
 */
export default function NotFound() {
  return (
    <RouteNotFound
      links={
        <>
          <Button variant="primary" href="/">
            Back to the home page
          </Button>
          <Link className="not-found-link" href="/papers">
            Browse the papers
          </Link>
          <a className="not-found-link" href={DOCS_URL}>
            Read the docs
          </a>
        </>
      }
    />
  );
}
