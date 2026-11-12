//! The pen's per-update sample decisions, batched. A port of the sample path of
//! `apps/web/src/features/ink/application/pen-capture-session.ts`: the
//! duplicate-sample drop, the timestamp fallback, the off-page drop, the 1-Euro
//! filter, and the predicted run that must not move the filter.
//!
//! The caller (the session) resolves the pointer, projects client coordinates to
//! page units (NaN when off the page) and writes one flat batch per pointer
//! update. The pointer gate, stroke ids, the trail and the sample writer stay in
//! TypeScript.

use super::one_euro::{position_options, pressure_options, NibFilter, NibFilterState, NibSample};

/// Values per raw sample: `x, y, pressure, t, timeStamp, flags`. A NaN `t` or
/// `timeStamp` is absent; a NaN `x` or `y` is a point off the page.
pub const RAW_STRIDE: usize = 6;

/// Values per output sample: `x, y, pressure, t, velocity`.
pub const OUT_STRIDE: usize = 5;

/// Raw flag: the sample is the stroke's first (`beginStroke`). Never de-duplicated.
pub const FLAG_FIRST: u32 = 1;
/// Raw and output flag: the sample is a prediction. It moves the filter but is
/// neither de-duplicated nor remembered as the last real sample.
pub const FLAG_PREDICTED: u32 = 2;
/// Raw and output flag: the sample is the dispatched event itself, not one merged
/// into it through `getCoalescedEvents()`.
pub const FLAG_DISPATCHED: u32 = 4;

/// One accepted, filtered sample, with the flags it arrived with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CaptureSample {
    /// Filtered horizontal position, in 0.1 mm.
    pub x: f64,
    /// Filtered vertical position, in 0.1 mm.
    pub y: f64,
    /// Filtered pressure.
    pub pressure: f64,
    /// Milliseconds.
    pub t: f64,
    /// Speed in 0.1 mm per ms, from the nib filter.
    pub velocity: f64,
    /// `FLAG_PREDICTED` and `FLAG_DISPATCHED` as they arrived.
    pub flags: u32,
}

/// The timestamp of a raw sample: `t` when finite, else `timeStamp` when finite,
/// else `now`. A platform event carries `timeStamp` rather than `t`, and a NaN
/// there would poison the filter's `dt` for every later sample.
#[must_use]
pub fn resolve_time(t: f64, time_stamp: f64, now: f64) -> f64 {
    if t.is_finite() {
        t
    } else if time_stamp.is_finite() {
        time_stamp
    } else {
        now
    }
}

/// The filter and the last real raw sample, carried across pointer updates.
#[derive(Clone, Debug)]
pub struct CaptureStream {
    filter: NibFilter,
    last: Option<LastRaw>,
}

#[derive(Clone, Copy, Debug)]
struct LastRaw {
    x: f64,
    y: f64,
    t: f64,
}

impl Default for CaptureStream {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureStream {
    /// A stream with the tuned pen channels and no sample remembered.
    #[must_use]
    pub fn new() -> Self {
        Self {
            filter: NibFilter::new(position_options(), pressure_options()),
            last: None,
        }
    }

    /// A new stroke: the filter starts clean (`beginStroke`, `abort`).
    pub fn reset_filter(&mut self) {
        self.filter.reset();
    }

    /// The stroke ended or was dropped: the next sample is never a repeat of this one.
    pub fn forget_last(&mut self) {
        self.last = None;
    }

    /// Filter one pointer update's raw samples, in order, and return what was
    /// accepted. A predicted run is filtered from the state the real samples left,
    /// and the filter returns to that state after it, so predictions never bend the
    /// stroke that follows.
    pub fn consume(&mut self, raw: &[f64], now: f64) -> Vec<CaptureSample> {
        let mut out = Vec::with_capacity(raw.len() / RAW_STRIDE);
        let mut saved: Option<NibFilterState> = None;
        for chunk in raw.chunks_exact(RAW_STRIDE) {
            let flags = chunk[5] as u32;
            let first = flags & FLAG_FIRST != 0;
            let predicted = flags & FLAG_PREDICTED != 0;
            if predicted {
                if saved.is_none() {
                    saved = Some(self.filter.save());
                }
            } else if let Some(state) = saved.take() {
                self.filter.restore(state);
            }
            let (x, y) = (chunk[0], chunk[1]);
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            let t = resolve_time(chunk[3], chunk[4], now);
            if !first && !predicted {
                if let Some(last) = self.last {
                    if last.t == t && last.x == x && last.y == y {
                        continue;
                    }
                }
            }
            if !predicted {
                self.last = Some(LastRaw { x, y, t });
            }
            let sample = self.filter.filter(NibSample {
                x,
                y,
                pressure: chunk[2],
                t,
            });
            out.push(CaptureSample {
                x: sample.x,
                y: sample.y,
                pressure: sample.pressure,
                t: sample.t,
                velocity: sample.velocity,
                flags: flags & (FLAG_PREDICTED | FLAG_DISPATCHED),
            });
        }
        if let Some(state) = saved {
            self.filter.restore(state);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One raw sample with no timeStamp and the given flags.
    fn raw(x: f64, y: f64, t: f64, flags: u32) -> [f64; RAW_STRIDE] {
        [x, y, 0.5, t, f64::NAN, f64::from(flags)]
    }

    fn flat(samples: &[[f64; RAW_STRIDE]]) -> Vec<f64> {
        samples.iter().flatten().copied().collect()
    }

    // it: "a coalesced event that carries timeStamp rather than t is not a NaN sample"
    #[test]
    fn a_coalesced_event_that_carries_time_stamp_rather_than_t_is_not_a_nan_sample() {
        let mut stream = CaptureStream::new();
        let sample = [10.0, 20.0, 0.5, f64::NAN, 500.0, 0.0];
        let out = stream.consume(&sample, 999.0);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].t, 500.0);
        assert!(out[0].x.is_finite() && out[0].y.is_finite());
    }

