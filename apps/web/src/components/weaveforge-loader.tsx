"use client";

import { useEffect, useState } from "react";

const FEATURE_TIPS = [
  {
    title: "Papers & citation graph",
    detail: "Collect PDFs, link references, and explore how your reading connects.",
  },
  {
    title: "Reading lists",
    detail: "Nest topics and papers — from survey chapters down to individual citations.",
  },
  {
    title: "Notes",
    detail: "Markdown for ideas, meeting notes, and drafts beside your library.",
  },
  {
    title: "Experiments",
    detail: "Log runs, curves, and artifacts — then compare what changed between attempts.",
  },
  {
    title: "Plan & logbook",
    detail: "Milestones with dependencies, plus a daily research diary in one place.",
  },
  {
    title: "Report outline",
    detail: "A nested chapter tree with word targets and drafting status per section.",
  },
  {
    title: "Sharing & supervision",
    detail: "Share selected items with supervisors — they see only what you grant.",
  },
  {
    title: "Private by default",
    detail: "Your data stays behind sign-in and row-level access — not public pages.",
  },
] as const;

const TIP_INTERVAL_MS = 3200;
/** Fade-out before the swap; must match the `.weaveforge-loader-tip` transition. */
const TIP_FADE_MS = 220;

export type ThesisLoaderProps = {
  /** Short status line under the brand, e.g. "Loading…" or "Unlocking…" */
  status?: string;
  /** gate = full-screen gates; inline = inside a screen */
  variant?: "gate" | "inline";
  /** Include auth-loading class for e2e / gate detection */
  markAuthLoading?: boolean;
  /** Rotate feature tips (default true) */
  showTips?: boolean;
  className?: string;
};

function ThesisLoaderMark({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`weaveforge-loader-mark${compact ? " weaveforge-loader-mark--compact" : ""}`}
      aria-hidden
    >
      <span className="weaveforge-loader-orbit weaveforge-loader-orbit--a" />
      <span className="weaveforge-loader-orbit weaveforge-loader-orbit--b" />
      <span className="weaveforge-loader-orbit weaveforge-loader-orbit--c" />
      <span className="weaveforge-loader-orbit weaveforge-loader-orbit--d" />
      <span className="weaveforge-loader-core">
        <span className="dot" />
      </span>
    </div>
  );
}

function ThesisLoader({
  status = "Loading…",
  variant = "gate",
  markAuthLoading = true,
  showTips = true,
  className,
}: ThesisLoaderProps) {
  const inline = variant === "inline";
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);

  /*
   * The rotate-and-fade is a two-step animation: hide, swap after the fade-out,
   * show. Both timers are tracked and cleared, because the inner `setTimeout`
   * outlives the interval that scheduled it — unmounting during the 220ms fade
   * left a pending callback that called `setState` on a dead component.
   */
  useEffect(() => {
    if (!showTips) return;
    let fade: number | undefined;
    const id = window.setInterval(() => {
      setTipVisible(false);
      fade = window.setTimeout(() => {
        setTipIndex((i) => (i + 1) % FEATURE_TIPS.length);
        setTipVisible(true);
      }, TIP_FADE_MS);
    }, TIP_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      if (fade !== undefined) window.clearTimeout(fade);
    };
  }, [showTips]);

  const tip = FEATURE_TIPS[tipIndex]!;

  return (
    <div
      className={[
        "weaveforge-loader",
        inline ? "weaveforge-loader--inline" : "",
        markAuthLoading ? "auth-loading" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <ThesisLoaderMark compact={inline} />
      {!inline && <p className="weaveforge-loader-brand">WeaveForge</p>}
      <p className="weaveforge-loader-status">{status}</p>
      {showTips ? (
        /*
         * Hidden from assistive tech, and the status line above is the only
         * thing this region has to say.
         *
         * The tips are decoration — a rotating marketing line, not a statement
         * about the load — but they are inside the `role="status"` element, so a
         * change to them is a change to the live region: every 3.2s the whole
         * thing was re-announced, cutting across the one string a screen reader
         * user actually needs here ("Loading…", "Unlocking…") and repeating the
         * same eight tips for as long as the gate stayed up. `aria-hidden` takes
         * this subtree out of the accessibility tree, so the rotation is no
         * longer a live-region mutation; the markup stays where it is because
         * moving it out would make it a new flex child of
         * `.weaveforge-loader` and shift the layout it is centred in.
         */
        <div
          className={`weaveforge-loader-tip${tipVisible ? " weaveforge-loader-tip--in" : ""}`}
          key={tipIndex}
          aria-hidden
        >
          <strong>{tip.title}</strong>
          <span>{tip.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Full-viewport centered loader for app gates. */
export function ThesisLoaderScreen(props: Omit<ThesisLoaderProps, "variant" | "markAuthLoading">) {
  return (
    <main className="app-shell weaveforge-loader-screen">
      <ThesisLoader variant="gate" markAuthLoading {...props} />
    </main>
  );
}

/** Branded loader inside a screen while data loads. */
export function ScreenLoader({
  status = "Loading…",
  showTips = true,
  compact = false,
}: {
  status?: string;
  showTips?: boolean;
  /** Shorter layout for cards / settings panels */
  compact?: boolean;
}) {
  return (
    <div className={`weaveforge-loader-wrap${compact ? " weaveforge-loader-wrap--compact" : ""}`}>
      <ThesisLoader
        variant="inline"
        status={status}
        showTips={showTips}
        markAuthLoading={false}
      />
    </div>
  );
}
