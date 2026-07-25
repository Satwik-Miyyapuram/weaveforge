/** Small GitHub project link card for Settings. */
export function GitHubLinkCard() {
  return (
    <a
      className="github-link-card"
      href="https://github.com/Satwik-Miyyapuram/thesis_tracker"
      target="_blank"
      rel="noreferrer"
    >
      <span className="github-link-logo" aria-hidden />
      <div className="github-link-main">
        <strong>thesis_tracker on GitHub</strong>
        <span className="muted">Source, issues, and release notes</span>
      </div>
      <span className="github-link-arrow" aria-hidden>
        ↗
      </span>
    </a>
  );
}
