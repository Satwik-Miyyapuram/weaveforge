//! Toast store transitions from `apps/web/src/lib/toast/parts.ts` (design D10, D-07): the
//! delete-then-undo rule, the 8 s timer with pause, the three-toast limit and the commit
//! bookkeeping that keeps a deleted row hidden while its delete runs.
//!
//! The reducer is pure. It returns the next state, the view and hidden keys, and the effects the
//! TS shell performs in order: start or stop a timer, run an Undo or action closure, and commit a
//! delete. Timers, closures, promises and listeners stay in TS.

use serde::{Deserialize, Serialize};

/// How long a toast stays open before it closes (and its delete commits).
pub const TOAST_MS: f64 = 8000.0;
/// How many toasts show at once. A fourth closes the oldest, which commits early.
pub const MAX_TOASTS: usize = 3;

/// Why a toast's timer is held. Hover and focus are the pointer and keyboard.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    Hover,
    Focus,
}

/// One open toast with the state the reducer needs. `has_run` and `has_commit` say whether the
/// shell holds a closure for it; the closures themselves stay in TS.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u32,
    pub message: String,
    #[serde(default)]
    pub action_label: Option<String>,
    pub undoable: bool,
    #[serde(default)]
    pub keys: Vec<String>,
    pub has_run: bool,
    pub has_commit: bool,
    pub remaining: f64,
    pub started_at: f64,
    pub timer_running: bool,
    #[serde(default)]
    pub pauses: Vec<PauseReason>,
}

/// A delete whose commit returned a promise and has not settled yet. Its keys stay hidden.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Committing {
    pub id: u32,
    pub keys: Vec<String>,
}

/// The whole store state. The TS shell keeps it and passes it back on every action.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastState {
    pub next_id: u32,
    #[serde(default)]
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub window_hidden: bool,
    #[serde(default)]
    pub committing: Vec<Committing>,
}

/// One toast as the screen shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub id: u32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    pub undoable: bool,
}

/// An input to the store. Ids and times are numbers from JS, so they arrive as `f64`.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Action {
    /// A plain toast, or one with its own button when `has_run` (an empty label means none).
    Show { message: String, action_label: String, has_run: bool, now: f64 },
    /// A hidden-until-closed delete with an Undo button. Its commit runs when the toast closes.
    DeferDelete { message: String, keys: Vec<String>, now: f64 },
    /// The toast's button was pressed (Undo or its own action). Never commits.
    Act { id: f64 },
    /// The toast closed (✕ or timeout). A pending delete commits now.
    Dismiss { id: f64 },
    /// Ctrl+Z outside a text field: undo the newest undoable toast.
    UndoLatest,
    Pause { id: f64, reason: PauseReason, now: f64 },
    Resume { id: f64, reason: PauseReason, now: f64 },
    /// The window was hidden or shown. A hidden window pauses every toast.
    WindowHidden { hidden: bool, now: f64 },
    /// The app is quitting: commit every pending delete.
    Flush,
    /// A commit returned a promise: its keys stay hidden until `Committed`.
    Committing { id: f64, keys: Vec<String> },
    Committed { id: f64 },
}

/// What the TS shell does, in order, after a transition.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Effect {
    /// Arm the toast's timer to fire after `ms`.
    Start { id: u32, ms: f64 },
    /// Clear the toast's timer.
    Stop { id: u32 },
    /// Run the toast's Undo or action closure.
    Run { id: u32 },
    /// Run the delete's commit closure. A promise result is reported back as `committing`.
    Commit { id: u32, keys: Vec<String> },
}

/// The result of one transition. `view` and `hidden` are current after every action; the shell
/// keeps its cached copies unless `changed` is set, so listeners only fire on real changes.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reduction {
    pub state: ToastState,
    pub effects: Vec<Effect>,
    pub view: Vec<Toast>,
    pub hidden: Vec<String>,
    /// The toast a Show or DeferDelete created, or the one UndoLatest undid.
    pub id: Option<u32>,
    pub changed: bool,
}

