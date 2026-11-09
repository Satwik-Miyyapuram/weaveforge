//! ShareJS "text" ops, the format Overleaf's editor speaks. Port of
//! `apps/web/src/features/overleaf/domain/text-ot.ts`. Pure.
//!
//! Positions count UTF-16 code units, as JavaScript strings and CodeMirror do.
//! Comments change no text and pass through transforms.

use serde::{Deserialize, Serialize};

use crate::search::js_text::utf16_len;

/// One component of an op: an insert, a delete, or a comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum TextComponent {
    /// Insert `i` at UTF-16 position `p`.
    Insert {
        /// UTF-16 position.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        p: usize,
        /// Text to insert.
        i: String,
    },
    /// Delete `d` starting at UTF-16 position `p`.
    Delete {
        /// UTF-16 position.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        p: usize,
        /// Text expected at `p`, and removed.
        d: String,
    },
    /// A comment at `p`: changes no text.
    Comment {
        /// UTF-16 position.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        p: usize,
        /// Comment body.
        c: String,
        /// Optional thread id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        t: Option<String>,
    },
}

/// An op: components applied in order.
pub type TextOp = Vec<TextComponent>;

/// Which side wins a tie between two inserts at one spot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

/// `text` with `op` applied. Errors when a delete does not match the text it removes,
/// or an insert lies past the end.
///
/// # Errors
///
/// The message the TS port throws: "Insert past the end ..." or "Delete does not match ...".
pub fn apply_op(text: &str, op: &[TextComponent]) -> Result<String, String> {
    let mut out: Vec<u16> = text.encode_utf16().collect();
    for c in op {
        match c {
            TextComponent::Insert { p, i } => {
                if *p > out.len() {
                    return Err("Insert past the end of the document.".to_owned());
                }
                let _ = out.splice(*p..*p, i.encode_utf16());
            }
            TextComponent::Delete { p, d } => {
                // JS `slice` clamps both ends, so an empty delete past the end is a no-op.
                let units: Vec<u16> = d.encode_utf16().collect();
                let start = (*p).min(out.len());
                let end = (p + units.len()).min(out.len());
                if out[start..end] != units[..] {
                    return Err("Delete does not match the document.".to_owned());
                }
                let _ = out.drain(start..end);
            }
            TextComponent::Comment { .. } => {}
        }
    }
    Ok(String::from_utf16_lossy(&out))
}

/// Substring by UTF-16 positions, clamped as JS `slice` clamps.
fn slice16(s: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    let end = end.min(units.len());
    let start = start.min(end);
    String::from_utf16_lossy(&units[start..end])
}

fn append(dest: &mut Vec<TextComponent>, c: TextComponent) {
    match &c {
        TextComponent::Insert { i, .. } if i.is_empty() => return,
        TextComponent::Delete { d, .. } if d.is_empty() => return,
        _ => {}
    }
    dest.push(c);
}

/// Where `pos` moves to after `c`; `insert_after` puts it after an insert at the same spot.
fn transform_position(pos: usize, c: &TextComponent, insert_after: bool) -> usize {
    match c {
        TextComponent::Insert { p, i } => {
            if *p < pos || (*p == pos && insert_after) {
                pos + utf16_len(i)
            } else {
                pos
            }
        }
        TextComponent::Delete { p, d } => {
            let len = utf16_len(d);
            if pos <= *p {
                pos
            } else if pos <= p + len {
                *p
            } else {
                pos - len
            }
        }
        TextComponent::Comment { .. } => pos,
    }
}

