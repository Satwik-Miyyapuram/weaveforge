import { planWidgetData, type FeedMilestone, type PlanWidgetData } from "@weaveforge/core";
import { milestoneToDomain, type MilestoneRow } from "@/features/plan/infrastructure/milestone-rows";

/**
 * The plan widget's pure half: what it reads, how the rows become the widget's
 * data, where it may sit, and the one Win32 call that puts it on the desktop.
 *
 * Kept free of Electron so each rule can be tested without an app. The window,
 * the timer and the IPC are `main-plan-widget.ts`.
 */

/**
 * The owner's open milestones and their project names, from the local database.
 *
 * `auth.uid()` rather than trusting RLS alone: a milestone shared with the
 * owner is readable, but it is somebody else's deadline, and the calendar feed
 * leaves those out for the same reason. A milestone whose project was deleted
 * went with it.
 */
export const PLAN_WIDGET_SQL = `
select m.id, m.title, m.description, m.status, m.target_date, m.dependencies, m.compute, m.created_at,
       p.name as project_name
from milestones m
left join projects p on p.id = m.project_id and p.deleted_at is null
where m.deleted_at is null
  and m.user_id = auth.uid()
  and (m.project_id is null or p.id is not null)
`;

export type PlanWidgetRow = MilestoneRow & { project_name: string | null };

/** How many deadlines the widget has room for. */
export const PLAN_WIDGET_LIMIT = 6;

export function widgetDataFromRows(rows: readonly PlanWidgetRow[], now: Date): PlanWidgetData {
  const items: FeedMilestone[] = rows.map((row) => ({
    milestone: milestoneToDomain(row),
    projectName: row.project_name ?? undefined,
  }));
  return planWidgetData(items, { now, limit: PLAN_WIDGET_LIMIT });
}

export interface WidgetBounds {
  x: number;
  y: number;
}

export const PLAN_WIDGET_SIZE = { width: 320, height: 380 } as const;

/**
 * Where the widget was left, read back from the preference file.
 *
 * Only a position is kept, never a size: the widget draws itself at one size.
 * A value that is not two finite numbers reads as "not placed yet", so a hand-
 * edited file costs the position and nothing else.
 */
export function parseBounds(value: unknown): WidgetBounds | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y } = parsed as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  } catch {
    return null;
  }
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A position that is on one of the screens.
 *
 * A widget left on a monitor that is no longer plugged in would be a widget
 * nobody can see or move. If the saved spot is not inside any work area, it
 * goes to the top-right corner of the first one.
 */
export function placeWidget(saved: WidgetBounds | null, areas: readonly WorkArea[]): WidgetBounds {
  const { width, height } = PLAN_WIDGET_SIZE;
  const fits = (a: WorkArea, b: WidgetBounds) =>
    b.x >= a.x && b.y >= a.y && b.x + width <= a.x + a.width && b.y + height <= a.y + a.height;
  if (saved && areas.some((a) => fits(a, saved))) return saved;
  const first = areas[0] ?? { x: 0, y: 0, width: 1280, height: 800 };
  return { x: first.x + first.width - width - 32, y: first.y + 32 };
}

/**
 * The window handle Electron hands back, as a number.
 *
 * `getNativeWindowHandle()` is the HWND's bytes in the machine's order: eight
 * of them on a 64-bit build, four on a 32-bit one.
 */
export function hwndFromHandle(handle: Uint8Array): bigint {
  const view = new DataView(handle.buffer, handle.byteOffset, handle.byteLength);
  return handle.byteLength >= 8 ? view.getBigUint64(0, true) : BigInt(view.getUint32(0, true));
}

/**
 * The PowerShell that puts a window on the desktop, the way Rainmeter's
 * "On desktop" does.
 *
 * The window is given `Progman` — the desktop's own window — as its owner.
 * An owned window always sits above its owner and never below it, and the
 * desktop is the bottom of everything, so the widget stays just above the
 * wallpaper and icons, under every ordinary window, and survives Show desktop
 * (Win+D), which hides ordinary windows and brings the desktop forward. Then
 * it is sent to the bottom once, without being activated.
 *
 * This is deliberately not the WorkerW reparenting that animated-wallpaper
 * apps use: a child of WorkerW cannot take clicks, and its position changed
 * between Windows 11 releases. An owner is a documented relation that has
 * behaved the same since XP.
 *
 * The window name is passed as a null pointer, not `$null`: PowerShell turns
 * `$null` into an empty string for a `string` parameter, and no desktop is
 * titled "", so the lookup found nothing and the pin silently never happened.
 *
 * It prints the id of the `TaskbarCreated` message, which Explorer broadcasts
 * when it starts again. A restarted Explorer is a new desktop window, and the
 * widget is left owned by nothing (so Show desktop hides it); the shell hooks
 * that message and pins again (see `parseTaskbarCreated`).
 *
 * The HWND is the only input and it is a number, formatted here, so nothing
 * from outside reaches the script text.
 */
export function pinScript(hwnd: bigint): string {
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WeaveForgePin {
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr FindWindow(string cls, IntPtr name);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
}
'@
$ProgressPreference = 'SilentlyContinue'
$window = [IntPtr][Int64]${hwnd.toString()}
[WeaveForgePin]::RegisterWindowMessage('TaskbarCreated')
$desktop = [WeaveForgePin]::FindWindow('Progman', [IntPtr]::Zero)
if ($desktop -eq [IntPtr]::Zero) { exit 2 }
[void][WeaveForgePin]::SetWindowLongPtr($window, -8, $desktop)
[void][WeaveForgePin]::SetWindowPos($window, [IntPtr]1, 0, 0, 0, 0, 0x13)
`;
}

/**
 * The `TaskbarCreated` message id `pinScript` printed, or null. Registered
 * message ids are 0xC000 to 0xFFFF.
 */
export function parseTaskbarCreated(stdout: string): number | null {
  const id = Number(stdout.trim().split(/\s+/)[0]);
  return Number.isInteger(id) && id >= 0xc000 && id <= 0xffff ? id : null;
}

/**
 * The arguments that run [script] in Windows PowerShell.
 *
 * As `-EncodedCommand` (UTF-16LE, base64), not on stdin: `-Command -` reads
 * stdin a line at a time, as if typed, and drops a multi-line here-string, so
 * `pinScript`'s `Add-Type` never ran and the widget was never pinned.
 */
export function powershellArgs(script: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}
