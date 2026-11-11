//! The relative part of the "edited 3h ago" label on a section's meta line. Port of the relative
//! branch of `apps/web/src/features/report/lib/parts.ts`. The date fallback for an edit a
//! week or older stays in TS, because it depends on the reader's locale.

/// "edited just now", "edited 5m ago", "edited 3h ago" or "edited 2d ago" for an age in seconds.
///
/// `None` when the age is NaN, or a week or more (the caller then shows the date).
#[must_use]
// Floored counts, positive below each cutoff (NaN and older ages return early): the casts are exact.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn edited_relative_label(seconds: f64) -> Option<String> {
    if seconds.is_nan() {
        return None;
    }
    if seconds < 60.0 {
        return Some("edited just now".to_owned());
    }
    let minutes = (seconds / 60.0).floor();
    if minutes < 60.0 {
        return Some(format!("edited {}m ago", minutes as u64));
    }
    let hours = (minutes / 60.0).floor();
    if hours < 24.0 {
        return Some(format!("edited {}h ago", hours as u64));
    }
    let days = (hours / 24.0).floor();
    if days < 7.0 {
        return Some(format!("edited {}d ago", days as u64));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nan_has_no_label() {
        assert_eq!(edited_relative_label(f64::NAN), None);
    }

    #[test]
    fn under_a_minute_is_just_now_including_future_times() {
        assert_eq!(
            edited_relative_label(0.0).as_deref(),
            Some("edited just now")
        );
        assert_eq!(
            edited_relative_label(59.9).as_deref(),
            Some("edited just now")
        );
        assert_eq!(
            edited_relative_label(-5.0).as_deref(),
            Some("edited just now")
        );
    }

    #[test]
    fn minutes_hours_and_days_step_at_their_boundaries() {
        assert_eq!(
            edited_relative_label(60.0).as_deref(),
            Some("edited 1m ago")
        );
        assert_eq!(
            edited_relative_label(3599.0).as_deref(),
            Some("edited 59m ago")
        );
        assert_eq!(
            edited_relative_label(3600.0).as_deref(),
            Some("edited 1h ago")
        );
        assert_eq!(
            edited_relative_label(86_399.0).as_deref(),
            Some("edited 23h ago")
        );
        assert_eq!(
            edited_relative_label(86_400.0).as_deref(),
            Some("edited 1d ago")
        );
        assert_eq!(
            edited_relative_label(6.0 * 86_400.0).as_deref(),
            Some("edited 6d ago")
        );
    }

    #[test]
    fn a_week_or_more_defers_to_the_date() {
        assert_eq!(edited_relative_label(7.0 * 86_400.0), None);
        assert_eq!(edited_relative_label(f64::INFINITY), None);
    }
}
