//! Folder history on a real folder: probe, init, status, commit, log and read-back via git2.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use git2::{
    DiffOptions, ErrorCode, IndexAddOption, Oid, Repository, RepositoryInitOptions, Sort, Status,
    StatusOptions,
};

use crate::git::policy::{
    CommitAction, FileState, IGNORED_DIRS, IGNORED_EXTENSIONS, IGNORED_FILES, MAX_FILE_BYTES,
    RepoState, decide_commit, decide_path, describe_changes,
};

/// A lock this old is not a git still running.
pub const STALE_LOCK_SECS: u64 = 5 * 60;

/// The largest file version `read_at` returns; matches the TS maxBuffer.
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// The branch a folder syncs when none is set.
pub const DEFAULT_BRANCH: &str = "main";

/// Who the automatic mirror commits are by.
pub const MIRROR_AUTHOR: Author<'static> = Author {
    name: "WeaveForge",
    email: "mirror@weaveforge.local",
};

/// A commit identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Author<'a> {
    /// Display name.
    pub name: &'a str,
    /// Email address.
    pub email: &'a str,
}

/// One commit in the folder history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commit {
    /// Full 40-hex object id.
    pub oid: String,
    /// First line of the message.
    pub message: String,
    /// Author time as ISO 8601 with offset.
    pub authored_at: String,
    /// Author name.
    pub author: String,
}

/// One changed file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    /// `/`-separated path relative to the folder.
    pub path: String,
    /// What changed.
    pub state: FileState,
}

/// Why a folder repository operation failed.
#[derive(Debug, thiserror::Error)]
pub enum RepoError {
    /// Message shown to the reader as-is.
    #[error("{0}")]
    StaleLock(String),
    /// A git2 failure, as its message.
    #[error("{0}")]
    Git(String),
}

impl From<git2::Error> for RepoError {
    fn from(e: git2::Error) -> Self {
        Self::Git(e.message().to_owned())
    }
}

/// Whether the folder is its own repository, sits in none, or sits inside someone else's.
#[must_use]
pub fn probe(root: &Path) -> RepoState {
    let Ok(repo) = Repository::discover(root) else {
        return RepoState::None;
    };
    let Some(workdir) = repo.workdir() else {
        return RepoState::None;
    };
    let (Ok(own), Ok(theirs)) = (fs::canonicalize(root), fs::canonicalize(workdir)) else {
        return RepoState::None;
    };
    if own == theirs {
        return RepoState::Own;
    }
    let shown = workdir.to_string_lossy();
    RepoState::Enclosing {
        root: shown.trim_end_matches(['/', '\\']).to_owned(),
    }
}

/// Keeps the folder's `.git/info/exclude` holding every wanted line, leaving user lines alone.
pub(crate) fn write_excludes(repo: &Repository) -> Result<(), RepoError> {
    let info = repo.path().join("info");
    let file = info.join("exclude");
    let current = fs::read_to_string(&file).unwrap_or_default();
    let mut wanted = vec!["/.weaveforge/".to_owned()];
    wanted.extend(IGNORED_DIRS.iter().map(|dir| format!("{dir}/")));
    wanted.extend(IGNORED_FILES.iter().map(|name| (*name).to_owned()));
    wanted.extend(IGNORED_EXTENSIONS.iter().map(|ext| format!("*{ext}")));
    let present: Vec<&str> = current
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect();
    let missing: Vec<&String> = wanted
        .iter()
        .filter(|line| !present.contains(&line.as_str()))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut text = current.clone();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    for line in missing {
        text.push_str(line);
        text.push('\n');
    }
    let io = |e: std::io::Error| RepoError::Git(e.to_string());
    fs::create_dir_all(&info).map_err(io)?;
    fs::write(&file, text).map_err(io)
}

/// A folder and its git history.
pub struct FolderRepo {
    root: PathBuf,
    max_file_bytes: u64,
    max_read_bytes: u64,
    git_dir: Option<PathBuf>,
    branch: String,
}