    #[test]
    fn a_sample_with_neither_t_nor_time_stamp_takes_now() {
        assert_eq!(resolve_time(f64::NAN, f64::NAN, 42.0), 42.0);
        assert_eq!(resolve_time(7.0, 9.0, 42.0), 7.0);
        assert_eq!(resolve_time(f64::NAN, 9.0, 42.0), 9.0);
    }

    // it: "the dispatched event is not counted twice when its coalesced list ends with it"
    #[test]
    fn the_dispatched_event_is_not_counted_twice_when_its_coalesced_list_ends_with_it() {
        let mut stream = CaptureStream::new();
        let batch = flat(&[
            raw(10.0, 10.0, 1.0, FLAG_FIRST),
            raw(20.0, 20.0, 2.0, 0),
            raw(20.0, 20.0, 2.0, FLAG_DISPATCHED),
        ]);
        let out = stream.consume(&batch, 0.0);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].flags & FLAG_DISPATCHED, 0);
    }

    // The repeat rule the pen-lift relies on: a repeated sample is never accepted.
    #[test]
    fn a_repeat_of_the_last_real_sample_is_dropped_across_updates() {
        let mut stream = CaptureStream::new();
        let first = flat(&[raw(10.0, 10.0, 1.0, FLAG_FIRST)]);
        assert_eq!(stream.consume(&first, 0.0).len(), 1);
        let again = flat(&[raw(10.0, 10.0, 1.0, FLAG_DISPATCHED)]);
        assert!(stream.consume(&again, 0.0).is_empty());
        stream.forget_last();
        assert_eq!(stream.consume(&again, 0.0).len(), 1);
    }

    // it: "a stroke that never leaves the page is never sent anywhere"
    #[test]
    fn a_point_off_the_page_is_never_accepted() {
        let mut stream = CaptureStream::new();
        let off = flat(&[raw(f64::NAN, 5.0, 1.0, FLAG_FIRST)]);
        assert!(stream.consume(&off, 0.0).is_empty());
    }

    // it: "predicted samples ride the live tail and are never part of the stroke"
    #[test]
    fn predicted_samples_are_flagged_and_not_remembered_as_real() {
        let mut stream = CaptureStream::new();
        let real = flat(&[raw(10.0, 10.0, 1.0, FLAG_FIRST)]);
        let _ = stream.consume(&real, 0.0);
        let predicted = flat(&[raw(10.0, 10.0, 1.0, FLAG_PREDICTED)]);
        let out = stream.consume(&predicted, 0.0);
        // A predicted sample with the same position and time is not a repeat.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].flags & FLAG_PREDICTED, FLAG_PREDICTED);
    }

    // it: "predicted samples do not bend the real stroke through the filter"
    #[test]
    fn predicted_samples_do_not_bend_the_real_stroke_through_the_filter() {
        let mut with = CaptureStream::new();
        let mut without = CaptureStream::new();
        let head = flat(&[
            raw(10.0, 10.0, 1.0, FLAG_FIRST),
            raw(12.0, 11.0, 2.0, 0),
        ]);
        let _ = with.consume(&head, 0.0);
        let _ = without.consume(&head, 0.0);

        let guess = flat(&[raw(400.0, 400.0, 3.0, FLAG_PREDICTED)]);
        let _ = with.consume(&guess, 0.0);

        let tail = flat(&[raw(14.0, 12.0, 3.0, 0)]);
        let a = with.consume(&tail, 0.0);
        let b = without.consume(&tail, 0.0);
        assert_eq!(a, b);
    }

    #[test]
    fn a_new_stroke_starts_from_a_clean_filter() {
        let mut stream = CaptureStream::new();
        let batch = flat(&[raw(10.0, 10.0, 1.0, FLAG_FIRST), raw(50.0, 50.0, 2.0, 0)]);
        let _ = stream.consume(&batch, 0.0);
        stream.reset_filter();
        stream.forget_last();
        let fresh = flat(&[raw(10.0, 10.0, 1.0, FLAG_FIRST)]);
        let mut clean = CaptureStream::new();
        assert_eq!(stream.consume(&fresh, 0.0), clean.consume(&fresh, 0.0));
    }

    #[test]
    fn an_empty_batch_accepts_nothing() {
        let mut stream = CaptureStream::new();
        assert!(stream.consume(&[], 0.0).is_empty());
    }
}
