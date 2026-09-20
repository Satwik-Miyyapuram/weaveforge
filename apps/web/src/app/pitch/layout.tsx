import type { Metadata } from "next";
import { appOriginFrom, pitchShareMetadata } from "./share-card";

/**
 * The link-preview card for the pitch as *this* app serves it.
 *
 * `/pitch` is public inside the product as well as on the exported site:
 * `app-shell.tsx` returns it before the auth gate and before the project gate,
 * with no chrome, precisely so the page renders the app's real components
 * instead of a copy. So the deployed app answers on it, and a link to
 * `app.weaveforge.org/pitch` pasted into a chat had nothing behind it — no
 * title, no description, no image — because the app's root layout carries
 * metadata for a signed-in product, not for a page whose whole purpose is to be
 * shared.
 *
 * Scoped to this segment rather than added to `app/layout.tsx`. Every other
 * route here is behind a login, so a marketing card on the root layout would be
 * a card that lies: it would promise a workspace and render a sign-in form.
 */

export const metadata: Metadata = pitchShareMetadata({
  // Where this deployment answers. Resolved — and guarded against a value that
  // is not an absolute URL, which would fail the build over a card — in the
  // shared module, so the rule is testable: `test/share-card.test.ts`.
  origin: appOriginFrom(process.env.NEXT_PUBLIC_APP_URL),
  // No prefix: this app is served from the root of its own host. The exported
  // site passes its `BASE_PATH` here instead, which is the only difference
  // between the two cards.
  path: "/pitch",
});

export default function PitchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