impl FolderRepo {
    /// A handle on `root` with the default size caps.
    #[must_use]
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            max_file_bytes: MAX_FILE_BYTES,
            max_read_bytes: MAX_READ_BYTES,
            git_dir: None,
            branch: DEFAULT_BRANCH.to_owned(),
        }
    }

    /// Keeps the git data in `git_dir` instead of `<root>/.git`.
    #[must_use]
    pub fn with_git_dir(self, git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: Some(git_dir.into()),
            ..self
        }
    }

    /// Syncs `branch` instead of `main`.
    #[must_use]
    pub fn with_branch(self, branch: impl Into<String>) -> Self {
        Self {
            branch: branch.into(),
            ..self
        }
    }

    /// The branch this folder syncs.
    #[must_use]
    pub fn branch(&self) -> &str {
        &self.branch
    }

    /// Where the git data lives when it is outside the folder.
    #[must_use]
    pub fn git_dir(&self) -> Option<&Path> {
        self.git_dir.as_deref()
    }

    /// Opens the repository, with the folder as its work tree when the git data is elsewhere.
    pub(crate) fn open(&self) -> Result<Repository, git2::Error> {
        let Some(git_dir) = &self.git_dir else {
            return Repository::open(&self.root);
        };
        let repo = Repository::open(git_dir)?;
        repo.set_workdir(&self.root, false)?;
        Ok(repo)
    }

    /// Replaces the size cap.
    #[must_use]
    pub fn with_max_file_bytes(self, max: u64) -> Self {
        Self {
            max_file_bytes: max,
            ..self
        }
    }

    /// Replaces the largest file version `read_at` returns.
    #[must_use]
    pub fn with_max_read_bytes(self, max: u64) -> Self {
        Self {
            max_read_bytes: max,
            ..self
        }
    }

    /// The folder this handle is for.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Whether the folder is its own repository.
    #[must_use]
    pub fn is_repo(&self) -> bool {
        if self.git_dir.is_some() {
            return self.open().is_ok();
        }
        probe(&self.root) == RepoState::Own
    }

    /// Creates a repository in the folder; keeps history if one exists.
    ///
    /// # Errors
    /// When git cannot create the repository.
    pub fn init(&self) -> Result<(), RepoError> {
        let Some(git_dir) = &self.git_dir else {
            let _repo = Repository::init(&self.root)?;
            return Ok(());
        };
        // Created bare and switched to non-bare: libgit2 given a work tree
        // elsewhere writes a `.git` link file into it, and the folder must
        // stay free of git files. `open` points it at the folder each time.
        let repo = Repository::init_opts(
            git_dir,
            RepositoryInitOptions::new()
                .bare(true)
                .mkpath(true)
                .initial_head(&self.branch),
        )?;
        repo.config()?.set_bool("core.bare", false)?;
        Ok(())
    }

    /// Changes since the last commit, sorted by path.
    ///
    /// # Errors
    /// When the repository cannot be read.
    pub fn status(&self) -> Result<Vec<FileChange>, RepoError> {
        let repo = self.open()?;
        write_excludes(&repo)?;
        let mut options = StatusOptions::new();
        let options = options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let statuses = repo.statuses(Some(options))?;
        let mut changes = Vec::new();
        for entry in statuses.iter() {
            let Ok(path) = entry.path() else {
                continue;
            };
            if format!("/{path}").starts_with("/.weaveforge/") {
                continue;
            }
            let Some(state) = change_state(entry.status()) else {
                continue;
            };
            if state != FileState::Deleted {
                let size = fs::symlink_metadata(self.root.join(path))
                    .ok()
                    .map(|meta| meta.len());
                if decide_path(path, size, self.max_file_bytes).is_err() {
                    continue;
                }
            }
            changes.push(FileChange {
                path: path.to_owned(),
                state,
            });
        }
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(changes)
    }

    /// Commits every permitted change; `Ok(None)` when nothing changed.
    ///
    /// # Errors
    /// When git cannot write the commit; a stale `index.lock` is named in the error.
    pub fn commit_all(
        &self,
        message: &str,
        author: Author<'_>,
    ) -> Result<Option<Commit>, RepoError> {
        match self.stage_and_commit(message, author) {
            Ok(None) => Ok(None),
            Ok(Some(oid)) => {
                let repo = self.open()?;
                Ok(Some(to_commit(&repo.find_commit(oid)?)))
            }
            Err(error) => Err(self.explain_failure(error)),
        }
    }

    /// Commits from HEAD, newest first, optionally limited and filtered to one path.
    #[must_use]
    pub fn log(&self, limit: Option<usize>, path: Option<&str>) -> Vec<Commit> {
        self.collect_log(limit, path).unwrap_or_default()
    }

    /// The bytes of `file` as it was at `oid`, or `None`.
    #[must_use]
    pub fn read_at(&self, oid: &str, file: &str) -> Option<Vec<u8>> {
        let repo = self.open().ok()?;
        let oid = Oid::from_str(oid).ok()?;
        let tree = repo.find_commit(oid).ok()?.tree().ok()?;
        let entry = tree.get_path(Path::new(file)).ok()?;
        let blob = entry.to_object(&repo).ok()?.into_blob().ok()?;
        let size = u64::try_from(blob.size()).ok()?;
        if size > self.max_read_bytes {
            return None;
        }
        Some(blob.content().to_vec())
    }

    /// Stages permitted changes and commits them; `Ok(None)` when there is nothing to commit.
    fn stage_and_commit(
        &self,
        message: &str,
        author: Author<'_>,
    ) -> Result<Option<Oid>, RepoError> {
        let repo = self.open()?;
        write_excludes(&repo)?;
        let mut index = repo.index()?;
        index.remove_dir(Path::new(".weaveforge"), 0)?;
        let root = self.root.clone();
        let max = self.max_file_bytes;
        let mut policy = |path: &Path, _spec: &[u8]| -> i32 {
            let rel = path.to_string_lossy().replace('\\', "/");
            if rel.starts_with(".weaveforge/") {
                return 1;
            }
            let size = fs::symlink_metadata(root.join(path))
                .ok()
                .map(|meta| meta.len());
            if size.is_none() || decide_path(&rel, size, max).is_ok() {
                0
            } else {
                1
            }
        };
        index.update_all(
            ["*"].iter(),
            Some(&mut policy as &mut git2::IndexMatchedPath<'_>),
        )?;
        index.add_all(
            ["*"].iter(),
            IndexAddOption::DEFAULT,
            Some(&mut policy as &mut git2::IndexMatchedPath<'_>),
        )?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let parent = match repo.head() {
            Ok(reference) => Some(reference.peel_to_commit()?),
            Err(error) if matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => {
                None
            }
            Err(error) => return Err(error.into()),
        };
        match &parent {
            Some(parent) if parent.tree_id() == tree_id => return Ok(None),
            None if repo.find_tree(tree_id)?.is_empty() => return Ok(None),
            _ => {}
        }
        let sig = git2::Signature::now(author.name, author.email)?;
        let tree = repo.find_tree(tree_id)?;
        let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
        let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
        Ok(Some(oid))
    }

    /// Names a stale `index.lock` when it blocks the commit; otherwise returns `error` as is.
    fn explain_failure(&self, error: RepoError) -> RepoError {
        let Ok(repo) = self.open() else {
            return error;
        };
        let lock = repo.path().join("index.lock");
        let Ok(modified) = fs::metadata(&lock).and_then(|meta| meta.modified()) else {
            return error;
        };
        let age = SystemTime::now()
            .duration_since(modified)
            .unwrap_or_default()
            .as_secs();
        if age < STALE_LOCK_SECS {
            return error;
        }
        let minutes = (age + 30) / 60;
        RepoError::StaleLock(format!(
            "A stale {}, left {minutes} min ago by a git that was stopped, blocks every commit. Quit WeaveForge, check no git is running, then delete it. ({error})",
            lock.display()
        ))
    }

    fn collect_log(
        &self,
        limit: Option<usize>,
        path: Option<&str>,
    ) -> Result<Vec<Commit>, git2::Error> {
        let repo = self.open()?;
        let head = repo.head()?.peel_to_commit()?;
        let mut walk = repo.revwalk()?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
        walk.push(head.id())?;
        let max = match limit {
            Some(0) | None => usize::MAX,
            Some(n) => n,
        };
        let mut out = Vec::new();
        for oid in walk {
            if out.len() >= max {
                break;
            }
            let commit = repo.find_commit(oid?)?;
            if let Some(wanted) = path
                && !touches(&repo, &commit, wanted)?
            {
                continue;
            }
            out.push(to_commit(&commit));
        }
        Ok(out)
    }
}

/// The change a status entry stands for, or `None` when it is not a change.
fn change_state(flags: Status) -> Option<FileState> {
    if flags.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
        return Some(FileState::Deleted);
    }
    if flags.intersects(Status::WT_NEW | Status::INDEX_NEW) {
        return Some(FileState::Added);
    }
    let changed = Status::INDEX_MODIFIED
        | Status::WT_MODIFIED
        | Status::INDEX_TYPECHANGE
        | Status::WT_TYPECHANGE
        | Status::INDEX_RENAMED
        | Status::WT_RENAMED;
    flags.intersects(changed).then_some(FileState::Modified)
}

