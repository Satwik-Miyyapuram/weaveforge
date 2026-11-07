"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProfile } from "@/features/org";
import { useProject } from "@/features/projects";
import { formatError } from "@/lib/format-error";
import { isSupervisorRole } from "@weaveforge/core";
import type { DashboardLayout, DashboardCardType } from "@weaveforge/core";
import { registerDashboardUiCacheClear } from "@/lib/cache/clear-session-caches";
import { readDeviceSnapshot, writeDeviceSnapshot } from "@/lib/cache/device-snapshot";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { Button } from "@/components/button";

import {
  appendCardPair,
  clearLegacyLayoutStorage,
  closeLayoutGaps,
  defaultLayout,
  finalizeDashboardLayout,
  layoutCacheKey,
  initialDashboardLayout,
  syncDashboardLayouts,
} from "../application/dashboard-layout";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardEditBar } from "./dashboard-edit-bar";
import { CardPickerSheet } from "./card-picker-sheet";
import { useDashboardStats } from "./use-dashboard-stats";
import { FormError } from "@/components/form-error";
import { ScreenHead } from "@/components/screen-head";
import { showToast } from "@/lib/toast";
import { studentsOf } from "@/features/org/application/students-of";

// Kept beside the repository memo on purpose (xapi-11): this holds the
// *finalized* layout (supervisor defaults applied) and is read synchronously,
// so a remount paints at once. The repository memo is async and holds the raw
// layout; without this the loader would flash on every visit. It always
// revalidates through the repository, and sign-out clears it.
const layoutCache = new Map<string, DashboardLayout>();
registerDashboardUiCacheClear(() => layoutCache.clear());

/** The device copy of a project's last shown layout (desktop and phone only). */
function layoutSnapshotName(projectId: string): string {
  return `dashboard-layout:${projectId}`;
}

function readLayoutSnapshot(projectId: string): DashboardLayout | null {
  const saved = readDeviceSnapshot<DashboardLayout>(layoutSnapshotName(projectId));
  return saved && Array.isArray(saved.lg) ? saved : null;
}

