//! Copies of the native database, kept where losing its data dir cannot reach (step 5.3e).
//!
//! Same rules as the sidecar's `local-db-backup.ts`: a backup is taken only after a write, written
//! beside and renamed over (an interrupted one is a `.part` file the listing ignores), and pruned
//! to the newest few plus the newest of each recent day, so a run of bad backups cannot rotate out
//! the last good one. The files are `pg_dump` custom-format dumps named `local-pg-*.dump`, so they
//! never mix with PGlite's `local-db-*.tar.gz` in the same folder.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::PgError;

const PREFIX: &str = "local-pg-";
const SUFFIX: &str = ".dump";
/// How many of the newest to keep in each place.
pub const DEFAULT_KEEP: usize = 3;
/// Beyond those, the newest of this many most recent days.
pub const DAILY_KEEP: usize = 7;

/// The file a backup taken at `now` is named: UTC, sortable, legal everywhere.
#[must_use]
pub fn file_name(now: SystemTime) -> String {
    let ms = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let ms = i64::try_from(ms).unwrap_or(i64::MAX);
    let (y, mo, d) = civil_from_days(ms.div_euclid(86_400_000));
    let rem = ms.rem_euclid(86_400_000);
    let (h, mi, s, milli) = (
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1_000 % 60,
        rem % 1_000,
    );
    format!("{PREFIX}{y:04}-{mo:02}-{d:02}T{h:02}-{mi:02}-{s:02}-{milli:03}{SUFFIX}")
}

/// Howard Hinnant's `civil_from_days`: (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn is_backup(name: &str) -> bool {
    name.starts_with(PREFIX) && name.ends_with(SUFFIX)
}

/// The backups in `dir`, newest first; none for a folder that is not there.
#[must_use]
pub fn list(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| is_backup(n))
        .collect();
    names.sort_unstable_by(|a, b| b.cmp(a));
    names.into_iter().map(|n| dir.join(n)).collect()
}

/// Where backups go and how many are kept.
#[derive(Debug, Clone)]
pub struct Backups {
    /// The places, each made when missing.
    pub dirs: Vec<PathBuf>,
    /// How many of the newest to keep in each place.
    pub keep: usize,
    /// Beyond those, the newest of this many most recent days.
    pub daily_keep: usize,
}

impl Backups {
    /// Backups in `dirs`, with the default counts.
    #[must_use]
    pub fn new(dirs: Vec<PathBuf>) -> Self {
        Self {
            dirs,
            keep: DEFAULT_KEEP,
            daily_keep: DAILY_KEEP,
        }
    }

