"use client";

export function TimerPluginScreen() {
  return (
    <div className="card">
      <h2 className="screen-title">Focus timer (plugin demo)</h2>
      <p className="muted">
        Example feature module loaded via <code>weaveforge.config.ts</code>. Wire domain logic in{" "}
        <code>bootstrap.ts</code> when the plugin needs data access.
      </p>
    </div>
  );
}
