//! The 1-Euro pen filter. A port of `apps/web/src/features/ink/application/parts-2.ts`:
//! the smoothing factor, the one-channel [`OneEuroFilter`] and the pen-level [`NibFilter`].
//! Float operations are kept in the TS order so the two agree bit for bit.

use super::js_math::{hypot, max};

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

/// Cutoffs and speed coefficient for one channel.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneEuroOptions {
    /// Cutoff at zero speed, in hertz.
    pub min_cutoff: f64,
    /// How fast the cutoff rises with speed, in hertz per (0.1 mm/ms).
    pub beta: f64,
    /// Cutoff for the internal derivative estimate, in hertz.
    pub derivative_cutoff: f64,
}

/// The tuned position channel. Its cutoff rises with speed (`beta` 30), so a fast
/// stroke is nearly unfiltered and a still pen is damped. The derivative cutoff is
/// 3 Hz, not the paper's 1 Hz, so the speed estimate responds in time.
///
/// | Speed | Cutoff | Lag behind a moving stroke |
/// | --- | --- | --- |
/// | 0.05 units/ms (slow line) | 2.5 Hz | a fraction of a pixel |
/// | 0.5 units/ms (writing) | 16 Hz | ~0.5 mm |
/// | 5 units/ms (fast sweep) | 151 Hz | ~0.5 mm |
///
/// A fixed 1 Hz low-pass would lag a writing-speed stroke by ~4 mm. The first
/// tuning was `beta` 80, which phased out at writing speed (41 Hz) and let the
/// digitiser's jitter through as a wobble; 30 caps the lag near half a millimetre.
#[must_use]
pub fn position_options() -> OneEuroOptions {
    OneEuroOptions {
        min_cutoff: 1.0,
        beta: 30.0,
        derivative_cutoff: 3.0,
    }
}

/// The tuned pressure channel: a higher floor (5 Hz) and a small `beta` (2), because
/// a press does not phase out with pen speed.
#[must_use]
pub fn pressure_options() -> OneEuroOptions {
    OneEuroOptions {
        min_cutoff: 5.0,
        beta: 2.0,
        derivative_cutoff: 3.0,
    }
}

/// The saved state of one channel: value, derivative, previous value and previous time.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct OneEuroState {
    /// The filtered value, `None` before the first sample.
    pub value: Option<f64>,
    /// The filtered derivative (speed), in value units per millisecond.
    pub derivative: f64,
    /// The raw value of the previous sample.
    pub previous_value: Option<f64>,
    /// The timestamp of the previous sample, in milliseconds.
    pub previous_time: Option<f64>,
}

/// One scalar channel, filtered.
#[derive(Clone, Debug)]
pub struct OneEuroFilter {
    options: OneEuroOptions,
    state: OneEuroState,
}

impl OneEuroFilter {
    /// A filter with no samples yet, using `options` for its cutoffs.
    #[must_use]
    pub fn new(options: OneEuroOptions) -> Self {
        Self {
            options,
            state: OneEuroState::default(),
        }
    }

    /// The last filtered value, or `None` before the first sample.
    #[must_use]
    pub fn last(&self) -> Option<f64> {
        self.state.value
    }

    /// The last estimated speed, in value units per millisecond.
    #[must_use]
    pub fn speed(&self) -> f64 {
        self.state.derivative.abs()
    }

    /// Forget everything. Called at pen-down: a new stroke is a new signal.
    pub fn reset(&mut self) {
        self.state = OneEuroState::default();
    }

    /// The state, for [`Self::restore`].
    #[must_use]
    pub fn save(&self) -> OneEuroState {
        self.state
    }

    /// Put back a state from [`Self::save`], replacing the current one.
    pub fn restore(&mut self, state: OneEuroState) {
        self.state = state;
    }

    /// Filter one sample taken at `time` milliseconds. The first sample of a
    /// stroke, and a repeated timestamp, pass through with the estimate standing.
    pub fn filter(&mut self, value: f64, time: f64) -> f64 {
        match self.observe(value, time) {
            None => self.state.value.unwrap_or(value),
            Some(dt) => {
                let speed = self.speed();
                self.settle(value, dt, speed)
            }
        }
    }

