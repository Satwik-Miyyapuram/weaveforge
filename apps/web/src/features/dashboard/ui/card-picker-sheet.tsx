"use client";

import { Modal } from "@/components/modal";
import { cardsForRole, type CardDef } from "../application/card-registry";
import type { DashboardCardType } from "@thesis/core";
import type { Role } from "@thesis/core";

export function CardPickerSheet({
  role,
  onPick,
  onClose,
}: {
  role: Role | null | undefined;
  onPick: (type: DashboardCardType) => void;
  onClose: () => void;
}) {
  const available = cardsForRole(role);
  const groups = ["Progress", "Activity", "Library", "Team"] as const;

  return (
    <Modal title="Add card" onClose={onClose}>
      <div className="dashboard-picker">
        {groups.map((group) => {
          const items = available.filter((c) => c.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="dashboard-picker-group">
              <h4 className="settings-group">{group}</h4>
              <ul className="dashboard-picker-list">
                {items.map((c) => (
                  <PickerRow key={c.type} def={c} onPick={() => onPick(c.type)} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function PickerRow({ def, onPick }: { def: CardDef; onPick: () => void }) {
  return (
    <li>
      <button type="button" className="dashboard-picker-btn" onClick={onPick}>
        {def.label}
      </button>
    </li>
  );
}
