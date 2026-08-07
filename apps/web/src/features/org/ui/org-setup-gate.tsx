"use client";

import { useState } from "react";
import { ROLE_LABELS, type OrgInviteCodePlaintext } from "@weaveforge/core";
import { useProfile } from "./profile-provider";
import { createOrg, joinOrg, previewOrgCode, regenerateOrgCode, continueStandalone } from "../infrastructure/org-api";
import { Modal } from "@/components/modal";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";

/**
 * First-run gate: create a lab, join with a code, or continue standalone.
 * Helps both multi-user deployments and solo thesis tracking.
 */
export function OrgSetupGate({ children }: { children: React.ReactNode }) {
  const { profile, loading, refresh } = useProfile();
  const needsSetup =
    !loading &&
    (!profile || profile.orgSetupComplete === false);

  if (!needsSetup) return <>{children}</>;

  return (
    <main className="app-shell org-setup-screen">
      <div className="card org-setup-card">
        <h1 className="screen-title">Welcome to WeaveForge</h1>
        <p className="muted">
          Create a research lab, join one with a code from your supervisor, or use the app on your own.
        </p>
        <OrgSetupForm onDone={refresh} />
      </div>
    </main>
  );
}

export function OrgSetupForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<OrgInviteCodePlaintext[] | null>(null);

  async function finishStandalone() {
    setBusy(true);
    setError(null);
    try {
      await continueStandalone();
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (createdCodes) {
    return (
      <div className="org-setup-done">
        <p><strong>Lab created.</strong> Share these codes (shown once):</p>
        <CodeList codes={createdCodes} />
        <button type="button" className="btn-primary" onClick={onDone}>Continue</button>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <CreateLabForm
        busy={busy}
        error={error}
        onBack={() => setMode("choose")}
        onSubmit={async (name) => {
          setBusy(true);
          setError(null);
          try {
            const res = (await createOrg(name)) as { codes?: OrgInviteCodePlaintext[] };
            setCreatedCodes(res.codes ?? null);
            if (!res.codes?.length) onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  if (mode === "join") {
    return (
      <JoinLabForm
        busy={busy}
        error={error}
        onBack={() => setMode("choose")}
        onSubmit={async (input) => {
          setBusy(true);
          setError(null);
          try {
            await joinOrg(input);
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <div className="org-setup-choose">
      <div className="org-modal-choices">
        <button type="button" className="org-choice-card" onClick={() => setMode("create")}>
          <span className="org-choice-title">Create a lab</span>
          <p className="org-choice-desc">Start a new research group and invite teammates with codes.</p>
        </button>
        <button type="button" className="org-choice-card" onClick={() => setMode("join")}>
          <span className="org-choice-title">Join with code</span>
          <p className="org-choice-desc">Enter an invite code from your supervisor or lab admin.</p>
        </button>
      </div>
      <button
        type="button"
        className="link-btn org-modal-skip"
        disabled={busy}
        onClick={() => void finishStandalone()}
      >
        {busy ? "Saving…" : "Continue without an org"}
      </button>
      <p className="muted org-setup-hint">
        You can create or join a lab later from <strong>Settings → Organization</strong>.
      </p>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}

function CreateLabForm({
  busy,
  error,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(name);
      }}
    >
      <label>
        Lab name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Smith Lab" />
      </label>
      {error && <FormError>{error}</FormError>}
      <div className="head-row">
        <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
        <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function JoinLabForm({
  busy,
  error,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (input: {
    code: string;
    phdSupervisorId?: string;
    professorSupervisorId?: string;
  }) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [professorId, setProfessorId] = useState("");
  const [phdId, setPhdId] = useState("");
  const [preview, setPreview] = useState<{
    orgName?: string;
    targetRole?: string;
    professors?: { id: string; label: string }[];
    phds?: { id: string; label: string }[];
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function lookup() {
    setLookupError(null);
    try {
      setPreview(await previewOrgCode(code));
    } catch (err) {
      setPreview(null);
      setLookupError(err instanceof Error ? err.message : String(err));
    }
  }

  const needsProfessor = Boolean(preview?.professors?.length) && !professorId;
  const needsPhd = Boolean(preview?.phds?.length) && !phdId;
  const missingSupervisor = needsProfessor || needsPhd;

  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (missingSupervisor) return;
        void onSubmit({
          code,
          professorSupervisorId: professorId || undefined,
          phdSupervisorId: phdId || undefined,
        });
      }}
    >
      <label>
        Join code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onBlur={() => code.trim() && void lookup()}
          placeholder="ABC-DEF-GH2"
          required
        />
      </label>
      {preview && (
        <p className="muted">
          Join <strong>{preview.orgName}</strong> as{" "}
          <strong>{ROLE_LABELS[preview.targetRole as keyof typeof ROLE_LABELS] ?? preview.targetRole}</strong>
        </p>
      )}
      {preview?.professors && preview.professors.length > 0 && (
        <label>
          Professor supervisor
          <Select
            value={professorId}
            onChange={(e) => setProfessorId(e.target.value)}
            aria-label="Professor supervisor"
          >
            <option value="">Select…</option>
            {preview.professors.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </label>
      )}
      {preview?.phds && preview.phds.length > 0 && (
        <label>
          PhD supervisor
          <Select
            value={phdId}
            onChange={(e) => setPhdId(e.target.value)}
            aria-label="PhD supervisor"
          >
            <option value="">Select…</option>
            {preview.phds.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </label>
      )}
      {lookupError && <FormError>{lookupError}</FormError>}
      {error && <FormError>{error}</FormError>}
      <div className="head-row">
        <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
        {/* The supervisor pickers used to carry `required`, which the themed
            Select cannot express — it renders a button, not a form control — so
            the same rule is enforced here instead. */}
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || !code.trim() || missingSupervisor}
        >
          {busy ? "Joining…" : "Join lab"}
        </button>
      </div>
    </form>
  );
}

export function OrgCodesPanel({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function regen(role: string) {
    setBusy(role);
    setError(null);
    try {
      const res = await regenerateOrgCode(orgId, role);
      if (res.code) setRevealed((prev) => ({ ...prev, [role]: res.code! }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const roles = [
    { id: "professor", label: "Professor" },
    { id: "phd", label: "PhD" },
    { id: "masters", label: "Masters" },
  ] as const;

  return (
    <div className="org-codes-panel">
      <h4 className="settings-group">{orgName} — invite codes</h4>
      <p className="muted">Codes are shown only when created or regenerated. Store them securely.</p>
      <ul className="org-code-list">
        {roles.map((r) => (
          <li key={r.id} className="org-code-row">
            <span className="org-code-role">{r.label}</span>
            <code className="org-code-value">{revealed[r.id] ?? "•••-•••-•••"}</code>
            <div className="org-code-actions">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy === r.id}
                onClick={() => void regen(r.id)}
              >
                {busy === r.id ? "…" : revealed[r.id] ? "Regenerate" : "Reveal"}
              </button>
              {revealed[r.id] && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void navigator.clipboard.writeText(revealed[r.id]!)}
                >
                  Copy
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}

function CodeList({ codes }: { codes: OrgInviteCodePlaintext[] }) {
  return (
    <ul className="org-code-list">
      {codes.map((c) => (
        <li key={c.targetRole} className="org-code-row org-code-row--static">
          <span className="org-code-role">{c.targetRole}</span>
          <code className="org-code-value">{c.code}</code>
        </li>
      ))}
    </ul>
  );
}

/** Settings modal for join/create after initial setup. */
export function OrgLabModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title="Join or create an organization" onClose={onClose}>
      <div className="org-modal-body">
        <p className="muted org-modal-intro">
          Collaborate with your lab by creating a group or joining one with an invite code.
        </p>
        <OrgSetupForm onDone={onClose} />
      </div>
    </Modal>
  );
}
