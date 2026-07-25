/**
 * An error a user is blocked on must be announced, not just coloured red.
 * `role="alert"` makes assistive tech read it when it appears, which matters
 * most on gates (sign-in, unlock, recovery) where the text is the only clue
 * that the action failed.
 */
export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert">
      {children}
    </p>
  );
}
