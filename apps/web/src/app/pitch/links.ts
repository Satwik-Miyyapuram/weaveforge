/**
 * Where "Open the app" points.
 *
 * Inside the product this is the app itself. The statically exported copy on
 * GitHub Pages is a different origin entirely, so it is built with this set to
 * the deployed app's URL — a marketing page that links a visitor back to
 * itself is worse than no link at all.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "/";

/**
 * Documentation and source.
 *
 * `/docs/` is relative on purpose: on the exported site the docs are a sibling
 * route, and inside the product `/docs` redirects to the docs host. One link
 * that is correct in both places.
 */
export const DOCS_URL = "/docs/";
export const REPO_URL = "https://github.com/Satwik-Miyyapuram/weaveforge";
/** GitHub's latest release page; 0.9.1 is marked Latest and 0.9.0 is a pre-release. */
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
