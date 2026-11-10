//! The smoothing factor of the 1-Euro pen filter. A port of the stateless part of
//! `apps/web/src/features/ink/application/one-euro-filter.ts`; the stateful
//! filters stay in TS on the pen path.

use super::js_math::max;

/// Milliseconds in a second: cutoffs are per second, timesteps per millisecond.
const MS_PER_SECOND: f64 = 1_000.0;

/// The smoothing factor for a cutoff in hertz and a timestep in milliseconds,
/// `1 / (1 + tau / dt)`. A zero timestep is clamped, so it never divides by zero.
#[must_use]
pub fn one_euro_alpha(cutoff: f64, dt_ms: f64) -> f64 {
    let dt = max(dt_ms, 1e-6) / MS_PER_SECOND;
    let tau = 1.0 / (2.0 * std::f64::consts::PI * max(cutoff, 1e-6));
    1.0 / (1.0 + tau / dt)
}

#[cfg(test)]
mod tests {
    use super::one_euro_alpha;

    #[test]
    fn a_very_high_cutoff_is_nearly_the_identity() {
        assert!(one_euro_alpha(1000.0, 8.0) > 0.97);
    }

    #[test]
    fn a_higher_cutoff_follows_the_signal_more_closely() {
        assert!(one_euro_alpha(1.0, 8.0) < one_euro_alpha(10.0, 8.0));
    }

    #[test]
    fn a_zero_timestep_is_finite_and_damps() {
        let alpha = one_euro_alpha(1.0, 0.0);
        assert!(alpha.is_finite());
        assert!(alpha < 1.0);
    }

    #[test]
    fn one_hertz_at_120_hertz_sampling_damps_hard() {
        assert!(one_euro_alpha(1.0, 8.0) < 0.1);
    }
}