    /// First half of [`Self::filter`]: take the sample in and update the speed
    /// estimate. Returns the timestep to filter over, or `None` when there is none.
    pub fn observe(&mut self, value: f64, time: f64) -> Option<f64> {
        let (Some(_), Some(previous_time), Some(previous_value)) = (
            self.state.value,
            self.state.previous_time,
            self.state.previous_value,
        ) else {
            self.state.value = Some(value);
            self.state.previous_value = Some(value);
            self.state.previous_time = Some(time);
            return None;
        };
        let dt = time - previous_time;
        if !(dt > 0.0) {
            return None;
        }

        let raw_derivative = (value - previous_value) / dt;
        let derivative_alpha = one_euro_alpha(self.options.derivative_cutoff, dt);
        self.state.derivative += derivative_alpha * (raw_derivative - self.state.derivative);
        self.state.previous_value = Some(value);
        self.state.previous_time = Some(time);
        Some(dt)
    }

    /// Second half of [`Self::filter`]: move the filtered value with the cutoff `speed` earns.
    pub fn settle(&mut self, value: f64, dt: f64, speed: f64) -> f64 {
        let cutoff = self.options.min_cutoff + self.options.beta * speed;
        let alpha = one_euro_alpha(cutoff, dt);
        // `settle` only follows an `observe` that returned a timestep, which
        // implies a filtered value exists; `value` is the unreachable fallback.
        let current = self.state.value.unwrap_or(value);
        let next = current + alpha * (value - current);
        self.state.value = Some(next);
        next
    }
}

/// One sample as it arrives from the digitiser, in 0.1 mm.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NibSample {
    /// Horizontal position, in 0.1 mm.
    pub x: f64,
    /// Vertical position, in 0.1 mm.
    pub y: f64,
    /// 0–1, or `0`/`0.5` for a device that does not report pressure.
    pub pressure: f64,
    /// Milliseconds.
    pub t: f64,
}

/// A filtered sample: where to draw, how wide, and how fast the pen is moving.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FilteredNibSample {
    /// Filtered horizontal position, in 0.1 mm.
    pub x: f64,
    /// Filtered vertical position, in 0.1 mm.
    pub y: f64,
    /// Filtered pressure, 0-1.
    pub pressure: f64,
    /// Speed in 0.1 mm per ms, for the nib's velocity taper.
    pub velocity: f64,
    /// Milliseconds, passed through unchanged.
    pub t: f64,
}

/// A raw sample position, kept for the velocity of the next one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NibPoint {
    /// Raw horizontal position, in 0.1 mm.
    pub x: f64,
    /// Raw vertical position, in 0.1 mm.
    pub y: f64,
    /// Milliseconds.
    pub t: f64,
}

/// The whole saved state of a [`NibFilter`], for predicted samples.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NibFilterState {
    /// Horizontal position channel.
    pub x: OneEuroState,
    /// Vertical position channel.
    pub y: OneEuroState,
    /// Pressure channel.
    pub pressure: OneEuroState,
    /// The raw sample before the last one, for the next velocity.
    pub previous: Option<NibPoint>,
}

/// The one filter state the pen path owns: position *and* pressure.
///
/// The two position channels keep their own state but share one cutoff, taken
/// from the pen's speed across the page.
#[derive(Clone, Debug)]
pub struct NibFilter {
    x: OneEuroFilter,
    y: OneEuroFilter,
    pressure: OneEuroFilter,
    previous: Option<NibPoint>,
}

impl NibFilter {
    /// `position` is shared by both axes; `pressure` is its own channel.
    #[must_use]
    pub fn new(position: OneEuroOptions, pressure: OneEuroOptions) -> Self {
        Self {
            x: OneEuroFilter::new(position),
            y: OneEuroFilter::new(position),
            pressure: OneEuroFilter::new(pressure),
            previous: None,
        }
    }

