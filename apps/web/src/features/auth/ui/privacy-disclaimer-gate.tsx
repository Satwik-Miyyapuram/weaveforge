"use client";

import { useCallback, useEffect, useState } from "react";
import { getLightContainer } from "@/light-bootstrap";
import { ThesisLoaderScreen } from "@/components/weaveforge-loader";
import { Modal } from "@/components/modal";
import {
  PRIVACY_DISCLAIMER_PARAGRAPHS,
  PRIVACY_DISCLAIMER_SUMMARY,
  PRIVACY_DISCLAIMER_TITLE,
} from "@/features/legal/privacy-disclaimer";
import { useStartup } from "@/features/startup";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import {
  shouldMountShellChildren,
  shouldShowWorkspaceLoader,
} from "./privacy-disclaimer-readiness";

/**
 * Blocks the app until the user accepts the org/privacy disclaimer once.
 * Children do not mount until acceptance — and not until the full AppContainer
 * is ready, even when startup is served from the localStorage cache on cold reopen
 * (TabBar / ProjectProvider call getContainer() synchronously on render).
 */
export function PrivacyDisclaimerGate({ children }: { children: React.ReactNode }) {
  // Gate on the disclaimer decision, not the org/profile bundle. `gateReady`
  // is known from cache (returning users) or after the settings read (cold),
  // long before profile/org data lands — and the screens do not need that data
  // to render, so holding them for it is pure waiting.
  const { gateReady, needsPrivacyAccept, refreshProfile } = useStartup();
  const [needsAccept, setNeedsAccept] = useState(() => needsPrivacyAccept);
  const [containerReady, setContainerReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNeedsAccept(needsPrivacyAccept);
  }, [needsPrivacyAccept]);

  // Create the heavy container as soon as the decision says accepted — shell
  // children call getContainer() sync on render, so it must exist before they
  // mount, but it does not need to wait for the org/profile bundle.
  useEffect(() => {
    if (!gateReady || needsAccept) {
      setContainerReady(false);
      return;
    }
    let cancelled = false;
    setContainerReady(false);
    setError(null);
    void import("@/bootstrap")
      .then(({ ensureContainer }) => ensureContainer())
      .then(() => {
        if (!cancelled) setContainerReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gateReady, needsAccept]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const light = getLightContainer();
      try {
        await light.settings.acceptDisclaimer();
      } catch (first) {
        // This is the first row a new account ever writes, so it is where a
        // half-provisioned identity surfaces — as a foreign key violation on
        // user_settings. Startup already tries to provision, best-effort; if
        // that attempt failed (offline for a moment, a slow cold start) this is
        // the last place to recover before the user is simply stuck behind a
        // modal they cannot dismiss. One retry, then report the original error.
        await light.selfProvisioner.ensureProvisioned().catch(() => {
          throw first;
        });
        await light.settings.acceptDisclaimer();
      }
      await refreshProfile();
      setNeedsAccept(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }, [refreshProfile]);

  if (
    shouldShowWorkspaceLoader({
      // The loader waits only for the disclaimer decision, not the org bundle.
      loading: !gateReady,
      needsPrivacyAccept: needsAccept,
      containerReady,
      error,
    })
  ) {
    return <ThesisLoaderScreen status="Preparing your workspace…" />;
  }

  if (!needsAccept && !containerReady && error) {
    return (
      <main className="app-shell" style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Couldn’t start the app</h1>
        <FormError>{error}</FormError>
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </main>
    );
  }

  return (
    <>
      {needsAccept ? (
        <Modal title={PRIVACY_DISCLAIMER_TITLE} dismissible={false}>
          <div className="privacy-disclaimer-modal">
            <ul className="privacy-disclaimer-summary">
              {PRIVACY_DISCLAIMER_SUMMARY.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <details className="privacy-disclaimer-full">
              <summary>Read the full privacy and data-protection details</summary>
              {PRIVACY_DISCLAIMER_PARAGRAPHS.map((p) => (
                <p key={p} className="muted">
                  {p}
                </p>
              ))}
            </details>
            {error && <FormError>{error}</FormError>}
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void accept()}>
              {busy ? "Saving…" : "I understand — continue"}
            </button>
          </div>
        </Modal>
      ) : null}
      {shouldMountShellChildren({
        loading: !gateReady,
        needsPrivacyAccept: needsAccept,
        containerReady,
      })
        ? children
        : null}
    </>
  );
}