/// Our delete `c` (at `p`, text `d`) rewritten after the other side's delete `od` at `op`.
fn transform_delete_over_delete(
    dest: &mut Vec<TextComponent>,
    c: &TextComponent,
    other: &TextComponent,
    p: usize,
    d: &str,
    op: usize,
    od: &str,
) -> Result<(), String> {
    let cd_len = utf16_len(d);
    let od_len = utf16_len(od);
    if p >= op + od_len {
        append(
            dest,
            TextComponent::Delete {
                p: p - od_len,
                d: d.to_owned(),
            },
        );
    } else if p + cd_len <= op {
        append(dest, c.clone());
    } else {
        let mut kept = String::new();
        if p < op {
            kept = slice16(d, 0, op - p);
        }
        if p + cd_len > op + od_len {
            kept.push_str(&slice16(d, op + od_len - p, cd_len));
        }
        let start = p.max(op);
        let end = (p + cd_len).min(op + od_len);
        if slice16(d, start - p, end - p) != slice16(od, start - op, end - op) {
            return Err("Overlapping deletes do not match.".to_owned());
        }
        let np = transform_position(p, other, false);
        append(dest, TextComponent::Delete { p: np, d: kept });
    }
    Ok(())
}

/// `c` rewritten to apply after `other`; `side` breaks ties between inserts at one spot.
fn transform_component(
    dest: &mut Vec<TextComponent>,
    c: &TextComponent,
    other: &TextComponent,
    side: Side,
) -> Result<(), String> {
    match c {
        TextComponent::Insert { p, i } => {
            let np = transform_position(*p, other, side == Side::Right);
            append(
                dest,
                TextComponent::Insert {
                    p: np,
                    i: i.clone(),
                },
            );
        }
        TextComponent::Delete { p, d } => match other {
            TextComponent::Insert { p: op, i: oi } => {
                let mut s = d.clone();
                if *p < *op {
                    let cut = op - p;
                    append(
                        dest,
                        TextComponent::Delete {
                            p: *p,
                            d: slice16(d, 0, cut),
                        },
                    );
                    s = slice16(d, cut, utf16_len(d));
                }
                append(
                    dest,
                    TextComponent::Delete {
                        p: p + utf16_len(oi),
                        d: s,
                    },
                );
            }
            TextComponent::Delete { p: op, d: od } => {
                transform_delete_over_delete(dest, c, other, *p, d, *op, od)?;
            }
            TextComponent::Comment { .. } => dest.push(c.clone()),
        },
        TextComponent::Comment { p, c: body, t } => {
            let np = transform_position(*p, other, false);
            dest.push(TextComponent::Comment {
                p: np,
                c: body.clone(),
                t: t.clone(),
            });
        }
    }
    Ok(())
}

