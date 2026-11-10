//! Sidecar command-line parsing: the rules `parseArgs` in `apps/shell/sidecar/src/main.ts` applies.
//! Flags are read in order. A value flag takes the next argument even when that argument starts with `--`.
//! Paths come back exactly as given; the caller resolves them against its own working directory.

use serde::Serialize;

/// Flags that take one value. `--migrations` may repeat; every other value flag keeps its last value.
const VALUE_FLAGS: [&str; 8] = [
    "--data-dir",
    "--migrations",
    "--backups",
    "--migrate-from",
    "--artifacts",
    "--bridge",
    "--app-version",
    "--home-variant",
];

/// Parsed sidecar arguments, with paths as given on the command line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarArgsPlan {
    /// The `--data-dir` value. Required.
    pub data_dir: String,
    /// Every `--migrations` value, in order. At least one.
    pub migrations: Vec<String>,
    /// The `--backups` value. Required.
    pub backups_dir: String,
    /// The `--migrate-from` value, when given.
    pub migrate_from: Option<String>,
    /// The `--artifacts` value, when given.
    pub artifacts: Option<String>,
    /// The `--bridge` value, when given.
    pub bridge: Option<String>,
    /// The `--app-version` value, when given.
    pub app_version: Option<String>,
    /// The `--home-variant` value, when given.
    pub home_variant: Option<String>,
    /// True when `--no-local-api` was passed.
    pub no_local_api: bool,
}

/// Outcome of parsing: a plan, or the message `main.ts` prints after `weaveforge-sidecar: `.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SidecarArgsReply {
    /// Every required flag was present.
    Ok(SidecarArgsPlan),
    /// An argument was unknown, a value flag had no value, or a required flag was missing.
    Error {
        /// The message to print.
        message: String,
    },
}

/// Parse the sidecar's argv (without the program name) into a plan or an error message.
#[must_use]
pub fn parse_sidecar_args(argv: &[String]) -> SidecarArgsReply {
    match parse(argv) {
        Ok(plan) => SidecarArgsReply::Ok(plan),
        Err(message) => SidecarArgsReply::Error { message },
    }
}

