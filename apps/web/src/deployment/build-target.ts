/**
 * Which of the two builds this is.
 *
 * The same source produces the served web app and the static bundle inside the
 * desktop installer (`apps/desktop/scripts/build-web.mjs`). Almost nothing
 * needs to know which one it is in — the difference is meant to be a build
 * flag, not a fork — but a few things genuinely cannot exist without a server,
 * and the offline-first plan says those are *absent* rather than present and
 * disabled (D10). Something has to answer the question for them, and this is
 * the only place that reads the flag.
 *
 * Read through `process.env` at the top level so the bundler replaces it with a
 * literal and the dead branch is dropped, rather than shipping the online-only
 * code with a check in front of it.
 */

const OFFLINE = process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP === "1";

/** Whether this build has no server behind it. */
export function isOfflineBuild(): boolean {
  return OFFLINE;
}
