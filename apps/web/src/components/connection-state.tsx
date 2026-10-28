/**
 * The right end of a connection row: its state once connected, the action
 * before (DA-139). Text, not a button, because the whole row is the button.
 */
export function ConnectionState({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="status status-done">Connected</span>
  ) : (
    <span className="connection-setup">Set up</span>
  );
}
