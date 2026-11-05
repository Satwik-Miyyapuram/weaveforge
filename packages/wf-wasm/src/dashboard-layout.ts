/**
 * Dashboard layout check (Rust `dashboard::layout`), re-exported from index.ts. Keeps the
 * signature of packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts.
 * The layout shape is written inline: wrapper modules declare no named types.
 */
import { parseDashboardLayout as rawParseDashboardLayout } from "../pkg/wf_wasm.js";

/**
 * Parse layout JSON from persistence (no compaction); invalid cards are dropped, valid ones
 * keep extra keys such as `config`. Null when `lg` or `sm` is not an array.
 */
export function parseDashboardLayout(raw: unknown): {
  lg: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[];
  sm: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[];
} | null {
  return rawParseDashboardLayout(raw) as ReturnType<typeof parseDashboardLayout>;
}