fn parse(argv: &[String]) -> Result<SidecarArgsPlan, String> {
    let mut data_dir: Option<String> = None;
    let mut backups_dir: Option<String> = None;
    let mut migrate_from: Option<String> = None;
    let mut artifacts: Option<String> = None;
    let mut bridge: Option<String> = None;
    let mut app_version: Option<String> = None;
    let mut home_variant: Option<String> = None;
    let mut no_local_api = false;
    let mut migrations: Vec<String> = Vec::new();

    let mut i = 0;
    while i < argv.len() {
        let arg = argv[i].as_str();
        if arg == "--no-local-api" {
            no_local_api = true;
            i += 1;
            continue;
        }
        if !VALUE_FLAGS.contains(&arg) {
            return Err(format!("unknown argument: {arg}"));
        }
        let Some(value) = argv.get(i + 1).cloned() else {
            return Err(format!("{arg} needs a value"));
        };
        match arg {
            "--data-dir" => data_dir = Some(value),
            "--backups" => backups_dir = Some(value),
            "--migrate-from" => migrate_from = Some(value),
            "--artifacts" => artifacts = Some(value),
            "--bridge" => bridge = Some(value),
            "--app-version" => app_version = Some(value),
            "--home-variant" => home_variant = Some(value),
            _ => migrations.push(value),
        }
        i += 2;
    }

    let data_dir = data_dir.ok_or_else(|| "missing --data-dir".to_owned())?;
    if migrations.is_empty() {
        return Err("missing --migrations".to_owned());
    }
    let backups_dir = backups_dir.ok_or_else(|| "missing --backups".to_owned())?;
    Ok(SidecarArgsPlan {
        data_dir,
        migrations,
        backups_dir,
        migrate_from,
        artifacts,
        bridge,
        app_version,
        home_variant,
        no_local_api,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn required_flags_and_repeated_migrations_parse() {
        let reply = parse_sidecar_args(&argv(&[
            "--data-dir",
            "d",
            "--backups",
            "b",
            "--migrations",
            "m1",
            "--migrations",
            "m2",
            "--no-local-api",
        ]));
        let SidecarArgsReply::Ok(plan) = reply else {
            panic!("expected a plan");
        };
        assert_eq!(plan.data_dir, "d");
        assert_eq!(plan.backups_dir, "b");
        assert_eq!(plan.migrations, vec!["m1".to_owned(), "m2".to_owned()]);
        assert!(plan.no_local_api);
        assert_eq!(plan.migrate_from, None);
    }

    #[test]
    fn optional_values_are_kept() {
        let reply = parse_sidecar_args(&argv(&[
            "--data-dir",
            "d",
            "--backups",
            "b",
            "--migrations",
            "m",
            "--migrate-from",
            "old",
            "--artifacts",
            "a",
            "--bridge",
            "br",
            "--app-version",
            "1.2",
            "--home-variant",
            "v",
        ]));
        let SidecarArgsReply::Ok(plan) = reply else {
            panic!("expected a plan");
        };
        assert_eq!(plan.migrate_from.as_deref(), Some("old"));
        assert_eq!(plan.artifacts.as_deref(), Some("a"));
        assert_eq!(plan.bridge.as_deref(), Some("br"));
        assert_eq!(plan.app_version.as_deref(), Some("1.2"));
        assert_eq!(plan.home_variant.as_deref(), Some("v"));
        assert!(!plan.no_local_api);
    }

    #[test]
    fn last_value_wins_for_single_flags() {
        let reply = parse_sidecar_args(&argv(&[
            "--data-dir",
            "first",
            "--data-dir",
            "second",
            "--backups",
            "b",
            "--migrations",
            "m",
        ]));
        let SidecarArgsReply::Ok(plan) = reply else {
            panic!("expected a plan");
        };
        assert_eq!(plan.data_dir, "second");
    }

    #[test]
    fn value_may_look_like_a_flag() {
        // `--data-dir` takes `--backups` as its value, so `b` is then an unknown argument.
        let reply = parse_sidecar_args(&argv(&[
            "--data-dir",
            "--backups",
            "b",
            "--migrations",
            "m",
        ]));
        assert_eq!(
            reply,
            SidecarArgsReply::Error {
                message: "unknown argument: b".to_owned()
            }
        );
    }

    #[test]
    fn unknown_flag_is_reported() {
        let reply = parse_sidecar_args(&argv(&["--nope"]));
        assert_eq!(
            reply,
            SidecarArgsReply::Error {
                message: "unknown argument: --nope".to_owned()
            }
        );
    }

    #[test]
    fn value_flag_without_value_is_reported() {
        let reply = parse_sidecar_args(&argv(&["--data-dir"]));
        assert_eq!(
            reply,
            SidecarArgsReply::Error {
                message: "--data-dir needs a value".to_owned()
            }
        );
    }

    #[test]
    fn missing_required_flags_are_reported_in_order() {
        let none = parse_sidecar_args(&argv(&[]));
        assert_eq!(
            none,
            SidecarArgsReply::Error {
                message: "missing --data-dir".to_owned()
            }
        );
        let no_migrations = parse_sidecar_args(&argv(&["--data-dir", "d", "--backups", "b"]));
        assert_eq!(
            no_migrations,
            SidecarArgsReply::Error {
                message: "missing --migrations".to_owned()
            }
        );
        let no_backups = parse_sidecar_args(&argv(&["--data-dir", "d", "--migrations", "m"]));
        assert_eq!(
            no_backups,
            SidecarArgsReply::Error {
                message: "missing --backups".to_owned()
            }
        );
    }

    #[test]
    fn error_reply_serializes_with_kind_tag() {
        let reply = SidecarArgsReply::Error {
            message: "missing --backups".to_owned(),
        };
        let json = serde_json::to_string(&reply).expect("serialize");
        assert_eq!(json, r#"{"kind":"error","message":"missing --backups"}"#);
    }
}
