//! Pure parts of the metric chart data, ported from `apps/web/src/features/experiments/ui/metric-chart-data.ts`:
//! the union step axis over overlaid runs, debiased EMA smoothing, and the decision of how tick
//! labels are rendered. Rendering the tick strings stays in TS, where `toFixed` and
//! `toExponential` define the output. Pure: no I/O.

use serde::{Deserialize, Serialize};

/// One point of a run: only its step and value are read.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChartPoint {
    /// The training step the point was logged at.
    pub step: f64,
    /// The logged value.
    pub value: f64,
}

/// A run to overlay on the chart (TS `MetricSeries`). Fields the alignment does not read are ignored.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChartSeries {
    /// The run's id.
    pub id: String,
    /// The legend label, when set. Without one the id's first eight characters are used.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub label: Option<String>,
    /// The series colour, when set.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// The run's points, in any order.
    pub points: Vec<ChartPoint>,
}

/// One run's values on the union step axis (TS `aligned` entry).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AlignedSeries {
    /// The run's id.
    pub id: String,
    /// The legend label.
    pub label: String,
    /// The series colour, when set; left out of the serialized object otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// One value per step on the axis; `None` where the run has no point.
    pub values: Vec<Option<f64>>,
}

/// The union step axis and every run aligned to it (TS `alignSeries` result).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AlignedChart {
    /// The union of every run's steps, ascending.
    pub steps: Vec<f64>,
    /// Each run, in input order.
    pub aligned: Vec<AlignedSeries>,
}

/// How tick labels are rendered (TS `formatTicks` applies it with `toFixed` or `toExponential`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TickFormat {
    /// No finite value to format: each value is shown as its plain string.
    Plain,
    /// Values too large or too small for fixed decimals: one exponent style.
    Exponential,
    /// Fixed decimals, the fewest (at most six) that show every tick exactly.
    Fixed {
        /// The number of decimals.
        digits: u32,
    },
}

/// Overlay runs on one union step axis, gaps as `None` (TS `alignSeries`).
///
/// A run's points are ordered by step; where a step repeats, the later point wins.
#[must_use]
pub fn align_series(series: &[ChartSeries]) -> AlignedChart {
    let sorted: Vec<Vec<ChartPoint>> = series
        .iter()
        .map(|run| {
            let mut points = run.points.clone();
            points.sort_by(|a, b| a.step.total_cmp(&b.step));
            points
        })
        .collect();

    let mut steps: Vec<f64> = sorted.iter().flatten().map(|p| p.step).collect();
    steps.sort_by(f64::total_cmp);
    steps.dedup();

    let aligned = series
        .iter()
        .zip(&sorted)
        .map(|(run, points)| AlignedSeries {
            id: run.id.clone(),
            label: run
                .label
                .clone()
                .unwrap_or_else(|| run.id.chars().take(8).collect()),
            color: run.color.clone(),
            values: values_on_axis(&steps, points),
        })
        .collect();

    AlignedChart { steps, aligned }
}

/// A run's value at each step of the axis, walking both sorted lists once.
fn values_on_axis(steps: &[f64], points: &[ChartPoint]) -> Vec<Option<f64>> {
    let mut next = 0;
    steps
        .iter()
        .map(|&step| {
            while next < points.len() && points[next].step < step {
                next += 1;
            }
            let mut value = None;
            while next < points.len() && points[next].step == step {
                value = Some(points[next].value);
                next += 1;
            }
            value
        })
        .collect()
}

/// Debiased EMA over the non-gap values; gaps stay gaps (TS `emaSmooth`). An `alpha` at or below
/// zero returns the values unchanged.
#[must_use]
pub fn ema_smooth(values: &[Option<f64>], alpha: f64) -> Vec<Option<f64>> {
    if alpha <= 0.0 {
        return values.to_vec();
    }
    let mut acc = 0.0_f64;
    let mut n: i32 = 0;
    values
        .iter()
        .map(|slot| {
            let v = (*slot)?;
            acc = alpha * acc + (1.0 - alpha) * v;
            n += 1;
            Some(acc / (1.0 - alpha.powf(f64::from(n))))
        })
        .collect()
}

