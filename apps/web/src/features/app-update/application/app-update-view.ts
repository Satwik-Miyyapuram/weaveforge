import type { DesktopAppUpdate } from "@/lib/desktop/desktop-bridge";

/**
 * What the notice and the Settings block show for one shell status. Pure, so
 * the rules are tested without a window or a renderer.
 */
export interface AppUpdateView {
  /** The banner's line, or null when the banner has nothing to say. */
  notice: string | null;
  /** The Settings line, always set. */
  summary: string;
  /** Set when the last check or install failed; the error is shown, not hidden. */
  error: string | null;
  canCheck: boolean;
  canInstall: boolean;
  /** Label of the one-click button, shown only when `canInstall`. */
  installLabel: string;
}

const BUSY = new Set<DesktopAppUpdate["phase"]>(["checking", "downloading", "installing"]);

const FAILED_FALLBACK = "Could not finish the update. Try again.";

function progress(percent: number | null): string {
  return percent === null ? "" : ` (${percent}%)`;
}

export function appUpdateView(status: DesktopAppUpdate): AppUpdateView {
  const { phase, version } = status;
  // A failed install keeps the release it was for, so the retry has something
  // to install; a failed check has none and only asks to check again.
  const canInstall = phase === "available" || (phase === "failed" && version !== null);
  const canCheck = phase !== "unsupported" && !BUSY.has(phase);
  const error = phase === "failed" ? (status.error ?? FAILED_FALLBACK) : null;

  let notice: string | null = null;
  let summary: string;
  switch (phase) {
    case "unsupported":
      summary = "Automatic updates are not set up in this build.";
      break;
    case "idle":
      summary = "WeaveForge checks for new versions in the background.";
      break;
    case "checking":
      summary = "Checking for a new version…";
      break;
    case "upToDate":
      summary = "You have the latest version.";
      break;
    case "available":
      summary = `Version ${version} is ready to install.`;
      notice = `WeaveForge ${version} is ready — Restart to update`;
      break;
    case "downloading":
      summary = `Downloading ${version}${progress(status.percent)}…`;
      notice = `Downloading WeaveForge ${version}${progress(status.percent)}`;
      break;
    case "installing":
      summary = "Installing. WeaveForge will restart.";
      notice = `Installing WeaveForge ${version}. WeaveForge will restart.`;
      break;
    case "failed":
      summary = error ?? FAILED_FALLBACK;
      notice = version === null ? null : `WeaveForge ${version} did not install.`;
      break;
  }

  return {
    notice,
    summary,
    error,
    canCheck,
    canInstall,
    installLabel: phase === "failed" ? "Try again" : "Update now",
  };
}