/// A store with nothing open.
pub fn initial_state() -> ToastState {
    ToastState { next_id: 1, entries: Vec::new(), window_hidden: false, committing: Vec::new() }
}

fn new_entry(message: String, action_label: Option<String>, undoable: bool, has_run: bool, has_commit: bool, keys: Vec<String>) -> Entry {
    Entry {
        id: 0,
        message,
        action_label,
        undoable,
        keys,
        has_run,
        has_commit,
        remaining: TOAST_MS,
        started_at: 0.0,
        timer_running: false,
        pauses: Vec::new(),
    }
}

/// Apply one action to the store.
pub fn reduce(mut state: ToastState, action: Action) -> Reduction {
    let mut effects = Vec::new();
    let (id, changed) = match action {
        Action::Show { message, action_label, has_run, now } => {
            let label = (!action_label.is_empty()).then_some(action_label);
            let id = add(&mut state, new_entry(message, label, false, has_run, false, Vec::new()), now, &mut effects);
            (Some(id), true)
        }
        Action::DeferDelete { message, keys, now } => {
            let entry = new_entry(message, Some("Undo".to_string()), true, true, true, keys);
            (Some(add(&mut state, entry, now, &mut effects)), true)
        }
        Action::Act { id } => (None, act(&mut state, id, &mut effects)),
        Action::Dismiss { id } => (None, dismiss(&mut state, id, &mut effects)),
        Action::UndoLatest => match state.entries.iter().rev().find(|e| e.undoable).map(|e| e.id) {
            Some(id) => {
                act(&mut state, f64::from(id), &mut effects);
                (Some(id), true)
            }
            None => (None, false),
        },
        Action::Pause { id, reason, now } => {
            if let Some(i) = index_of(&state, id) {
                let entry = &mut state.entries[i];
                if !entry.pauses.contains(&reason) {
                    entry.pauses.push(reason);
                }
                sync_entry(&mut state, i, now, &mut effects);
            }
            (None, false)
        }
        Action::Resume { id, reason, now } => {
            if let Some(i) = index_of(&state, id) {
                state.entries[i].pauses.retain(|r| *r != reason);
                sync_entry(&mut state, i, now, &mut effects);
            }
            (None, false)
        }
        Action::WindowHidden { hidden, now } => {
            state.window_hidden = hidden;
            for i in 0..state.entries.len() {
                sync_entry(&mut state, i, now, &mut effects);
            }
            (None, false)
        }
        Action::Flush => {
            let all: Vec<Entry> = state.entries.drain(..).collect();
            for entry in all.iter().filter(|e| e.timer_running) {
                effects.push(Effect::Stop { id: entry.id });
            }
            for entry in &all {
                commit_effect(entry, &mut effects);
            }
            (None, true)
        }
        Action::Committing { id, keys } => {
            state.committing.push(Committing { id: id as u32, keys });
            (None, true)
        }
        Action::Committed { id } => {
            state.committing.retain(|c| f64::from(c.id) != id);
            (None, true)
        }
    };
    let view = state
        .entries
        .iter()
        .map(|e| Toast { id: e.id, message: e.message.clone(), action_label: e.action_label.clone(), undoable: e.undoable })
        .collect();
    let hidden = state
        .entries
        .iter()
        .flat_map(|e| e.keys.iter())
        .chain(state.committing.iter().flat_map(|c| c.keys.iter()))
        .cloned()
        .collect();
    Reduction { state, effects, view, hidden, id, changed }
}

fn index_of(state: &ToastState, id: f64) -> Option<usize> {
    state.entries.iter().position(|e| f64::from(e.id) == id)
}

