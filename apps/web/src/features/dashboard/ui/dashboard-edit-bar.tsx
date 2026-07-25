"use client";

function CustomizeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function DashboardEditBar({
  editing,
  onCustomize,
  onDone,
  onReset,
  onAdd,
}: {
  editing: boolean;
  onCustomize: () => void;
  onDone: () => void;
  onReset: () => void;
  onAdd: () => void;
}) {
  if (!editing) {
    return (
      <button
        type="button"
        className="dashboard-customize-btn"
        onClick={onCustomize}
        aria-label="Customize dashboard"
        title="Customize"
      >
        <CustomizeIcon />
      </button>
    );
  }

  return (
    <div className="dashboard-edit-bar dashboard-edit-bar--editing">
      <button type="button" className="btn-secondary" onClick={onAdd}>
        + Add card
      </button>
      <button type="button" className="btn-secondary" onClick={onReset}>
        Reset default
      </button>
      <button type="button" className="btn-primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
