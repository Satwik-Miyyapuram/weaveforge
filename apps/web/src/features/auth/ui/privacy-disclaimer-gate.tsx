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
import { useCapability } from "@/deployment/capabilities";
import {
  desktop,
  type DesktopLocalDbState,
} from "@/lib/desktop/desktop-bridge";
import {
  isLocalMode,
  setLocalMode,
} from "@/backend/providers/local/local-identity";

/**
 * Blocks the app until the user accepts the org/privacy disclaimer once.
 * Children do not mount until acceptance — and not until the full AppContainer
 * is ready, even when startup is served from the localStorage cache on cold reopen
 * (TabBar / ProjectProvider call getContainer() synchronously on render).
 */
export function PrivacyDisclaimerGate({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gate on the disclaimer decision, not the org/profile bundle. `gateReady`
  // is known from cache (returning users) or after the settings read (cold),
  // long before profile/org data lands — and the screens do not need that data
  // to render, so holding them for it is pure waiting.
  const { gateReady, needsPrivacyAccept, settingsError, refreshProfile } =
    useStartup();
  // Every paragraph of the disclaimer is about somebody else being able to read
  // the data: the operator, the database, a share. On a copy whose database is
  // a file on this disk there is no such person, so there is nothing to
  // disclose and nothing to consent to — the modal would be asking the reader
  // to accept the terms of a service they are not using.
  const disclosable = useCapability("operatorDisclosure");
  const [needsAccept, setNeedsAccept] = useState(() => needsPrivacyAccept);
  const [containerReady, setContainerReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNeedsAccept(disclosable && needsPrivacyAccept);
  }, [disclosable, needsPrivacyAccept]);

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
      // The acceptance is written and durable at this point. Refreshing the
      // startup bundle is how the rest of the app learns about it, but if that
      // refresh fails the user must still come out from behind a modal they
      // cannot dismiss — the screens below have their own loaders and retries.
      await refreshProfile().catch(() => undefined);
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

  // The settings read failed, so whether this user has accepted is unknown.
  // Showing the modal here would offer an accept button that writes through
  // the same unreachable API and reports the same failure, with no way out.
  if (settingsError) return <StartupFailure message={settingsError} />;

  if (!needsAccept && !containerReady && error)
    return <StartupFailure message={error} />;

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
              <summary>
                Read the full privacy and data-protection details
              </summary>
              {PRIVACY_DISCLAIMER_PARAGRAPHS.map((p) => (
                <p key={p} className="muted">
                  {p}
                </p>
              ))}
            </details>
            {error && <FormError>{error}</FormError>}
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void accept()}
            >
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

/** A dead end the user can act on: what went wrong, and a way to try again. */
function StartupFailure({ message }: { message: string }) {
  const broken = useLocalDbFailure();
  return (
    <main
      className="app-shell"
      style={{ padding: 24, maxWidth: 480, margin: "10vh auto" }}
    >
      <h1 style={{ fontSize: "1.25rem", marginBottom: 8 }}>
        Couldn’t start the app
      </h1>
      {broken ? (
        <LocalDbRecovery state={broken} />
      ) : (
        <FormError>{message}</FormError>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <button
          type="button"
          className={broken ? "btn-secondary" : "btn-primary"}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
        {desktop() && !isLocalMode() ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setLocalMode(true);
              window.location.reload();
            }}
          >
            Work on this computer (offline)
          </button>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Whether the failure on screen is the local database refusing to open.
 *
 * Asked of the shell rather than inferred from the message: the message is an
 * Emscripten abort or a Postgres error, neither of which names the database as
 * the thing that failed. Only meaningful on the desktop, working on this
 * computer — anywhere else there is no local database to have failed.
 */
function useLocalDbFailure(): DesktopLocalDbState | null {
  const [state, setState] = useState<DesktopLocalDbState | null>(null);
  useEffect(() => {
    const shell = desktop();
    if (!shell || !isLocalMode()) return;
    let cancelled = false;
    shell
      .localDbState()
      .then((s) => {
        if (!cancelled && s.failure) setState(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * The way out of a database that cannot be opened.
 *
 * The old directory is moved beside itself, never deleted, and the page says
 * so with the path — because the one thing a person needs to know before
 * pressing this is that nothing is being thrown away. The shell may relaunch
 * to finish the move (Windows will not rename a directory the failed engine
 * still holds), which is why the button does not promise to return.
 */
function LocalDbRecovery({ state }: { state: DesktopLocalDbState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await desktop()?.resetLocalDb();
      window.location.reload();
    } catch (err) {
      setError(formatError(err));
      setBusy(false);
    }
  }, []);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p>
        The app’s own database on this computer could not be opened. This
        happens when a previous run was interrupted while writing to it.
      </p>
      <p className="muted" style={{ wordBreak: "break-all" }}>
        {state.dataDir}
      </p>
      <details>
        <summary className="muted">Technical detail</summary>
        <p
          className="muted"
          style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em" }}
        >
          {state.failure}
        </p>
      </details>
      <p>
        Starting fresh moves the old database aside as{" "}
        <code>local-db.broken-…</code> in the same folder — nothing is deleted —
        and opens a new, empty one.
      </p>
      {error && <FormError>{error}</FormError>}
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={() => void reset()}
      >
        {busy ? "Moving aside…" : "Start with a fresh database"}
      </button>
    </div>
  );
}
