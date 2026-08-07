"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProfile } from "@/features/org";
import { useProject } from "@/features/projects";
import { formatError } from "@/lib/format-error";
import { isSupervisorRole } from "@weaveforge/core";
import type { DashboardLayout, DashboardCardType } from "@weaveforge/core";
import { registerDashboardUiCacheClear } from "@/lib/clear-session-caches";
import { ScreenLoader } from "@/components/weaveforge-loader";

import {
  appendCardPair,
  clearLegacyLayoutStorage,
  defaultLayout,
  finalizeDashboardLayout,
  layoutCacheKey,
  mergeSupervisorCardsIfMissing,
  syncDashboardLayouts,
} from "../application/dashboard-layout";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardEditBar } from "./dashboard-edit-bar";
import { CardPickerSheet } from "./card-picker-sheet";
import { useDashboardStats } from "./use-dashboard-stats";

const layoutCache = new Map<string, DashboardLayout>();
registerDashboardUiCacheClear(() => layoutCache.clear());

export function DashboardScreen() {
  const { current: project } = useProject();
  const projectId = project?.id;
  const { profile, team, loading: profileLoading } = useProfile();
  const supervisees = useMemo(
    () => team.filter((m) => m.id !== profile?.id),
    [team, profile],
  );
  const isSupervisor = isSupervisorRole(profile?.role) && supervisees.length > 0;

  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutReady = useRef(false);
  const layoutDirty = useRef(false);
  const [cardsEntered, setCardsEntered] = useState(false);

  const syncLayouts = useMemo(
    () => (layout ? syncDashboardLayouts(layout) : null),
    [layout],
  );

  const cardTypes = useMemo(
    () => syncLayouts?.lg.map((c) => c.type) ?? [],
    [syncLayouts],
  );

  const { stats, supervision, statsLoading, statsError } = useDashboardStats(
    cardTypes,
    supervisees,
  );

  const handleEnterComplete = useCallback(() => setCardsEntered(true), []);
  const contentReady = !statsLoading && !layoutLoading;


  // Load saved layout from Supabase when project changes (after profile is ready).
  useEffect(() => {
    setCardsEntered(false);
    if (!projectId || profileLoading) return;
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
    } else {
      setLayout(null);
      setLayoutLoading(true);
    }

    clearLegacyLayoutStorage(projectId);

    (async () => {
      try {
        const stored = await getContainer().dashboard.getLayout(projectId);
        if (!active) return;
        const base = stored ?? defaultLayout(supervisorLayout);
        const merged = supervisorLayout ? mergeSupervisorCardsIfMissing(base) : base;
        const next = finalizeDashboardLayout(merged);
        layoutCache.set(cacheKey, next);
        setLayout(next);
      } catch (err) {
        if (!active) return;
        setLayoutError(formatError(err));
        const next = finalizeDashboardLayout(defaultLayout(supervisorLayout));
        layoutCache.set(cacheKey, next);
        setLayout(next);
      } finally {
        if (active) {
          setLayoutLoading(false);
          layoutReady.current = true;
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, profileLoading, profile?.role, supervisees.length]);

  // Debounced save to Supabase (user edits only).
  useEffect(() => {
    if (!projectId || !layoutReady.current || layoutLoading || !layout || !layoutDirty.current) {
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
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
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [layout, projectId, layoutLoading, profile?.role, supervisees.length]);

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
    markDirty();
    setLayout(finalizeDashboardLayout(defaultLayout(isSupervisor)));
  }, [isSupervisor, markDirty]);

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
      <header className="screen-head">
        <div className="head-row dashboard-head-row">
          <h1 className="screen-title">{project?.name ?? "Home"}</h1>
          <DashboardEditBar
            editing={editing}
            onCustomize={() => setEditing(true)}
            onDone={handleDone}
            onReset={handleReset}
            onAdd={() => setPickerOpen(true)}
          />
        </div>
      </header>

      {layoutLoading && <ScreenLoader status="Loading dashboard…" compact />}
      {layoutError && <p className="error">{layoutError}</p>}
      {statsError && (
        <p className="error dashboard-inline-error" role="alert">
          {statsError}
        </p>
      )}

      {!layoutLoading && syncLayouts && syncLayouts.lg.length === 0 && !editing && (
        <p className="muted dashboard-empty">No cards yet. Tap customize to add widgets.</p>
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
