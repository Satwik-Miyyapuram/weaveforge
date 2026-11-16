//! Graph-wide node colours, ported from
//! `apps/web/src/features/relations/application/node-colouring.ts`: the year and
//! link-count ramps, and label-propagation communities.

use std::collections::HashMap;

use super::graph_tags::utf16_cmp;

/// Ramp low end, pale sand `#e8d9b0`, as channel values.
const RAMP_LOW: [f64; 3] = [232.0, 217.0, 176.0];
/// Ramp high end, ink-blue `#2f4b6e`, as channel values.
const RAMP_HIGH: [f64; 3] = [47.0, 75.0, 110.0];

/// Label propagation runs at most this many rounds.
const MAX_ROUNDS: usize = 20;

/// A colour `t` of the way along the ramp. `t` is clamped to 0..=1; a non-finite
/// `t` counts as 0.
#[must_use]
pub fn ramp_colour(t: f64) -> String {
    let k = if t.is_finite() {
        t.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut out = String::from("#");
    for (lo, hi) in RAMP_LOW.iter().zip(RAMP_HIGH.iter()) {
        // JS Math.round: half rounds up. Channels are non-negative.
        // Clamped to 0..=255 before the cast; `k` is in 0..=1, so the channel is in range.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let channel = (lo + (hi - lo) * k + 0.5).floor().clamp(0.0, 255.0) as u8;
        out.push_str(&format!("{channel:02x}"));
    }
    out
}

/// Year → ramp position across the years present; one year sits mid-ramp.
/// Output is in input order.
#[must_use]
pub fn year_colours(years: &[(String, f64)]) -> Vec<(String, String)> {
    if years.is_empty() {
        return Vec::new();
    }
    let lo = years.iter().map(|(_, y)| *y).fold(f64::INFINITY, f64::min);
    let hi = years
        .iter()
        .map(|(_, y)| *y)
        .fold(f64::NEG_INFINITY, f64::max);
    years
        .iter()
        .map(|(id, y)| {
            let t = if hi == lo { 0.5 } else { (y - lo) / (hi - lo) };
            (id.clone(), ramp_colour(t))
        })
        .collect()
}

/// Link count → ramp position, square-root scaled so a few hubs do not pale the
/// rest. Output is in input order.
#[must_use]
pub fn degree_colours(degree: &[(String, f64)]) -> Vec<(String, String)> {
    let max = degree.iter().map(|(_, d)| *d).fold(0.0_f64, f64::max);
    degree
        .iter()
        .map(|(id, d)| {
            let t = if max == 0.0 {
                0.0
            } else {
                d.sqrt() / max.sqrt()
            };
            (id.clone(), ramp_colour(t))
        })
        .collect()
}

/// Communities by label propagation, deterministic: nodes go in id (UTF-16)
/// order and ties go to the smallest label. Returns node id → rank, 0 for the
/// biggest community, in id order. Nodes with no links get no entry.
#[must_use]
pub fn communities(ids: &[String], edges: &[(String, String)]) -> Vec<(String, u32)> {
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for (a, b) in edges {
        if a == b {
            continue;
        }
        adj.entry(a.as_str()).or_default().push(b.as_str());
        adj.entry(b.as_str()).or_default().push(a.as_str());
    }
    let mut order: Vec<&str> = ids
        .iter()
        .map(String::as_str)
        .filter(|id| adj.contains_key(id))
        .collect();
    order.sort_by(|a, b| utf16_cmp(a, b));

    // Labels in first-seen order, as the TS Map iterates.
    let mut label: HashMap<&str, &str> = HashMap::new();
    let mut label_order: Vec<&str> = Vec::new();
    for id in &order {
        if label.insert(id, id).is_none() {
            label_order.push(id);
        }
    }

    for _ in 0..MAX_ROUNDS {
        let mut changed = false;
        for id in &order {
            let mut counts: HashMap<&str, u32> = HashMap::new();
            for n in &adj[id] {
                if let Some(l) = label.get(n) {
                    *counts.entry(l).or_insert(0) += 1;
                }
            }
            let current = label[id];
            let mut best = current;
            let mut best_count = counts.get(current).copied().unwrap_or(0);
            for (l, c) in &counts {
                if *c > best_count || (*c == best_count && utf16_cmp(l, best).is_lt()) {
                    best = l;
                    best_count = *c;
                }
            }
            if best != current {
                let _ = label.insert(id, best);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    let mut size: HashMap<&str, u32> = HashMap::new();
    for id in &label_order {
        *size.entry(label[id]).or_insert(0) += 1;
    }
    let mut sized: Vec<(&str, u32)> = size.into_iter().collect();
    sized.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| utf16_cmp(a.0, b.0)));
    let rank: HashMap<&str, u32> = sized
        .iter()
        .enumerate()
        .map(|(i, (l, _))| (*l, u32::try_from(i).unwrap_or(u32::MAX)))
        .collect();

    label_order
        .iter()
        .map(|id| ((*id).to_owned(), rank[label[id]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &str) -> String {
        v.to_owned()
    }

    #[test]
    fn ramp_matches_js_rounding() {
        assert_eq!(ramp_colour(0.0), "#e8d9b0");
        assert_eq!(ramp_colour(1.0), "#2f4b6e");
        assert_eq!(ramp_colour(0.5), "#8c928f");
        assert_eq!(ramp_colour(-3.0), "#e8d9b0");
        assert_eq!(ramp_colour(9.0), "#2f4b6e");
        assert_eq!(ramp_colour(f64::NAN), "#e8d9b0");
        assert_eq!(ramp_colour(f64::INFINITY), "#e8d9b0");
    }

    #[test]
    fn year_one_value_mid_ramp() {
        let out = year_colours(&[(s("a"), 2020.0)]);
        assert_eq!(out, vec![(s("a"), s("#8c928f"))]);
        assert!(year_colours(&[]).is_empty());
    }

    #[test]
    fn degree_zero_max_is_low_end() {
        let out = degree_colours(&[(s("a"), 0.0)]);
        assert_eq!(out, vec![(s("a"), s("#e8d9b0"))]);
    }

    #[test]
    fn communities_split_two_triangles() {
        let ids: Vec<String> = ["a", "b", "c", "x", "y", "z", "lone"]
            .iter()
            .map(|v| s(v))
            .collect();
        let edges = vec![
            (s("a"), s("b")),
            (s("b"), s("c")),
            (s("a"), s("c")),
            (s("x"), s("y")),
            (s("y"), s("z")),
            (s("x"), s("z")),
            (s("a"), s("a")),
        ];
        let rank: HashMap<String, u32> = communities(&ids, &edges).into_iter().collect();
        assert_eq!(rank.get("a"), rank.get("b"));
        assert_eq!(rank.get("x"), rank.get("z"));
        assert_ne!(rank.get("a"), rank.get("x"));
        assert!(!rank.contains_key("lone"));
    }
}
