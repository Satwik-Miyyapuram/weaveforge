"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { useLiveSync } from "./use-live-sync";

interface OfflineWorkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OfflineWorkModal({ isOpen, onClose }: OfflineWorkModalProps) {
  const { offlineWorkCount, offlineSummary, adoptNow } = useLiveSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAdopt = async () => {
    setBusy(true);
    setError(null);
    try {
      await adoptNow();
      onClose();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const tables = offlineSummary?.tables ?? {};
  const projects = offlineSummary?.projects ?? [];
  const colliding = offlineSummary?.collidingProjects ?? [];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "540px",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--bg, #fff)",
          borderRadius: "8px",
          padding: "24px",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.15)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "1.25rem" }}>
          Sync Offline Work with Account
        </h2>
        <p className="muted" style={{ marginBottom: "16px", fontSize: "0.9rem" }}>
          You have {offlineWorkCount} {offlineWorkCount === 1 ? "item" : "items"} created on this
          computer before signing in. You can sync them now to your account.
        </p>

        {error && <FormError>{error}</FormError>}

        {/* Breakdown by item type */}
        <div
          style={{
            background: "var(--bg-muted, rgba(0,0,0,0.04))",
            borderRadius: "6px",
            padding: "12px",
            marginBottom: "16px",
          }}
        >
          <strong style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Summary of Offline Changes
          </strong>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "0.9rem" }}>
            {Object.entries(tables).map(([table, count]) => (
              <li key={table}>
                <strong>{count}</strong> {table.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>

        {/* Local projects list */}
        {projects.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <strong style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Projects
            </strong>
            <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {projects.map((p) => {
                const collision = colliding.find((c) => c.id === p.id);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      border: "1px solid var(--border, #e5e7eb)",
                      borderRadius: "4px",
                      fontSize: "0.88rem",
                    }}
                  >
                    <span>{p.name}</span>
                    {collision ? (
                      <span
                        className="muted"
                        style={{ fontSize: "0.78rem", fontStyle: "italic" }}
                        title="Name exists in cloud: will be kept with device suffix to avoid overwriting"
                      >
                        Kept as &ldquo;{collision.willRenameTo}&rdquo;
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.78rem" }}>
                        New project
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {colliding.length > 0 && (
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: "8px" }}>
                Projects with duplicate names in the cloud will be safely preserved side-by-side with
                device suffixes so no work is lost.
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px" }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Review Later
          </button>
          <button type="button" className="btn-primary" onClick={handleAdopt} disabled={busy}>
            {busy ? "Syncing…" : "Update & Sync Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
