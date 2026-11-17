import { EmptyState } from "@/components/empty-state";

/**
 * Shown in place of a screen whose layout needs more width than a phone has
 * (below 600px). Layout only: tablets and desktops get the full screen.
 */
export function OpenOnLargerScreen({ what }: { what: string }) {
  return (
    <section className="screen">
      <EmptyState
        variant="first-run"
        title={`${what} needs a larger screen`}
        body="Open WeaveForge on a tablet or desktop to use this view."
      />
    </section>
  );
}
