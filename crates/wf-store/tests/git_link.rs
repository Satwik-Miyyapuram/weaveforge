//! The git library is linked with the transports git sync needs (P2.10 prep).

#[cfg(test)]
mod common;

use common::TempDir;

#[test]
fn https_and_ssh_are_built_in() {
    let version = git2::Version::get();
    assert!(version.https(), "https transport missing");
    assert!(version.ssh(), "ssh transport missing");
}

#[test]
fn a_repository_can_be_created_and_opened() {
    let dir = TempDir::new();
    let created = git2::Repository::init(dir.path()).unwrap_or_else(|e| panic!("init: {e}"));
    assert!(created.is_empty().unwrap_or(false));
    let opened = git2::Repository::open(dir.path()).unwrap_or_else(|e| panic!("open: {e}"));
    assert!(opened.workdir().is_some());
}
