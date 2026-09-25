/**
 * A prefilled "new issue" address, for a copy of the app that cannot file one.
 *
 * The packaged desktop app is a static export: there is no server, so there is
 * no `/api/report-issue` and no token to file with. A web deployment without
 * `GITHUB_ISSUES_TOKEN` is in the same place. Both can still hand the report to
 * GitHub's own form: the reader lands on it signed in as themselves, sees the
 * whole report, and presses Submit there. Nothing is posted until they do.
 *
 * Browsers and GitHub both refuse very long addresses (GitHub answers 414 a
 * little past 8 KB), so the body is cut to fit, from the end: the summary and
 * the error come first and survive, the log tail is what gets trimmed.
 */

/** Where reports go when nothing overrides it; the route uses the same repo. */
export const DEFAULT_REPORT_REPO = "Satwik-Miyyapuram/weaveforge";

/** The longest address this builds, comfortably under GitHub's limit. */
const MAX_URL_LENGTH = 7_500;

export function reportRepo(): string {
  const configured = process.env.NEXT_PUBLIC_REPORT_REPO?.trim();
  return configured && /^[\w.-]+\/[\w.-]+$/.test(configured) ? configured : DEFAULT_REPORT_REPO;
}

export function newIssueUrl(input: { title: string; body: string; repo?: string }): string {
  const base = `https://github.com/${input.repo ?? reportRepo()}/issues/new`;
  const title = `[app] ${input.title.trim()}`.slice(0, 200);
  const build = (body: string) =>
    `${base}?${new URLSearchParams({ title, body, labels: "bug,from-app" }).toString()}`;

  let url = build(input.body);
  if (url.length <= MAX_URL_LENGTH) return url;

  // Encoding grows text unevenly (an "é" is six characters in the address), so
  // the longest prefix that fits is found by measuring, not by arithmetic.
  const note = "\n\n…(cut to fit the address; the rest is in the app's error log)";
  let low = 0;
  let high = input.body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (build(input.body.slice(0, mid) + note).length <= MAX_URL_LENGTH) low = mid;
    else high = mid - 1;
  }
  url = build(input.body.slice(0, low) + note);
  return url;
}

/** The issue body, in the same layout the server route files. */
export function reportMarkdown(input: {
  detail: string;
  route?: string;
  version?: string;
  logs?: string;
  /** What the reader was doing, in their words: the steps that reproduce it. */
  steps?: string;
  /** The rest of where it happened: screen and section, platform, time. */
  context?: readonly (readonly [string, string])[];
}): string {
  const where = [input.route && `Route: \`${input.route}\``, input.version && `Version: \`${input.version}\``]
    .filter(Boolean)
    .join(" · ");
  const sections = [`### What happened\n\n${input.detail}`];
  if (input.steps?.trim()) sections.push(`### Steps to reproduce\n\n${input.steps.trim()}`);
  const context = (input.context ?? []).filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`);
  if (where || context.length > 0) sections.push(`### Where\n\n${[where, ...context].filter(Boolean).join("\n")}`);
  if (input.logs) sections.push("### Recent errors and warnings\n\n```text\n" + input.logs + "\n```");
  return sections.join("\n\n");
}