    /// Start a new stroke: no state carries over from the last one.
    pub fn reset(&mut self) {
        self.x.reset();
        self.y.reset();
        self.pressure.reset();
        self.previous = None;
    }

    /// Snapshot the state so predicted samples can be filtered then forgotten.
    #[must_use]
    pub fn save(&self) -> NibFilterState {
        NibFilterState {
            x: self.x.save(),
            y: self.y.save(),
            pressure: self.pressure.save(),
            previous: self.previous,
        }
    }

    /// Put back a state from [`Self::save`], replacing the current one.
    pub fn restore(&mut self, state: NibFilterState) {
        self.x.restore(state.x);
        self.y.restore(state.y);
        self.pressure.restore(state.pressure);
        self.previous = state.previous;
    }

    /// The speed the filter saw, in 0.1 mm per ms, from the *raw* samples.
    #[must_use]
    pub fn velocity_between(previous: Option<NibPoint>, sample: NibSample) -> f64 {
        let Some(previous) = previous else {
            return 0.0;
        };
        let dt = sample.t - previous.t;
        if !(dt > 0.0) {
            return 0.0;
        }
        hypot(sample.x - previous.x, sample.y - previous.y) / dt
    }

    /// Filter one sample. A device that does not report pressure has its pressure
    /// passed through untouched; a lift (pressure `0` after a reported value)
    /// tapers from the last pressure.
    pub fn filter(&mut self, sample: NibSample) -> FilteredNibSample {
        let velocity = Self::velocity_between(self.previous, sample);
        let reports =
            sample.pressure.is_finite() && sample.pressure > 0.0 && sample.pressure != 0.5;
        let lifted = !reports && sample.pressure == 0.0 && self.pressure.last().is_some();
        let pressure = if reports {
            self.pressure.filter(sample.pressure, sample.t)
        } else if lifted {
            self.pressure.last().unwrap_or(0.0) * 0.6
        } else {
            sample.pressure
        };
        // One cutoff for both axes, from the pen's speed along the page.
        let dt_x = self.x.observe(sample.x, sample.t);
        let dt_y = self.y.observe(sample.y, sample.t);
        let speed = hypot(self.x.speed(), self.y.speed());
        let x = match dt_x {
            None => self.x.last().unwrap_or(sample.x),
            Some(dt) => self.x.settle(sample.x, dt, speed),
        };
        let y = match dt_y {
            None => self.y.last().unwrap_or(sample.y),
            Some(dt) => self.y.settle(sample.y, dt, speed),
        };
        self.previous = Some(NibPoint {
            x: sample.x,
            y: sample.y,
            t: sample.t,
        });
        FilteredNibSample {
            x,
            y,
            pressure,
            velocity,
            t: sample.t,
        }
    }

    /// The filter's own speed estimate, for diagnostics.
    #[must_use]
    pub fn speed(&self) -> f64 {
        hypot(self.x.speed(), self.y.speed())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FilteredNibSample, NibFilter, NibSample, OneEuroFilter, OneEuroOptions, one_euro_alpha,
        position_options, pressure_options,
    };

    const POSITION: OneEuroOptions = OneEuroOptions {
        min_cutoff: 1.0,
        beta: 30.0,
        derivative_cutoff: 3.0,
    };
    const PRESSURE: OneEuroOptions = OneEuroOptions {
        min_cutoff: 5.0,
        beta: 2.0,
        derivative_cutoff: 3.0,
    };

    #[test]
    fn tuned_channels_are_read_from_one_source() {
        assert_eq!(position_options(), POSITION);
        assert_eq!(pressure_options(), PRESSURE);
    }

    /// Feed a channel values `step` ms apart, as a 120 Hz pen would at 8.
    fn run(filter: &mut OneEuroFilter, values: &[f64], step: f64) -> Vec<f64> {
        values
            .iter()
            .enumerate()
            .map(|(i, &value)| filter.filter(value, i as f64 * step))
            .collect()
    }

