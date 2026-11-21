//! Laws for metric CSV chunks (`wf_core::metric_csv`): `run,step,metric,value,time`.

use proptest::prelude::*;
use wf_core::metric_csv::{CsvMetric, HEADER, decode, encode, merge_chunks, metric_names};

fn row(run: &str, step: f64, metric: &str, value: f64, time: Option<&str>) -> CsvMetric {
    CsvMetric {
        run: run.to_owned(),
        step,
        metric: metric.to_owned(),
        value,
        time: time.map(str::to_owned),
    }
}

fn any_row() -> impl Strategy<Value = CsvMetric> {
    (
        "[a-z0-9,\" \n-]{1,8}",
        -1_000_000i64..1_000_000,
        "[ -~\u{e4}\n\r]{1,12}",
        any::<f64>().prop_filter("finite", |v| v.is_finite()),
        prop::option::of("[0-9TZ:.-]{1,24}"),
    )
        .prop_map(|(run, step, metric, value, time)| CsvMetric {
            run,
            #[allow(clippy::cast_precision_loss)]
            step: step as f64,
            metric,
            value,
            time,
        })
}

proptest! {
    /// Law: decode(encode(rows)) == rows, whatever the names hold
    /// (commas, quotes, line breaks).
    #[test]
    fn csv_round_trip(rows in prop::collection::vec(any_row(), 0..40)) {
        prop_assert_eq!(decode(&encode(&rows)), Ok(rows));
    }

    /// Law: merging is idempotent and does not depend on chunk order.
    #[test]
    fn merge_is_idempotent_and_order_free(
        a in prop::collection::vec(any_row(), 0..20),
        b in prop::collection::vec(any_row(), 0..20),
    ) {
        let ab = merge_chunks(&[a.clone(), b.clone()]);
        let ba = merge_chunks(&[b.clone(), a.clone()]);
        prop_assert_eq!(&ab, &ba);
        let again = merge_chunks(&[ab.clone(), a, b]);
        prop_assert_eq!(&again, &ab);
        let mut keys: Vec<_> = ab.iter().map(|r| (r.run.clone(), r.step.to_bits(), r.metric.clone())).collect();
        let n = keys.len();
        keys.dedup();
        prop_assert_eq!(keys.len(), n, "one row per (run, step, metric)");
    }
}

#[test]
fn metric_name_with_comma_quote() {
    let rows = vec![row(
        "r1",
        1.0,
        "loss, \"val\"",
        0.5,
        Some("2026-01-01T00:00:00Z"),
    )];
    let text = encode(&rows);
    assert_eq!(
        text,
        format!("{HEADER}\nr1,1,\"loss, \"\"val\"\"\",0.5,2026-01-01T00:00:00Z\n")
    );
    assert_eq!(decode(&text), Ok(rows));
}

#[test]
fn crlf_chunk_decodes() {
    let text = "run,step,metric,value,time\r\nr,2,acc,0.25,\r\n";
    assert_eq!(decode(text), Ok(vec![row("r", 2.0, "acc", 0.25, None)]));
}

#[test]
fn bad_rows_are_errors_not_guesses() {
    assert!(decode("run,step,metric,value,time\nr,x,acc,1,\n").is_err());
    assert!(decode("nope\n").is_err());
    assert!(decode("run,step,metric,value,time\nr,1,\"open,1,\n").is_err());
}

#[test]
fn metric_names_are_distinct_and_sorted() {
    let rows = vec![
        row("a", 1.0, "loss", 1.0, None),
        row("b", 1.0, "acc", 1.0, None),
        row("a", 2.0, "loss", 1.0, None),
    ];
    assert_eq!(metric_names(&rows), ["acc", "loss"]);
}