/// Both ops rewritten so each applies after the other: `left` is ours, `right` the one the
/// server applied first. At one spot ours goes first, as on the server.
///
/// # Errors
///
/// "Overlapping deletes do not match." when two deletes of one span disagree.
pub fn transform_x(
    left: &[TextComponent],
    right: &[TextComponent],
) -> Result<(TextOp, TextOp), String> {
    let mut left_op: TextOp = left.to_vec();
    let mut new_right: TextOp = Vec::new();
    for rc in right {
        let mut right_component = Some(rc.clone());
        let mut new_left: TextOp = Vec::new();
        let mut k = 0;
        while k < left_op.len() {
            let Some(rcomp) = right_component.take() else {
                break;
            };
            let lcomp = left_op[k].clone();
            let mut next: TextOp = Vec::new();
            transform_component(&mut new_left, &lcomp, &rcomp, Side::Left)?;
            transform_component(&mut next, &rcomp, &lcomp, Side::Right)?;
            k += 1;
            match next.len() {
                0 => {
                    for l in &left_op[k..] {
                        append(&mut new_left, l.clone());
                    }
                }
                1 => right_component = next.pop(),
                _ => {
                    let (l2, r2) = transform_x(&left_op[k..], &next)?;
                    for l in l2 {
                        append(&mut new_left, l);
                    }
                    for r in r2 {
                        append(&mut new_right, r);
                    }
                    k = left_op.len();
                }
            }
        }
        if let Some(rc) = right_component {
            append(&mut new_right, rc);
        }
        left_op = new_left;
    }
    Ok((left_op, new_right))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ins(p: usize, i: &str) -> TextComponent {
        TextComponent::Insert { p, i: i.to_owned() }
    }

    fn del(p: usize, d: &str) -> TextComponent {
        TextComponent::Delete { p, d: d.to_owned() }
    }

    /// Both orders must end with the same text.
    fn converges(doc: &str, ours: &[TextComponent], theirs: &[TextComponent]) -> String {
        let (ours_after, theirs_after) = transform_x(ours, theirs).expect("transform");
        let here = apply_op(&apply_op(doc, ours).expect("ours"), &theirs_after).expect("here");
        let there = apply_op(&apply_op(doc, theirs).expect("theirs"), &ours_after).expect("there");
        assert_eq!(here, there);
        here
    }

    #[test]
    fn inserts_and_deletes_apply_in_order() {
        assert_eq!(
            apply_op("hello", &[ins(5, " world"), del(0, "h"), ins(0, "H")]).unwrap(),
            "Hello world"
        );
    }

    #[test]
    fn a_delete_that_does_not_match_the_text_errors() {
        let err = apply_op("abc", &[del(1, "x")]).unwrap_err();
        assert!(err.contains("does not match"));
        let err = apply_op("abc", &[ins(4, "x")]).unwrap_err();
        assert!(err.contains("past the end"));
    }

    #[test]
    fn comments_change_no_text() {
        let c = TextComponent::Comment {
            p: 1,
            c: "b".to_owned(),
            t: Some("t1".to_owned()),
        };
        assert_eq!(apply_op("abc", &[c]).unwrap(), "abc");
    }

    #[test]
    fn two_inserts_at_one_spot_put_ours_first_as_the_server_does() {
        assert_eq!(converges("ab", &[ins(1, "X")], &[ins(1, "Y")]), "aXYb");
    }

    #[test]
    fn an_insert_inside_a_remote_delete_survives() {
        assert_eq!(
            converges("abcdef", &[ins(3, "X")], &[del(1, "bcde")]),
            "aXf"
        );
    }

    #[test]
    fn overlapping_deletes_remove_the_text_once() {
        assert_eq!(
            converges("abcdef", &[del(1, "bcd")], &[del(2, "cde")]),
            "af"
        );
    }

    #[test]
    fn a_delete_split_by_a_remote_insert_keeps_the_insert() {
        assert_eq!(
            converges("abcdef", &[del(1, "bcde")], &[ins(3, "X")]),
            "aXf"
        );
    }

    #[test]
    fn multi_component_ops_converge() {
        assert_eq!(
            converges(
                "the quick brown fox",
                &[del(4, "quick "), ins(0, ">")],
                &[del(10, "brown"), ins(10, "red")],
            ),
            ">the red fox"
        );
    }

    #[test]
    fn utf16_positions_keep_surrogate_pairs_whole() {
        assert_eq!(
            converges("a\u{1F600}b", &[ins(3, "X")], &[ins(0, "Y")]),
            "Ya\u{1F600}Xb"
        );
    }

    /// A tiny seeded PRNG so failures reproduce.
    struct Rng(u32);

    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            f64::from(self.0) / 4_294_967_296.0
        }

        // `next()` is in [0, 1), so the floored product is a whole number in [0, n).
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        fn below(&mut self, n: usize) -> usize {
            (self.next() * n as f64).floor() as usize
        }
    }

    fn random_op(doc: &str, rng: &mut Rng) -> TextOp {
        let mut op = Vec::new();
        let mut text = doc.to_owned();
        let count = 1 + rng.below(3);
        for _ in 0..count {
            let p = rng.below(text.len() + 1);
            let insert = rng.next() < 0.5 || text.len() == p;
            if insert {
                let i = &"xyz"[..1 + rng.below(3)];
                op.push(ins(p, i));
                text.insert_str(p, i);
            } else {
                let end = (p + 1 + rng.below(4)).min(text.len());
                let d = text[p..end].to_owned();
                op.push(del(p, &d));
                text.replace_range(p..end, "");
            }
        }
        op
    }

    #[test]
    fn random_concurrent_edits_converge() {
        let mut rng = Rng(42);
        for _ in 0..2000 {
            let len = rng.below(11);
            let doc = &"abcdefghij"[..len];
            let ours = random_op(doc, &mut rng);
            let theirs = random_op(doc, &mut rng);
            let _ = converges(doc, &ours, &theirs);
        }
    }
}