    /// Mean second difference: the roughness a low-pass reduces.
    fn roughness(series: &[f64]) -> f64 {
        let mut total = 0.0;
        for i in 2..series.len() {
            total += (series[i] - 2.0 * series[i - 1] + series[i - 2]).abs();
        }
        total / (series.len() - 2) as f64
    }

    fn sample(x: f64, y: f64, pressure: f64, t: f64) -> NibSample {
        NibSample { x, y, pressure, t }
    }

    #[test]
    fn the_smoothing_factor_rises_with_the_cutoff_and_never_exceeds_one() {
        assert!(one_euro_alpha(1000.0, 8.0) > 0.97);
        assert!(one_euro_alpha(1.0, 8.0) < one_euro_alpha(10.0, 8.0));
        assert!(one_euro_alpha(1.0, 0.0) < 1.0);
        assert!(one_euro_alpha(1.0, 8.0) < 0.1);
    }

    #[test]
    fn a_jittery_pressure_ramp_is_smoothed_its_roughness_collapses() {
        let mut filter = OneEuroFilter::new(PRESSURE);
        let ramp: Vec<f64> = (0..60).map(|i| 0.3 + i as f64 * 0.01).collect();
        let noisy: Vec<f64> = ramp
            .iter()
            .enumerate()
            .map(|(i, v)| v + if i % 2 == 0 { 0.05 } else { -0.05 })
            .collect();
        let filtered = run(&mut filter, &noisy, 8.0);
        assert!(roughness(&filtered) < roughness(&noisy) / 4.0);
        let last = *filtered.last().unwrap();
        let max_raw = noisy.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        assert!(
            last > 0.8 && last <= max_raw,
            "the ramp came through, ending at {last}"
        );
    }

    #[test]
    fn a_deliberate_step_in_pressure_is_not_over_damped_it_arrives() {
        let mut filter = OneEuroFilter::new(PRESSURE);
        let mut values = vec![0.2; 10];
        values.extend(std::iter::repeat_n(0.9, 30));
        let filtered = run(&mut filter, &values, 8.0);
        assert!(*filtered.last().unwrap() > 0.88);
        assert!(filtered[9] < 0.35);
    }

    #[test]
    fn a_slow_staircased_position_is_smoothed_into_a_line() {
        let staircase = [
            0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 10.0, 10.0, 10.0, 10.0, 20.0, 20.0, 20.0, 20.0, 20.0,
            30.0, 30.0, 30.0, 30.0, 30.0,
        ];
        let mut filter = OneEuroFilter::new(POSITION);
        let filtered = run(&mut filter, &staircase, 40.0);
        assert!(roughness(&filtered) < roughness(&staircase));
        let worst = filtered
            .iter()
            .enumerate()
            .map(|(i, v)| (v - staircase[i]).abs())
            .fold(0.0, f64::max);
        assert!(worst < 8.0, "never a whole tread behind: {worst}");
        assert!(
            filtered
                .iter()
                .enumerate()
                .any(|(i, v)| (v - staircase[i]).abs() > 0.5)
        );
        for i in 1..filtered.len() {
            assert!(
                filtered[i] >= filtered[i - 1] - 1e-9,
                "a monotone drag stays monotone"
            );
        }
        let end = *filtered.last().unwrap();
        assert!(end > 27.0 && end <= 30.0, "ended at {end}");
    }

    #[test]
    fn a_fast_straight_sweep_is_not_dragged_behind_the_pen() {
        let sweep: Vec<f64> = (0..40).map(|i| i as f64 * 40.0).collect();
        let mut filter = OneEuroFilter::new(POSITION);
        let filtered = run(&mut filter, &sweep, 8.0);
        for i in 20..sweep.len() {
            let lag = sweep[i] - filtered[i];
            assert!(lag < 8.0, "sample {i} lagged {lag} units of a 40-unit step");
        }
    }

    #[test]
    fn the_first_sample_of_a_stroke_passes_through_untouched() {
        let mut filter = OneEuroFilter::new(POSITION);
        assert_eq!(filter.filter(1200.0, 1000.0), 1200.0);
        assert_eq!(filter.last(), Some(1200.0));
        filter.reset();
        assert_eq!(filter.last(), None);
    }