    /// Dumps once with `dump` (given the file to write) into the first place that works, copies
    /// that file to the other places, and prunes each. A place that fails is skipped.
    ///
    /// # Errors
    /// The first failure, when no place got a backup.
    pub async fn take<F, Fut>(&self, now: SystemTime, dump: F) -> Result<Vec<PathBuf>, PgError>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: Future<Output = Result<(), PgError>>,
    {
        let name = file_name(now);
        let mut dump = Some(dump);
        let mut written: Vec<PathBuf> = Vec::new();
        let mut first_err: Option<PgError> = None;
        for dir in &self.dirs {
            let file = dir.join(&name);
            let part = dir.join(format!("{name}.part"));
            let made = match std::fs::create_dir_all(dir) {
                Err(e) => Err(PgError::local(e.to_string())),
                Ok(()) => match (written.first(), dump.take()) {
                    (Some(first), _) => std::fs::copy(first, &part)
                        .map(|_| ())
                        .map_err(|e| PgError::local(e.to_string())),
                    (None, Some(dump)) => dump(part.clone()).await,
                    (None, None) => Err(PgError::local("the dump already failed")),
                },
            };
            let made = made.and_then(|()| {
                std::fs::rename(&part, &file).map_err(|e| PgError::local(e.to_string()))
            });
            match made {
                Ok(()) => {
                    written.push(file);
                    self.prune(dir);
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&part);
                    let _ = first_err.get_or_insert(e);
                }
            }
        }
        match first_err {
            Some(e) if written.is_empty() => Err(e),
            _ => Ok(written),
        }
    }

    /// Every backup in every place, newest first; a restore tries them in this order.
    #[must_use]
    pub fn all(&self) -> Vec<PathBuf> {
        let mut all: Vec<PathBuf> = self.dirs.iter().flat_map(|d| list(d)).collect();
        // Newest by name, not by place: the stamp is the same clock everywhere.
        all.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        all
    }

    fn prune(&self, dir: &Path) {
        let files = list(dir);
        let mut kept: Vec<&PathBuf> = files.iter().take(self.keep).collect();
        let mut days: Vec<String> = Vec::new();
        for file in &files {
            // `local-pg-YYYY-MM-DD…`: newest first, so the first seen of a day is its newest.
            let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let day: String = name.chars().skip(PREFIX.len()).take(10).collect();
            if days.contains(&day) || days.len() >= self.daily_keep {
                continue;
            }
            days.push(day);
            kept.push(file);
        }
        for file in &files {
            if !kept.contains(&file) {
                let _ = std::fs::remove_file(file);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        std::env::temp_dir().join(format!("wf-backup-{tag}-{}-{stamp}", std::process::id()))
    }

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn names(files: &[PathBuf]) -> Vec<String> {
        files
            .iter()
            .filter_map(|f| f.file_name()?.to_str().map(str::to_owned))
            .collect()
    }

    async fn write_dump(file: PathBuf) -> Result<(), PgError> {
        std::fs::write(file, b"dump").map_err(|e| PgError::local(e.to_string()))
    }

    #[test]
    fn names_are_utc_and_sortable() {
        // 2026-11-05T03:04:05.678Z
        let t = UNIX_EPOCH + Duration::from_millis(1_793_847_845_678);
        assert_eq!(file_name(t), "local-pg-2026-11-05T03-04-05-678.dump");
        assert!(file_name(at(0)) < file_name(at(1)));
        assert_eq!(file_name(at(0)), "local-pg-1970-01-01T00-00-00-000.dump");
    }

    #[tokio::test]
    async fn dumps_once_copies_to_every_place_and_ignores_other_files() -> Result<(), PgError> {
        let (a, b) = (temp("a"), temp("b"));
        let backups = Backups::new(vec![a.clone(), b.clone()]);
        let calls = std::cell::Cell::new(0);
        let written = backups
            .take(at(100), |file| {
                calls.set(calls.get() + 1);
                write_dump(file)
            })
            .await?;
        assert_eq!(calls.get(), 1);
        assert_eq!(written.len(), 2);
        assert_eq!(
            std::fs::read(b.join(file_name(at(100)))).ok(),
            Some(b"dump".to_vec())
        );
        let _ = std::fs::write(a.join("local-db-x.tar.gz"), b"");
        let _ = std::fs::write(a.join("local-pg-y.dump.part"), b"");
        assert_eq!(
            names(&backups.all()),
            [file_name(at(100)), file_name(at(100))]
        );
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
        Ok(())
    }

    #[tokio::test]
    async fn failed_dump_leaves_no_file_and_reports() {
        let dir = temp("fail");
        let backups = Backups::new(vec![dir.clone()]);
        let result = backups
            .take(at(5), |file| async move {
                let _ = std::fs::write(&file, b"half");
                Err(PgError::local("pg_dump failed: boom"))
            })
            .await;
        assert_eq!(
            result.map_err(|e| e.message),
            Err("pg_dump failed: boom".to_owned())
        );
        assert_eq!(std::fs::read_dir(&dir).map(Iterator::count).ok(), Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_bad_place_is_skipped() -> Result<(), PgError> {
        let good = temp("good");
        let bad = temp("bad-file");
        std::fs::write(&bad, b"not a dir").map_err(|e| PgError::local(e.to_string()))?;
        let backups = Backups::new(vec![bad.clone(), good.clone()]);
        let written = backups.take(at(7), write_dump).await?;
        assert_eq!(written, [good.join(file_name(at(7)))]);
        let _ = std::fs::remove_file(&bad);
        let _ = std::fs::remove_dir_all(&good);
        Ok(())
    }

    #[tokio::test]
    async fn prunes_to_newest_plus_one_per_day() -> Result<(), PgError> {
        const DAY: u64 = 86_400;
        let dir = temp("prune");
        let backups = Backups {
            dirs: vec![dir.clone()],
            keep: 2,
            daily_keep: 3,
        };
        // Two a day for five days; times sort by name.
        for day in 0..5 {
            for hour in [1, 2] {
                let _ = backups
                    .take(at(day * DAY + hour * 3_600), write_dump)
                    .await?;
            }
        }
        let kept = names(&list(&dir));
        let want: Vec<String> = [
            4 * DAY + 7_200,
            4 * DAY + 3_600,
            3 * DAY + 7_200,
            2 * DAY + 7_200,
        ]
        .iter()
        .map(|s| file_name(at(*s)))
        .collect();
        assert_eq!(kept, want);
        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }
}
