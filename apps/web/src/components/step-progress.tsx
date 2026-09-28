"use client";

export type StepState = "pending" | "active" | "done" | "error";

export interface Step {
  label: string;
  state: StepState;
  /** 0..1 while active; left out, an active bar runs indeterminate. */
  value?: number | null;
  detail?: string;
}

/** A job as its stages, one bar each: a stage fills, ticks, and the next one starts. */
export function StepProgress({ steps, label }: { steps: readonly Step[]; label: string }) {
  return (
    <ol className="step-progress" aria-label={label} aria-live="polite">
      {steps.map((step, i) => {
        const pct =
          step.state === "done" ? 100 : step.state === "active" && step.value != null ? Math.round(step.value * 100) : null;
        return (
          <li key={step.label} className="step-progress-step" data-state={step.state}>
            <span className="step-progress-head">
              <span className="step-progress-mark" aria-hidden>
                {step.state === "done" ? "✓" : step.state === "error" ? "!" : i + 1}
              </span>
              <span className="step-progress-label">{step.label}</span>
              {step.state === "active" && pct !== null && <span className="step-progress-pct">{pct}%</span>}
            </span>
            <span
              className="progress-bar step-progress-bar"
              role="progressbar"
              aria-label={step.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
              data-indeterminate={step.state === "active" && pct === null ? "" : undefined}
            >
              <span style={{ width: `${pct ?? (step.state === "active" ? 100 : 0)}%` }} />
            </span>
            {step.detail && <span className="step-progress-detail">{step.detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}