    #[test]
    fn two_samples_with_the_same_timestamp_do_not_poison_the_filter() {
        let mut filter = OneEuroFilter::new(POSITION);
        let _ = filter.filter(10.0, 100.0);
        let _ = filter.filter(12.0, 108.0);
        let held = filter.last();
        assert_eq!(filter.filter(20.0, 108.0), held.unwrap());
        assert!(filter.filter(30.0, 116.0).is_finite());
    }

    #[test]
    fn the_nib_filter_reports_the_raw_speed_which_is_what_the_taper_reads() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let first = nib.filter(sample(0.0, 0.0, 0.7, 0.0));
        assert_eq!(first.velocity, 0.0);
        let second = nib.filter(sample(30.0, 40.0, 0.7, 10.0));
        assert_eq!(second.velocity, 5.0);
        nib.reset();
        assert_eq!(nib.filter(sample(0.0, 0.0, 0.7, 0.0)).velocity, 0.0);
    }

    #[test]
    fn a_device_that_reports_no_pressure_has_its_pressure_left_alone() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let none = nib.filter(sample(0.0, 0.0, 0.0, 0.0));
        assert_eq!(none.pressure, 0.0);
        let mouse = nib.filter(sample(10.0, 0.0, 0.5, 8.0));
        assert_eq!(mouse.pressure, 0.5);
        nib.reset();
        assert_eq!(nib.filter(sample(0.0, 0.0, 0.2, 0.0)).pressure, 0.2);
        let press = nib.filter(sample(10.0, 0.0, 0.9, 8.0));
        assert!(press.pressure > 0.2 && press.pressure < 0.9);
    }

    #[test]
    fn position_and_pressure_are_filtered_as_one_state() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let out = nib.filter(sample(100.0, 200.0, 0.6, 0.0));
        assert_eq!((out.x, out.y, out.pressure), (100.0, 200.0, 0.6));
        assert!(nib.speed() >= 0.0);
    }

    #[test]
    fn a_sharp_corner_drawn_at_speed_keeps_its_apex_both_axes_share_one_cutoff() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let step = 5.4;
        let mut samples: Vec<FilteredNibSample> = Vec::new();
        for i in 0..=50 {
            let f = i as f64;
            let (x, y) = if i <= 25 {
                (f * step, -f * step)
            } else {
                (f * step, -(50.0 - f) * step)
            };
            samples.push(nib.filter(sample(x, y, 0.5, f * 6.0)));
        }
        let apex = samples[25];
        let later = samples[29];
        let dx = later.x - apex.x;
        let dy = later.y - apex.y;
        assert!(dx > 0.0 && dy > 0.0, "after the apex: dx={dx} dy={dy}");
        assert!(
            dy / dx > 0.6,
            "descending edge near 45 degrees, got {}",
            dy / dx
        );
    }

    #[test]
    fn a_pen_up_that_reports_pressure_zero_tapers_from_the_last_pressure() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let mut last = 0.0;
        for i in 0..10 {
            last = nib
                .filter(sample(i as f64 * 5.0, 0.0, 0.25, i as f64 * 8.0))
                .pressure;
        }
        let lift = nib.filter(sample(50.0, 0.0, 0.0, 80.0));
        assert!(lift.pressure > 0.0);
        assert!(lift.pressure < last);
    }

    #[test]
    fn save_and_restore_roll_back_to_the_snapshot() {
        let mut nib = NibFilter::new(POSITION, PRESSURE);
        let _ = nib.filter(sample(0.0, 0.0, 0.5, 0.0));
        let snapshot = nib.save();
        let before = nib.filter(sample(10.0, 0.0, 0.5, 8.0));
        let _ = nib.filter(sample(500.0, 0.0, 0.5, 16.0));
        nib.restore(snapshot);
        assert_eq!(nib.filter(sample(10.0, 0.0, 0.5, 8.0)), before);
    }
}
