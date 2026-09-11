import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import "./not-found.css";

/**
 * The body of the brand's 404.
 *
 * `route-error.tsx` is the other half of this pair, and the two are deliberately
 * shaped the same way: the brand mark, one heading, one sentence that says what
 * happened and what it did *not* cost you, then a row of escapes. An error
 * boundary and a missing page arrive from very different causes, and a reader
 * should not have to work out which screen they are on to find the way back.
 *
 * What it does *not* share with `route-error.tsx` is the component. The
 * boundary's props are `error` and `reset` — Next hands those to an `error.tsx`,
 * and nothing hands them to a `not-found.tsx` — and its three escapes are
 * actions (retry, reload, wipe local data), while every escape from a 404 is a
 * link. One function for both would mean two sets of optional props and a
 * component that has to ask which kind of failure it is. So the framing is
 * shared by shape and by class, not by a prop.
 *
 * The three links arrive as nodes rather than as hrefs on purpose. The app links
 * its own routes with `<a>`; the exported site must link its sibling routes with
 * `next/link` so that the `basePath` a GitHub Pages deploy needs is applied.
 * Taking nodes lets each host pass the right one without this component knowing
 * which host it is on — which is also why it is a server component that reads
 * nothing from the environment.
 *
 * It lives here, beside `route-error.tsx`, rather than inside `not-found.tsx`
 * because the pitch site needs the identical page.
 */
export function RouteNotFound({
  /** The row of ways out, in the order they help. */
  links,
}: {
  links: React.ReactNode;
}) {
  return (
    <main className="not-found">
      <section className="screen not-found-card">
        <WeaveForgeLogo className="app-logo" />
        <h1 className="not-found-title">There is nothing at this address</h1>
        <p className="muted">
          The link may be mistyped, out of date, or pointing at something that has been
          moved. Nothing has been lost — your work lives in your projects, not at a URL.
        </p>

        {/* The ways out, in the order they help: home, the papers themselves,
            and the docs for the paths that did move. The audit that asked for
            this page described them as "the same three destinations the pitch
            footer already offers" — the footer actually offers Source / Docs /
            Issues, and "Open the app" sits in the call to action above it. The
            three here are the ones a lost reader can use, which is the point
            the audit was reaching for. */}
        <div className="not-found-actions">{links}</div>
      </section>
    </main>
  );
}
