//! A second launch of the app while it runs (desktop): the single-instance plugin ends the new
//! process and hands its command line to the running one, which comes forward and passes the
//! arguments to the page.

/// The page event that carries a second launch's arguments (no listener needs it to be safe).
pub const SECOND_LAUNCH_EVENT: &str = "second-launch";

/// The arguments worth passing on: the program path (the first entry) and blanks are dropped.
#[must_use]
pub fn forwarded_args(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|arg| !arg.trim().is_empty())
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::forwarded_args;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn drops_the_program_path() {
        let argv = strings(&[r"C:\Program Files\WeaveForge\weaveforge.exe", "notes/a.md"]);
        assert_eq!(forwarded_args(&argv), strings(&["notes/a.md"]));
    }

    #[test]
    fn a_bare_relaunch_forwards_nothing() {
        assert!(forwarded_args(&strings(&["weaveforge"])).is_empty());
        assert!(forwarded_args(&[]).is_empty());
    }

    #[test]
    fn blanks_are_dropped_and_order_kept() {
        let argv = strings(&["weaveforge", "", "--flag", "  ", "weaveforge://open?x=1"]);
        assert_eq!(
            forwarded_args(&argv),
            strings(&["--flag", "weaveforge://open?x=1"])
        );
    }
}
