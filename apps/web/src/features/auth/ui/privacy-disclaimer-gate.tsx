"use client";

import { useCallback, useEffect, useState } from "react";
import { getLightContainer } from "@/light-bootstrap";
import { ThesisLoaderScreen } from "@/components/thesis-loader";
import { Modal } from "@/components/modal";
import {
  PRIVACY_DISCLAIMER_PARAGRAPHS,
  PRIVACY_DISCLAIMER_SUMMARY,
  PRIVACY_DISCLAIMER_TITLE,
} from "@/features/legal/privacy-disclaimer";
import { useStartup } from "@/features/startup";
import { FormError } from "@/components/form-error";
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
  const { loading, snapshot, refreshProfile } = useStartup();
  const [needsAccept, setNeedsAccept] = useState(
    () => snapshot?.needsPrivacyAccept ?? true,
  );
  const [containerReady, setContainerReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    setNeedsAccept(snapshot.needsPrivacyAccept);
  }, [snapshot]);

  // Cached startup can report "disclaimer already accepted" before the heavy
  // container has been created. Shell children call getContainer() sync on
  // render, so wait for ensureContainer() before mounting them.
  useEffect(() => {
    if (loading || !snapshot || snapshot.needsPrivacyAccept) {
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
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loading, snapshot]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await getLightContainer().settings.acceptDisclaimer();
      await refreshProfile();
      setNeedsAccept(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refreshProfile]);

  if (
    shouldShowWorkspaceLoader({
      loading,
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
        loading,
        needsPrivacyAccept: needsAccept,
        containerReady,
      })
        ? children
        : null}
    </>
  );
}