/// Remove an entry, stopping its timer. Returns it, or `None` if it is not open.
fn take(state: &mut ToastState, id: f64, effects: &mut Vec<Effect>) -> Option<Entry> {
    let i = index_of(state, id)?;
    let entry = state.entries.remove(i);
    if entry.timer_running {
        effects.push(Effect::Stop { id: entry.id });
    }
    Some(entry)
}

fn act(state: &mut ToastState, id: f64, effects: &mut Vec<Effect>) -> bool {
    let Some(entry) = take(state, id, effects) else {
        return false;
    };
    if entry.has_run {
        effects.push(Effect::Run { id: entry.id });
    }
    true
}

fn dismiss(state: &mut ToastState, id: f64, effects: &mut Vec<Effect>) -> bool {
    let Some(entry) = take(state, id, effects) else {
        return false;
    };
    commit_effect(&entry, effects);
    true
}

fn commit_effect(entry: &Entry, effects: &mut Vec<Effect>) {
    if entry.has_commit {
        effects.push(Effect::Commit { id: entry.id, keys: entry.keys.clone() });
    }
}

/// Open a new toast. The oldest is closed when there are more than `MAX_TOASTS`, and its delete
/// commits early (after the new toast's timer is armed, as the TS shell did before).
fn add(state: &mut ToastState, mut entry: Entry, now: f64, effects: &mut Vec<Effect>) -> u32 {
    let id = state.next_id;
    state.next_id += 1;
    entry.id = id;
    entry.started_at = now;
    state.entries.push(entry);
    let overflow_n = state.entries.len().saturating_sub(MAX_TOASTS);
    let overflow: Vec<Entry> = state.entries.drain(..overflow_n).collect();
    for old in overflow.iter().filter(|e| e.timer_running) {
        effects.push(Effect::Stop { id: old.id });
    }
    let last = state.entries.len() - 1;
    sync_entry(state, last, now, effects);
    for old in &overflow {
        commit_effect(old, effects);
    }
    id
}