/// Which rendering the tick labels take: the fewest exact decimals, or an exponent style when the
/// values are too large or too small for fixed decimals (TS `formatTicks`).
#[must_use]
pub fn tick_format(values: &[f64]) -> TickFormat {
    let finite: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if finite.is_empty() {
        return TickFormat::Plain;
    }
    let abs: Vec<f64> = finite.iter().map(|v| v.abs()).collect();
    let nonzero: Vec<f64> = abs.iter().copied().filter(|v| *v > 0.0).collect();
    if abs.iter().any(|v| *v >= 1e6) || (!nonzero.is_empty() && nonzero.iter().all(|v| *v < 1e-4)) {
        return TickFormat::Exponential;
    }
    for digits in 0..=6_u32 {
        if finite.iter().all(|v| is_exact_at(*v, digits)) {
            return TickFormat::Fixed { digits };
        }
    }
    TickFormat::Fixed { digits: 6 }
}

/// Whether `v` rounded to `digits` decimals reads back as `v`, within a relative tolerance.
fn is_exact_at(v: f64, digits: u32) -> bool {
    let Ok(rounded) = format!("{:.*}", digits as usize, v).parse::<f64>() else {
        return false;
    };
    (rounded - v).abs() <= 1e-9 * 1.0_f64.max(v.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, points: &[(f64, f64)]) -> ChartSeries {
        ChartSeries {
            id: id.to_owned(),
            label: None,
            color: None,
            points: points
                .iter()
                .map(|&(step, value)| ChartPoint { step, value })
                .collect(),
        }
    }

    #[test]
    fn union_axis_puts_every_run_on_it_with_gaps_as_none() {
        let chart = align_series(&[
            run("a", &[(2.0, 20.0), (0.0, 0.0)]),
            run("b", &[(1.0, 10.0)]),
        ]);
        assert_eq!(chart.steps, vec![0.0, 1.0, 2.0]);
        assert_eq!(chart.aligned[0].values, vec![Some(0.0), None, Some(20.0)]);
        assert_eq!(chart.aligned[1].values, vec![None, Some(10.0), None]);
    }

    #[test]
    fn label_defaults_to_first_eight_characters_of_the_id() {
        let chart = align_series(&[run("0123456789abcdef", &[])]);
        assert_eq!(chart.aligned[0].label, "01234567");
    }

    #[test]
    fn no_runs_is_an_empty_axis() {
        assert_eq!(
            align_series(&[]),
            AlignedChart {
                steps: vec![],
                aligned: vec![],
            }
        );
    }

    #[test]
    fn duplicate_step_keeps_the_later_point() {
        let chart = align_series(&[run("a", &[(1.0, 1.0), (1.0, 2.0)])]);
        assert_eq!(chart.aligned[0].values, vec![Some(2.0)]);
    }

    #[test]
    fn ema_keeps_gaps_and_leaves_the_first_value_unbiased() {
        let out = ema_smooth(&[Some(2.0), None, Some(4.0)], 0.5);
        assert_eq!(out[0], Some(2.0));
        assert_eq!(out[1], None);
        let expected = (0.5 * 2.0 * 0.5 + 0.5 * 4.0) / (1.0 - 0.25);
        assert!((out[2].unwrap_or(f64::NAN) - expected).abs() < 1e-12);
    }

    #[test]
    fn ema_with_no_smoothing_returns_the_values_unchanged() {
        let values = [Some(1.0), None, Some(3.0)];
        assert_eq!(ema_smooth(&values, 0.0), values.to_vec());
    }

    #[test]
    fn tick_format_picks_the_fewest_exact_decimals() {
        assert_eq!(
            tick_format(&[0.0, 0.5, 1.0, 1.5]),
            TickFormat::Fixed { digits: 1 }
        );
        assert_eq!(
            tick_format(&[0.0, 50.0, 100.0]),
            TickFormat::Fixed { digits: 0 }
        );
        assert_eq!(
            tick_format(&[0.25, 0.5, 0.75]),
            TickFormat::Fixed { digits: 2 }
        );
    }

    #[test]
    fn tick_format_uses_exponent_style_for_large_or_tiny_values() {
        assert_eq!(tick_format(&[0.0, 2e6, 4e6]), TickFormat::Exponential);
        assert_eq!(tick_format(&[1e-5, 2e-5]), TickFormat::Exponential);
    }

    #[test]
    fn tick_format_is_plain_when_nothing_is_finite() {
        assert_eq!(tick_format(&[f64::NAN]), TickFormat::Plain);
        assert_eq!(tick_format(&[]), TickFormat::Plain);
    }
}