export function DashboardScreen() {
  const { current: project, fromSnapshot: projectsFromSnapshot } = useProject();
  const projectId = project?.id;
  const { profile, team, loading: profileLoading } = useProfile();
  const supervisees = useMemo(() => studentsOf(profile?.id, team), [team, profile]);
  const isSupervisor = isSupervisorRole(profile?.role) && supervisees.length > 0;

  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutReady = useRef(false);
  const layoutDirty = useRef(false);
  // Set when the stored layout failed to load: the screen then shows the
  // default, and saving it would overwrite the user's real layout.
  const layoutLoadFailed = useRef(false);
  const pendingSave = useRef<(() => void) | null>(null);
  const [cardsEntered, setCardsEntered] = useState(false);
  // The project whose device copy is on screen while its live layout loads.
  const snapshotFor = useRef<string | null>(null);
  const [layoutFromSnapshot, setLayoutFromSnapshot] = useState(false);

  const syncLayouts = useMemo(
    () => (layout ? syncDashboardLayouts(layout) : null),
    [layout],
  );

  const cardTypes = useMemo(
    () => syncLayouts?.lg.map((c) => c.type) ?? [],
    [syncLayouts],
  );

  const { stats, supervision, statsLoading, statsError, fromSnapshot: statsFromSnapshot } = useDashboardStats(
    cardTypes,
    supervisees,
  );

  const handleEnterComplete = useCallback(() => setCardsEntered(true), []);
  const contentReady = !statsLoading && !layoutLoading;
  // Edits wait until project, layout and stats are all live.
  const fromSnapshot = Boolean(projectsFromSnapshot) || layoutFromSnapshot || statsFromSnapshot;


  // Load saved layout from the database when project changes (after profile is ready).
  useEffect(() => {
    setCardsEntered(false);
    if (!projectId) return;
    // Paints this project's device copy (once) while the live layout is not there yet.
    const showSnapshot = () => {
      if (snapshotFor.current === projectId) return true;
      const saved = readLayoutSnapshot(projectId);
      if (!saved) return false;
      snapshotFor.current = projectId;
      setLayout(saved);
      setLayoutLoading(false);
      setLayoutFromSnapshot(true);
      return true;
    };
    if (profileLoading) {
      showSnapshot();
      return;
    }
    let active = true;
    layoutReady.current = false;
    layoutDirty.current = false;
    setLayoutError(null);

    const supervisorLayout = isSupervisorRole(profile?.role) && supervisees.length > 0;
    const cacheKey = layoutCacheKey(projectId, supervisorLayout);

    const cached = layoutCache.get(cacheKey);
    if (cached) {
      const next = finalizeDashboardLayout(cached);
      layoutCache.set(cacheKey, next);
      setLayout(next);
      setLayoutLoading(false);
      layoutReady.current = true;
      snapshotFor.current = null;
      setLayoutFromSnapshot(false);
    } else if (!showSnapshot()) {
      setLayout(null);
      setLayoutLoading(true);
    }

    clearLegacyLayoutStorage(projectId);

    (async () => {
      try {
        layoutLoadFailed.current = false;
        const stored = await getContainer().dashboard.getLayout(projectId);
        if (!active) return;
        const finalized = initialDashboardLayout(stored, supervisorLayout);
        // A layout saved before the current default can carry holes beside its
        // cards, which packing upward does not close.
        const next = { ...finalized, lg: closeLayoutGaps(finalized.lg) };
        layoutCache.set(cacheKey, next);
        writeDeviceSnapshot(layoutSnapshotName(projectId), next);
        setLayout(next);
      } catch (err) {
        if (!active) return;
        layoutLoadFailed.current = true;
        setLayoutError(formatError(err));
        const next = finalizeDashboardLayout(defaultLayout(supervisorLayout));
        layoutCache.set(cacheKey, next);
        setLayout(next);
      } finally {
        if (active) {
          setLayoutLoading(false);
          layoutReady.current = true;
          snapshotFor.current = null;
          setLayoutFromSnapshot(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, profileLoading, profile?.role, supervisees.length]);

  // Debounced save to the database (user edits only).
  useEffect(() => {
    if (!projectId || !layoutReady.current || layoutLoadFailed.current || layoutLoading || !layout || !layoutDirty.current) {
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const save = () => {
      pendingSave.current = null;
      const supervisorLayout = isSupervisorRole(profile?.role) && supervisees.length > 0;
      const cacheKey = layoutCacheKey(projectId, supervisorLayout);
      const toSave = finalizeDashboardLayout(syncDashboardLayouts(layout));
      void getContainer()
        .dashboard.saveLayout(projectId, toSave)
        .then(() => {
          layoutCache.set(cacheKey, toSave);
          layoutDirty.current = false;
        })
        .catch((err) => setLayoutError(formatError(err)));
    };
    pendingSave.current = save;
    saveTimer.current = setTimeout(save, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [layout, projectId, layoutLoading, profile?.role, supervisees.length]);

  // Leaving within the debounce window still saves the last edit.
  useEffect(() => () => pendingSave.current?.(), []);

  const markDirty = useCallback(() => {
    layoutDirty.current = true;
  }, []);

  const handleLayoutChange = useCallback(
    (bp: "lg" | "sm", items: DashboardLayout["lg"]) => {
      markDirty();
      setLayout((prev) => (prev ? { ...prev, [bp]: items } : prev));
    },
    [markDirty],
  );

  const handleRemove = useCallback(
    (id: string) => {
      markDirty();
      setLayout((prev) =>
        prev
          ? {
              lg: prev.lg.filter((c) => c.id !== id),
              sm: prev.sm.filter((c) => c.id !== id),
            }
          : prev,
      );
    },
    [markDirty],
  );

  const handleAdd = useCallback(
    (type: DashboardCardType) => {
      markDirty();
      setLayout((prev) => (prev ? appendCardPair(prev, type) : prev));
      setPickerOpen(false);
    },
    [markDirty],
  );

  const handleReset = useCallback(() => {
    const before = layout;
    markDirty();
    setLayout(finalizeDashboardLayout(defaultLayout(isSupervisor)));
    if (before) showToast("Layout reset", { label: "Undo", run: () => { markDirty(); setLayout(before); } });
  }, [isSupervisor, layout, markDirty]);

  const handleDone = useCallback(() => {
    setEditing(false);
    markDirty();
    setLayout((prev) => (prev ? finalizeDashboardLayout(prev) : prev));
  }, [markDirty]);

  const handleSuperviseeConfig = useCallback(
    (cardId: string, memberId: string) => {
      markDirty();
      setLayout((prev) =>
        prev
          ? {
              lg: prev.lg.map((c) =>
                c.id === cardId ? { ...c, config: { ...c.config, memberId } } : c,
              ),
              sm: prev.sm.map((c) =>
                c.id === cardId ? { ...c, config: { ...c.config, memberId } } : c,
              ),
            }
          : prev,
      );
    },
    [markDirty],
  );

  const showGrid =
    syncLayouts !== null &&
    !layoutLoading &&
    (syncLayouts.lg.length > 0 || editing);

  return (
    <section className="screen dashboard-screen">
      <ScreenHead title={project?.name ?? "Home"}>
        <DashboardEditBar
          editing={editing}
          onCustomize={() => setEditing(true)}
          onDone={handleDone}
          onReset={handleReset}
          onAdd={() => setPickerOpen(true)}
          disabled={fromSnapshot}
        />
      </ScreenHead>
      {fromSnapshot && !editing && (
        <p className="muted dashboard-snapshot-note">Showing your last saved view. Updating…</p>
      )}
      {editing && (
        <p className="muted dashboard-edit-hint">Drag a card to move it, drag its corner to resize, or remove it with ✕. Done saves.</p>
      )}

      {layoutLoading && <ScreenLoader status="Loading dashboard…" compact />}
      {layoutError && <FormError>{layoutError}</FormError>}
      {statsError && (
        <p className="error dashboard-inline-error" role="alert">
          {statsError}
        </p>
      )}

      {!layoutLoading && syncLayouts && syncLayouts.lg.length === 0 && !editing && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="home" />}
          title="No cards yet"
          body="Pick what this dashboard shows: papers to read, recent log entries, milestones and more."
          action={
            <Button variant="primary" onClick={() => setEditing(true)} disabled={fromSnapshot}>
              Customize
            </Button>
          }
        />
      )}

      {showGrid && syncLayouts && project && (
        <DashboardGrid
          key={`${project.id}-${isSupervisor}`}
          layout={syncLayouts}
          editing={editing}
          stats={stats}
          supervision={supervision}
          supervisees={supervisees}
          cardsEntered={cardsEntered || editing}
          statsLoading={statsLoading}
          contentReady={contentReady || editing}
          onEnterComplete={handleEnterComplete}
          onLayoutChange={handleLayoutChange}
          onRemove={handleRemove}
          onSuperviseeConfig={handleSuperviseeConfig}
        />
      )}

      {pickerOpen && (
        <CardPickerSheet
          role={profile?.role}
          onPick={handleAdd}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}
