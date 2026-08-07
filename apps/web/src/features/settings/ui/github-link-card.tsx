/** Small GitHub project link card for Settings. */
export function GitHubLinkCard() {
  return (
    <a
      className="github-link-card"
      href="https://github.com/Satwik-Miyyapuram/weaveforge"
      target="_blank"
      rel="noreferrer"
    >
      <span className="github-link-logo" aria-hidden />
      <div className="github-link-main">
        <strong>weaveforge on GitHub</strong>
        <span className="muted">Source, issues, and release notes</span>
      </div>
      <span className="github-link-arrow" aria-hidden>
        ↗
      </span>
    </a>
  );
}
