//! JavaScript `Math` semantics where Rust's differ, so ink geometry matches
//! the TS copy bit for bit.

/// `Math.round`: nearest integer, ties toward +infinity, sign of zero kept.
#[must_use]
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x.is_sign_negative() {
        -0.0
    } else {
        r
    }
}

/// `Math.hypot(a, b)` as V8 computes it: scaled by the larger value with a
/// Kahan sum, so results match JS to the last bit.
#[must_use]
pub fn hypot(a: f64, b: f64) -> f64 {
    let (a, b) = (a.abs(), b.abs());
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let max = a.max(b);
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut comp = 0.0;
    for x in [a, b] {
        let n = x / max;
        let s = n * n - comp;
        let p = sum + s;
        comp = (p - sum) - s;
        sum = p;
    }
    sum.sqrt() * max
}

/// `Math.min(a, b)`: NaN wins, and -0 is smaller than +0.
#[must_use]
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() { a } else { b }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(a, b)`: NaN wins, and +0 is larger than -0.
#[must_use]
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() { b } else { a }
    } else if a > b {
        a
    } else {
        b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same(a: f64, b: f64) -> bool {
        a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
    }

    #[test]
    fn round_matches_js() {
        let cases = [
            (0.5, 1.0),
            (1.5, 2.0),
            (2.5, 3.0),
            (-0.5, -0.0),
            (-1.5, -1.0),
            (-2.5, -2.0),
            (-0.3, -0.0),
            (-0.0, -0.0),
            (0.0, 0.0),
            (0.49999999999999994, 0.0),
            (4503599627370495.5, 4503599627370496.0),
            (9007199254740993.0, 9007199254740992.0),
            (-7.6, -8.0),
        ];
        for (x, want) in cases {
            assert!(same(round(x), want), "round({x}) = {}", round(x));
        }
        assert!(round(f64::NAN).is_nan());
        assert_eq!(round(f64::INFINITY), f64::INFINITY);
        assert_eq!(round(f64::NEG_INFINITY), f64::NEG_INFINITY);
    }

    #[test]
    fn hypot_matches_js() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
        assert_eq!(hypot(-3.0, 0.0), 3.0);
        assert_eq!(hypot(f64::NAN, f64::INFINITY), f64::INFINITY);
        assert!(hypot(f64::NAN, 1.0).is_nan());
        assert_eq!(hypot(1.0, 1.0), std::f64::consts::SQRT_2);
    }

    #[test]
    fn min_max_match_js() {
        assert!(same(min(0.0, -0.0), -0.0));
        assert!(same(max(-0.0, 0.0), 0.0));
        assert!(min(f64::NAN, 1.0).is_nan());
        assert!(max(1.0, f64::NAN).is_nan());
        assert_eq!(min(2.0, 1.0), 1.0);
        assert_eq!(max(2.0, 1.0), 2.0);
    }
}
