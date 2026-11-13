//! The folder mirror's sync coalescer as a pure state machine (`createCoalescer` in
//! `apps/web/src/features/workspace/application/parts-3.ts`).
//!
//! A burst of requests becomes one run after a quiet period; a request that lands while a
//! run is in flight re-runs once afterwards; a suspended coalescer never runs. The step
//! function takes the state and one event and returns the new state and the actions to
//! perform. Timers, the run itself and error reporting stay in TypeScript.

use serde::{Deserialize, Serialize};

/// What the coalescer remembers between events. Field names match the TypeScript view.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoalescerState {
    /// True while a read-back is being applied, so the mirror stands down.
    pub suspended: bool,
    /// A debounce timer is armed and has not fired or been cleared.
    pub timer_armed: bool,
    /// A run is in progress.
    pub in_flight: bool,
    /// A request arrived during a run, so one more run is owed afterwards.
    pub again: bool,
}

/// An input to the coalescer.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CoalescerEvent {
    /// `request()`: restart the debounce clock.
    Request,
    /// `cancel()`: drop a pending request; a run in flight still finishes.
    Cancel,
    /// The debounce timer fired.
    TimerFired,
    /// The run that was started has settled, successfully or not.
    RunSettled,
    /// `suspended` was assigned.
    Suspend {
        /// The new value of `suspended`.
        value: bool,
    },
}

/// Work the caller must perform, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CoalescerAction {
    /// Clear the armed timer.
    ClearTimer,
    /// Arm a timer for the debounce period; when it fires, send `TimerFired`.
    ArmTimer,
    /// Start a run; when it settles, send `RunSettled`.
    StartRun,
}

/// The new state and the actions for one event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoalescerStep {
    /// The coalescer state after the event.
    pub state: CoalescerState,
    /// The actions the caller must perform, in order.
    pub actions: Vec<CoalescerAction>,
}

/// Apply one event to the coalescer state.
#[must_use]
pub fn step(state: &CoalescerState, event: &CoalescerEvent) -> CoalescerStep {
    let mut next = state.clone();
    let mut actions = Vec::new();
    match event {
        CoalescerEvent::Request => {
            if !next.suspended {
                if next.timer_armed {
                    actions.push(CoalescerAction::ClearTimer);
                }
                actions.push(CoalescerAction::ArmTimer);
                next.timer_armed = true;
            }
        }
        CoalescerEvent::Cancel => {
            if next.timer_armed {
                actions.push(CoalescerAction::ClearTimer);
            }
            next.timer_armed = false;
        }
        CoalescerEvent::TimerFired => {
            next.timer_armed = false;
            request_run(&mut next, &mut actions);
        }
        CoalescerEvent::RunSettled => {
            next.in_flight = false;
            let owed = next.again;
            next.again = false;
            if owed && !next.suspended {
                request_run(&mut next, &mut actions);
            }
        }
        CoalescerEvent::Suspend { value } => {
            next.suspended = *value;
        }
    }
    CoalescerStep {
        state: next,
        actions,
    }
}

/// The `run()` gate: stand down when suspended, owe a re-run when busy, else start one.
fn request_run(state: &mut CoalescerState, actions: &mut Vec<CoalescerAction>) {
    if state.suspended {
        return;
    }
    if state.in_flight {
        state.again = true;
        return;
    }
    state.in_flight = true;
    actions.push(CoalescerAction::StartRun);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> CoalescerState {
        CoalescerState::default()
    }

    #[allow(clippy::needless_pass_by_value, reason = "keeps call sites terse")]
    fn apply(state: &CoalescerState, event: CoalescerEvent) -> CoalescerStep {
        step(state, &event)
    }

    // it: "a burst of requests is one run"
    #[test]
    fn a_burst_of_requests_re_arms_one_timer_and_runs_once() {
        let first = apply(&fresh(), CoalescerEvent::Request);
        assert_eq!(first.actions, vec![CoalescerAction::ArmTimer]);
        let second = apply(&first.state, CoalescerEvent::Request);
        assert_eq!(
            second.actions,
            vec![CoalescerAction::ClearTimer, CoalescerAction::ArmTimer]
        );
        let fired = apply(&second.state, CoalescerEvent::TimerFired);
        assert_eq!(fired.actions, vec![CoalescerAction::StartRun]);
        assert!(fired.state.in_flight);
        assert!(!fired.state.timer_armed);
    }

    // it: "a request landing mid-run is honoured afterwards"
    #[test]
    fn a_request_during_a_run_owes_one_re_run_after_it_settles() {
        let running = CoalescerState {
            in_flight: true,
            ..fresh()
        };
        let timed = apply(&running, CoalescerEvent::TimerFired);
        assert!(timed.actions.is_empty());
        assert!(timed.state.again);
        let settled = apply(&timed.state, CoalescerEvent::RunSettled);
        assert_eq!(settled.actions, vec![CoalescerAction::StartRun]);
        assert!(settled.state.in_flight);
        assert!(!settled.state.again);
        let done = apply(&settled.state, CoalescerEvent::RunSettled);
        assert!(done.actions.is_empty());
        assert!(!done.state.in_flight);
    }

    // it: "a suspended coalescer stands down"
    #[test]
    fn a_suspended_coalescer_ignores_requests_and_timers() {
        let suspended = apply(&fresh(), CoalescerEvent::Suspend { value: true }).state;
        let requested = apply(&suspended, CoalescerEvent::Request);
        assert!(requested.actions.is_empty());
        assert!(!requested.state.timer_armed);
        let fired = apply(&suspended, CoalescerEvent::TimerFired);
        assert!(fired.actions.is_empty());
        assert!(!fired.state.in_flight);
    }

    // Rust-only: a run owed while suspended is dropped when it settles.
    #[test]
    fn a_run_owed_while_suspended_is_dropped_when_it_settles() {
        let owed = CoalescerState {
            in_flight: true,
            again: true,
            suspended: true,
            timer_armed: false,
        };
        let settled = apply(&owed, CoalescerEvent::RunSettled);
        assert!(settled.actions.is_empty());
        assert!(!settled.state.again);
        assert!(!settled.state.in_flight);
    }

    // it: "cancelling drops a pending request"
    #[test]
    fn cancel_drops_a_pending_request_and_leaves_a_run_in_flight_alone() {
        let pending = apply(&fresh(), CoalescerEvent::Request).state;
        let cancelled = apply(&pending, CoalescerEvent::Cancel);
        assert_eq!(cancelled.actions, vec![CoalescerAction::ClearTimer]);
        assert!(!cancelled.state.timer_armed);
        let running = CoalescerState {
            in_flight: true,
            ..fresh()
        };
        let idle = apply(&running, CoalescerEvent::Cancel);
        assert!(idle.actions.is_empty());
        assert!(idle.state.in_flight);
    }

    // Rust-only: resuming does not start a run by itself.
    #[test]
    fn resuming_does_not_start_a_run_by_itself() {
        let suspended = CoalescerState {
            suspended: true,
            ..fresh()
        };
        let resumed = apply(&suspended, CoalescerEvent::Suspend { value: false });
        assert!(resumed.actions.is_empty());
        assert!(!resumed.state.suspended);
        assert!(!resumed.state.in_flight);
    }
}