/// Run the timer only while nothing pauses it, keeping the time left. Idempotent: a timer that
/// is already in the right state gets no effect.
fn sync_entry(state: &mut ToastState, i: usize, now: f64, effects: &mut Vec<Effect>) {
    let window_hidden = state.window_hidden;
    let entry = &mut state.entries[i];
    let paused = window_hidden || !entry.pauses.is_empty();
    if entry.timer_running {
        if paused {
            entry.remaining -= now - entry.started_at;
            entry.timer_running = false;
            effects.push(Effect::Stop { id: entry.id });
        }
    } else if !paused {
        entry.started_at = now;
        entry.timer_running = true;
        effects.push(Effect::Start { id: entry.id, ms: entry.remaining.max(0.0) });
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    /// Plays the TS shell: holds the timers, closures and cached view, and performs each effect.
    struct Shell {
        state: ToastState,
        now: f64,
        timers: BTreeMap<u32, f64>,
        runs: Vec<u32>,
        commits: Vec<u32>,
        view: Vec<Toast>,
        hidden: Vec<String>,
    }

    impl Shell {
        fn new() -> Self {
            Self { state: initial_state(), now: 0.0, timers: BTreeMap::new(), runs: Vec::new(), commits: Vec::new(), view: Vec::new(), hidden: Vec::new() }
        }

        fn apply(&mut self, action: Action) -> Option<u32> {
            let Reduction { state, effects, view, hidden, id, changed } = reduce(self.state.clone(), action);
            self.state = state;
            if changed {
                self.view = view;
                self.hidden = hidden;
            }
            for effect in effects {
                match effect {
                    Effect::Start { id, ms } => {
                        self.timers.insert(id, self.now + ms);
                    }
                    Effect::Stop { id } => {
                        self.timers.remove(&id);
                    }
                    Effect::Run { id } => self.runs.push(id),
                    Effect::Commit { id, .. } => self.commits.push(id),
                }
            }
            id
        }

        fn show(&mut self, message: &str) -> u32 {
            let now = self.now;
            self.apply(Action::Show { message: message.to_string(), action_label: String::new(), has_run: false, now }).expect("show returns its id")
        }

        fn show_with_action(&mut self, message: &str) -> u32 {
            let now = self.now;
            self.apply(Action::Show { message: message.to_string(), action_label: "Open".to_string(), has_run: true, now }).expect("show returns its id")
        }

        fn defer(&mut self, keys: &[&str], message: &str) -> u32 {
            let now = self.now;
            let keys = keys.iter().map(|k| k.to_string()).collect();
            self.apply(Action::DeferDelete { message: message.to_string(), keys, now }).expect("deferDelete returns its id")
        }

        fn act(&mut self, id: u32) {
            self.apply(Action::Act { id: f64::from(id) });
        }

        fn dismiss(&mut self, id: u32) {
            self.apply(Action::Dismiss { id: f64::from(id) });
        }

        fn pause(&mut self, id: u32, reason: PauseReason) {
            let now = self.now;
            self.apply(Action::Pause { id: f64::from(id), reason, now });
        }

        fn resume(&mut self, id: u32, reason: PauseReason) {
            let now = self.now;
            self.apply(Action::Resume { id: f64::from(id), reason, now });
        }

        /// Move the clock on, closing each toast whose timer comes due on the way.
        fn advance(&mut self, ms: f64) {
            let target = self.now + ms;
            loop {
                let next = self.timers.iter().min_by(|a, b| a.1.total_cmp(b.1)).map(|(id, due)| (*id, *due));
                match next {
                    Some((id, due)) if due <= target => {
                        self.now = due;
                        self.timers.remove(&id);
                        self.dismiss(id);
                    }
                    _ => break,
                }
            }
            self.now = target;
        }
    }

    #[test]
    // it: "a toast stays 8 seconds, then closes"
    fn a_toast_stays_eight_seconds_then_closes() {
        let mut shell = Shell::new();
        shell.show("Saved");
        shell.advance(TOAST_MS - 1.0);
        assert_eq!(shell.view.len(), 1);
        shell.advance(1.0);
        assert!(shell.view.is_empty());
    }

    #[test]
    // it: "a deferred delete hides its key at once and commits only when the toast closes"
    fn a_deferred_delete_hides_its_key_and_commits_on_close() {
        let mut shell = Shell::new();
        let id = shell.defer(&["a"], "Paper deleted");
        assert_eq!(shell.hidden, vec!["a".to_string()]);
        shell.advance(TOAST_MS - 1.0);
        assert!(shell.commits.is_empty());
        shell.advance(1.0);
        assert_eq!(shell.commits, vec![id]);
        assert!(shell.hidden.is_empty());
    }

    #[test]
    // it: "Undo restores the item, never commits, and closes the toast"
    fn undo_restores_the_item_never_commits_and_closes_the_toast() {
        let mut shell = Shell::new();
        let id = shell.defer(&["a"], "Paper deleted");
        shell.act(id);
        assert_eq!(shell.runs, vec![id]);
        assert!(shell.commits.is_empty());
        assert!(shell.view.is_empty());
        assert!(shell.hidden.is_empty());
    }

    #[test]
    // it: "dismissing a delete toast commits it now"
    fn dismissing_a_delete_toast_commits_it_now() {
        let mut shell = Shell::new();
        let id = shell.defer(&["a"], "Paper deleted");
        shell.dismiss(id);
        assert_eq!(shell.commits, vec![id]);
    }

    #[test]
    // it: "hover and focus pause the timer; leaving resumes with the time that was left"
    fn hover_and_focus_pause_the_timer_and_resume_with_time_left() {
        let mut shell = Shell::new();
        let id = shell.show("Saved");
        shell.advance(3000.0);
        shell.pause(id, PauseReason::Hover);
        assert!(shell.timers.is_empty());
        shell.advance(6000.0);
        shell.pause(id, PauseReason::Focus);
        shell.resume(id, PauseReason::Hover);
        assert!(shell.timers.is_empty(), "still paused by focus");
        shell.advance(1000.0);
        shell.resume(id, PauseReason::Focus);
        // 5000 ms were left when the hover pause began.
        assert_eq!(shell.timers.get(&id), Some(&(shell.now + 5000.0)));
        shell.advance(4999.0);
        assert_eq!(shell.view.len(), 1);
        shell.advance(1.0);
        assert!(shell.view.is_empty());
    }

    #[test]
    // it: "a hidden window pauses every toast"
    fn a_hidden_window_pauses_every_toast() {
        let mut shell = Shell::new();
        shell.show("Saved");
        shell.advance(2000.0);
        let now = shell.now;
        shell.apply(Action::WindowHidden { hidden: true, now });
        shell.advance(100_000.0);
        assert_eq!(shell.view.len(), 1);
        let now = shell.now;
        shell.apply(Action::WindowHidden { hidden: false, now });
        // 6000 ms were left when the window was hidden.
        shell.advance(5999.0);
        assert_eq!(shell.view.len(), 1);
        shell.advance(1.0);
        assert!(shell.view.is_empty());
    }

    #[test]
    // it: "undoLatest undoes the newest undoable toast and reports whether it did"
    fn undo_latest_undoes_the_newest_undoable_toast_and_reports_it() {
        let mut shell = Shell::new();
        shell.show("Saved");
        let a = shell.defer(&["a"], "A deleted");
        let b = shell.defer(&["b"], "B deleted");
        assert_eq!(shell.apply(Action::UndoLatest), Some(b));
        assert_eq!(shell.apply(Action::UndoLatest), Some(a));
        assert_eq!(shell.apply(Action::UndoLatest), None);
        assert_eq!(shell.runs, vec![b, a]);
        assert_eq!(shell.view.len(), 1, "the plain toast stays");
    }

    #[test]
    // it: "at most three toasts show; a fourth closes the oldest, which commits early"
    fn at_most_three_toasts_show_and_a_fourth_commits_the_oldest() {
        assert_eq!(MAX_TOASTS, 3);
        let mut shell = Shell::new();
        let first = shell.defer(&["a"], "A deleted");
        shell.defer(&["b"], "B deleted");
        shell.defer(&["c"], "C deleted");
        assert!(shell.commits.is_empty());
        shell.defer(&["d"], "D deleted");
        assert_eq!(shell.commits, vec![first]);
        assert_eq!(shell.view.len(), MAX_TOASTS);
    }

    #[test]
    // it: "a bulk delete is one toast that hides every key and commits once"
    fn a_bulk_delete_is_one_toast_that_hides_every_key_and_commits_once() {
        let mut shell = Shell::new();
        let id = shell.defer(&["a", "b", "c"], "3 papers deleted");
        assert_eq!(shell.view.len(), 1);
        assert_eq!(shell.hidden, vec!["a", "b", "c"]);
        shell.advance(TOAST_MS);
        assert_eq!(shell.commits, vec![id]);
        assert!(shell.hidden.is_empty());
    }

    #[test]
    // it: "flush commits every pending delete (app quit)"
    fn flush_commits_every_pending_delete() {
        let mut shell = Shell::new();
        let a = shell.defer(&["a"], "A deleted");
        let b = shell.defer(&["b"], "B deleted");
        shell.apply(Action::Flush);
        assert_eq!(shell.commits, vec![a, b]);
        assert!(shell.view.is_empty());
        assert!(shell.timers.is_empty());
    }

    #[test]
    // it: "a toast with its own action runs it and closes"
    fn a_toast_with_its_own_action_runs_it_and_closes() {
        let mut shell = Shell::new();
        let id = shell.show_with_action("Opened elsewhere");
        shell.act(id);
        assert_eq!(shell.runs, vec![id]);
        assert!(shell.commits.is_empty());
        assert!(shell.view.is_empty());
    }
}
