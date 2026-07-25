"use client";

import { useMemo, useState } from "react";
import { ROLE_LABELS, ROLES, type Member, type Role } from "@thesis/core";
import { MultiSelect } from "@/components/multi-select";

/**
 * Pick people to share with: multi-select over the lab directory, with a text
 * search and a role (hierarchy) filter — the picker the user asked for.
 */
export function MemberPicker({
  members,
  selected,
  onToggle,
}: {
  members: Member[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const roleSet = new Set(roles);
    return members.filter((m) => {
      const hay = `${m.fullName ?? ""} ${m.email ?? ""}`.toLowerCase();
      return (
        (needle === "" || hay.includes(needle)) &&
        (roleSet.size === 0 || roleSet.has(m.role))
      );
    });
  }, [members, q, roles]);

  return (
    <div className="member-picker">
      <div className="mp-filters">
        <input
          className="search-input"
          placeholder="Search people…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search people"
        />
        <MultiSelect
          values={roles}
          onChange={setRoles}
          allLabel="All roles"
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r as Role] }))}
        />
      </div>
      <ul className="mp-list">
        {filtered.length === 0 && <li className="muted mp-empty">No people match.</li>}
        {filtered.map((m) => (
          <li key={m.id}>
            <label className="mp-row">
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={() => onToggle(m.id)}
              />
              <span className="mp-name">{m.fullName ?? m.email ?? m.id}</span>
              <span className="mp-role">{ROLE_LABELS[m.role]}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
