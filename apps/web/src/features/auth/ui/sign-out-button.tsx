"use client";

import { useAuth } from "./auth-provider";

/** Small sign-out control shown in the app header when signed in. */
export function SignOutButton() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <button className="signout" onClick={() => void signOut()} title={user.email}>
      Sign out
    </button>
  );
}
