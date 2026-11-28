/**
 * The collaborative editor without its lazy boundary, for screens that are
 * themselves loaded on demand. Behind a second `dynamic()` it shows "Loading
 * editor…" and waits for React's Suspense reveal (about 300 ms) after the
 * screen has already arrived.
 */
export { CollabBodyHost } from "./ui/collab-body-host";
