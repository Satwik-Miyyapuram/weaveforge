//! Ports `motionTier`, `transitionsOn` and `isPlainClick` in
//! `apps/web/src/lib/view-transition.ts`. The DOM reads, the View Transitions
//! call and the route settle wait stay in TS.

/// How far a page transition moves: none, a calm crossfade, the bigger Reactive
/// one, or the stepped CRT one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionTier {
    /// No transition: reduced motion, or the browser lacks the API.
    Off,
    /// The default crossfade.
    Calm,
    /// The person chose Reactive motion.
    Reactive,
    /// The CRT theme's stepped transition.
    Crt,
}

impl MotionTier {
    /// The lowercase name the TypeScript side uses (`"off"`, `"calm"`, ...).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Calm => "calm",
            Self::Reactive => "reactive",
            Self::Crt => "crt",
        }
    }
}

/// Calm by default, bigger with Reactive motion, stepped on CRT; off when
/// reduced or unsupported. `motion` and `theme` are the document's data attributes.
#[must_use]
pub fn motion_tier(
    motion: Option<&str>,
    theme: Option<&str>,
    reduced_motion: bool,
    supported: bool,
) -> MotionTier {
    if !supported || reduced_motion {
        return MotionTier::Off;
    }
    if theme == Some("crt") {
        return MotionTier::Crt;
    }
    if motion == Some("reactive") {
        MotionTier::Reactive
    } else {
        MotionTier::Calm
    }
}

/// True when the tier animates at all (anything but [`MotionTier::Off`]).
#[must_use]
pub fn transitions_on(tier: MotionTier) -> bool {
    tier != MotionTier::Off
}

/// The mouse state a link click is judged by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClickState {
    /// Mouse button index; 0 is the primary button.
    pub button: i32,
    /// An earlier handler already called `preventDefault()`.
    pub default_prevented: bool,
    /// Meta (Cmd) key held.
    pub meta: bool,
    /// Ctrl key held.
    pub ctrl: bool,
    /// Shift key held.
    pub shift: bool,
    /// Alt (Option) key held.
    pub alt: bool,
}

/// A plain left click that a link would follow in this window: primary button,
/// no modifier keys, and no handler has taken it over.
#[must_use]
pub fn is_plain_click(click: ClickState) -> bool {
    !click.default_prevented
        && click.button == 0
        && !click.meta
        && !click.ctrl
        && !click.shift
        && !click.alt
}

#[cfg(test)]
mod tests {
    use super::{ClickState, MotionTier, is_plain_click, motion_tier, transitions_on};

    fn plain() -> ClickState {
        ClickState {
            button: 0,
            default_prevented: false,
            meta: false,
            ctrl: false,
            shift: false,
            alt: false,
        }
    }

    #[test]
    fn unsupported_or_reduced_motion_is_off() {
        assert_eq!(motion_tier(None, None, false, false), MotionTier::Off);
        assert_eq!(
            motion_tier(Some("reactive"), Some("crt"), true, true),
            MotionTier::Off
        );
    }

    #[test]
    fn crt_theme_wins_over_motion_setting() {
        assert_eq!(
            motion_tier(Some("reactive"), Some("crt"), false, true),
            MotionTier::Crt
        );
    }

    #[test]
    fn reactive_motion_and_calm_default() {
        assert_eq!(
            motion_tier(Some("reactive"), None, false, true),
            MotionTier::Reactive
        );
        assert_eq!(motion_tier(None, None, false, true), MotionTier::Calm);
        assert_eq!(
            motion_tier(Some("calm"), Some("light"), false, true),
            MotionTier::Calm
        );
    }

    #[test]
    fn tier_names_match_typescript() {
        assert_eq!(MotionTier::Off.as_str(), "off");
        assert_eq!(MotionTier::Calm.as_str(), "calm");
        assert_eq!(MotionTier::Reactive.as_str(), "reactive");
        assert_eq!(MotionTier::Crt.as_str(), "crt");
    }

    #[test]
    fn transitions_on_is_every_tier_but_off() {
        assert!(!transitions_on(MotionTier::Off));
        assert!(transitions_on(MotionTier::Calm));
        assert!(transitions_on(MotionTier::Reactive));
        assert!(transitions_on(MotionTier::Crt));
    }

    #[test]
    fn plain_left_click_follows_the_link() {
        assert!(is_plain_click(plain()));
    }

    #[test]
    fn modifiers_middle_and_prevented_clicks_do_not() {
        let mut click = plain();
        click.meta = true;
        assert!(!is_plain_click(click));
        let mut click = plain();
        click.ctrl = true;
        assert!(!is_plain_click(click));
        let mut click = plain();
        click.shift = true;
        assert!(!is_plain_click(click));
        let mut click = plain();
        click.alt = true;
        assert!(!is_plain_click(click));
        let mut click = plain();
        click.button = 1;
        assert!(!is_plain_click(click));
        let mut click = plain();
        click.default_prevented = true;
        assert!(!is_plain_click(click));
    }
}
