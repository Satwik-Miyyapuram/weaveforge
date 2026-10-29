"use client";

import { Button, IconButton } from "@/components/button";

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
      <IconButton label="Customize dashboard" tip="Customize" onClick={onCustomize}>
        <CustomizeIcon />
      </IconButton>
    );
  }

  return (
    <div className="dashboard-edit-bar dashboard-edit-bar--editing">
      <Button onClick={onAdd}>
        + Add card
      </Button>
      <Button onClick={onReset}>
        Reset layout
      </Button>
      <Button variant="primary" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
