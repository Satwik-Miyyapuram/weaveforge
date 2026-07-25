"use client";

interface RecoveryCodeCardProps {
  code: string;
}

export function RecoveryCodeCard({ code }: RecoveryCodeCardProps) {
  return (
    <div className="recovery-code-card">
      <code className="recovery-code">{code}</code>
      <p className="muted">Shown once. Store offline — password manager or printout.</p>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void navigator.clipboard.writeText(code.replace(/-/g, ""))}
      >
        Copy code
      </button>
    </div>
  );
}
