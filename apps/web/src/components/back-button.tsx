"use client";

import { Button } from "./button";
import { ChevronLeftIcon } from "./view-icons";

/**
 * The one way back from a detail page to where it came from: a square chevron
 * box and the name of that place. Every detail screen uses this, so a back
 * control looks and sits the same wherever it is found.
 */
export function BackButton({
  label,
  onClick,
  href,
}: {
  /** Where it goes, e.g. "Papers". */
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <ChevronLeftIcon />
      {label}
    </>
  );
  const title = `Back to ${label}`;
  return href ? (
    <Button variant="ghost" href={href} title={title}>
      {inner}
    </Button>
  ) : (
    <Button variant="ghost" onClick={onClick} title={title}>
      {inner}
    </Button>
  );
}
