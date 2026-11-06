"use client";

import { Button } from "@/components/button";

/** A figure that could not be shown, or a file kept on the desktop app only. */
export function ArtifactPlaceholder({
  label,
  reason,
  onRetry,
  className = "artifact-missing",
}: {
  label: string;
  reason: "desktop" | "missing";
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={className} role="note">
      <span className="artifact-missing-label" title={label}>
        {label}
      </span>
      {reason === "desktop" ? (
        <span className="muted">On desktop only: saved on the computer that ran it.</span>
      ) : (
        <>
          <span className="muted">Could not load this file. It may be gone, or access was refused.</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
    </div>
  );
}