/// Whether `commit` changed `path` against its first parent.
fn touches(repo: &Repository, commit: &git2::Commit<'_>, path: &str) -> Result<bool, git2::Error> {
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let mut options = DiffOptions::new();
    let options = options.pathspec(path);
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(options))?;
    Ok(diff.deltas().next().is_some())
}

fn to_commit(commit: &git2::Commit<'_>) -> Commit {
    let author = commit.author();
    let when = author.when();
    Commit {
        oid: commit.id().to_string(),
        message: String::from_utf8_lossy(commit.summary_bytes().unwrap_or_default()).into_owned(),
        authored_at: iso_with_offset(when.seconds(), when.offset_minutes()),
        author: author.name().unwrap_or_default().to_owned(),
    }
}

/// What a folder commit did, or why it did not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitOutcome {
    /// The new commit, if one was made.
    pub commit: Option<Commit>,
    /// Why nothing was committed, if it was refused or failed.
    pub reason: Option<String>,
}

fn refused(reason: String) -> CommitOutcome {
    CommitOutcome {
        commit: None,
        reason: Some(reason),
    }
}

/// The mirror commit for a folder, when history is on.
#[must_use]
pub fn commit_vault(root: &Path, enabled: bool) -> CommitOutcome {
    let state = if enabled {
        probe(root)
    } else {
        RepoState::None
    };
    let action = match decide_commit(enabled, &state) {
        Ok(action) => action,
        Err(reason) => return refused(reason),
    };
    let repo = FolderRepo::new(root);
    if action == CommitAction::Init
        && let Err(error) = repo.init()
    {
        return refused(error.to_string());
    }
    let changes = match repo.status() {
        Ok(changes) => changes,
        Err(error) => return refused(error.to_string()),
    };
    if changes.is_empty() {
        return CommitOutcome {
            commit: None,
            reason: None,
        };
    }
    let states: Vec<FileState> = changes.iter().map(|change| change.state).collect();
    match repo.commit_all(&describe_changes(&states), MIRROR_AUTHOR) {
        Ok(commit) => CommitOutcome {
            commit,
            reason: None,
        },
        Err(error) => refused(error.to_string()),
    }
}

/// Days since 1970-01-01 to `(year, month, day)` in the proleptic Gregorian calendar.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// `seconds` since the epoch at UTC offset `offset_minutes`, as git's `%aI`.
#[must_use]
pub fn iso_with_offset(seconds: i64, offset_minutes: i32) -> String {
    let offset = i64::from(offset_minutes);
    let local = seconds + offset * 60;
    let (year, month, day) = civil_from_days(local.div_euclid(86_400));
    let secs = local.rem_euclid(86_400);
    let sign = if offset_minutes >= 0 { '+' } else { '-' };
    let abs = offset.abs();
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}{sign}{:02}:{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60,
        abs / 60,
        abs % 60
    )
}
