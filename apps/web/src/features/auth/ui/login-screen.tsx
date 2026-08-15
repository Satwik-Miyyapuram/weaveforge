"use client";

import { useState } from "react";
import { getLightContainer } from "@/light-bootstrap";
import { FormError } from "@/components/form-error";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { formatError } from "@/lib/format-error";

/**
 * Passwordless login. Sends a Supabase magic-link to the entered email. On
 * click-through, supabase-js parses the session from the URL and the
 * AuthProvider flips to signed-in (detectSessionInUrl).
 */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [sent, setSent] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = () =>
    typeof window !== "undefined" ? window.location.origin : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) {
        await getLightContainer().auth.signUpWithPassword(email.trim(), password);
        setSent(true);
      } else {
        await getLightContainer().auth.signInWithPassword(email.trim(), password);
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    try {
      await getLightContainer().auth.signInWithGoogle(redirectTo());
      // Browser redirects to Google; nothing more to do here.
    } catch (err) {
      setError(formatError(err));
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    setBusy(true);
    setError(null);
    try {
      await getLightContainer().auth.sendMagicLink(email.trim(), redirectTo());
      setMagicLinkSent(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    setBusy(true);
    setError(null);
    try {
      const origin = redirectTo();
      if (!origin) throw new Error("Password reset is only available in a browser.");
      await getLightContainer().auth.sendPasswordReset(email.trim(), `${origin}/reset-password`);
      setResetSent(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    setBusy(true);
    setError(null);
    try {
      await getLightContainer().auth.sendEmailOtp(email.trim());
      setOtpSent(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getLightContainer().auth.verifyEmailOtp(email.trim(), otp.trim());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen auth-screen">
      <header className="screen-head">
        <div className="auth-brand">
          <WeaveForgeLogo />
          <div><span>Research, Unified</span><strong>WeaveForge</strong></div>
        </div>
        <h1>{isSignUp ? "Sign up" : "Sign in"}</h1>
        <p className="auth-hero">A private research environment unifying your literature, experiments, and logs in one place. Built for standalone focus. Ready for organizational collaboration.</p>
      </header>

      {sent ? (
        <div className="card add-form">
          <p>
            Registration successful! Please check your email <strong>{email}</strong> for a confirmation link to activate your account.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setSent(false);
              setIsSignUp(false);
              setPassword("");
              setError(null);
            }}
          >
            Back to sign in
          </button>
        </div>
      ) : magicLinkSent ? (
        <div className="card add-form">
          <h2 className="screen-title">Check your email</h2>
          <p className="muted">We sent a sign-in link to <strong>{email}</strong>. Open it to sign in.</p>
          <button type="button" className="btn-secondary" onClick={() => setMagicLinkSent(false)}>Back</button>
        </div>
      ) : resetSent ? (
        <div className="card add-form">
          <h2 className="screen-title">Password reset email sent</h2>
          <p className="muted">If an account exists for <strong>{email}</strong>, you’ll receive a link to choose a new login password.</p>
          <button type="button" className="btn-secondary" onClick={() => setResetSent(false)}>Back</button>
        </div>
      ) : otpSent ? (
        <div className="card add-form">
          <h2 className="screen-title">Enter your email code</h2>
          <p className="muted">We sent a short-lived code to <strong>{email}</strong>.</p>
          <form className="auth-email" onSubmit={(event) => void verifyOtp(event)}>
            <div className="field"><label htmlFor="email-otp">Email code</label><input id="email-otp" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required /></div>
            {error && <FormError>{error}</FormError>}
            <button className="btn-primary" disabled={busy}>{busy ? "Verifying…" : "Verify code"}</button>
          </form>
          <button type="button" className="btn-secondary" onClick={() => { setOtpSent(false); setOtp(""); }} disabled={busy}>Back</button>
        </div>
      ) : (
        <div className="card add-form">
          <button
            type="button"
            className="btn-google"
            onClick={google}
            disabled={busy}
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div className="auth-divider"><span>or</span></div>

          <form className="auth-email" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
              />
            </div>
            <button className="btn-primary" disabled={busy}>
              {busy ? (isSignUp ? "Signing up…" : "Signing in…") : (isSignUp ? "Sign Up" : "Sign In")}
            </button>
          </form>

          {!isSignUp && (
            <div className="auth-secondary-actions">
              <button type="button" className="link-btn" onClick={() => void sendMagicLink()} disabled={busy || !email.trim()}>
                Email me a sign-in link
              </button>
              <button type="button" className="link-btn" onClick={() => void sendOtp()} disabled={busy || !email.trim()}>
                Email me a code
              </button>
              <button type="button" className="link-btn" onClick={() => void sendPasswordReset()} disabled={busy || !email.trim()}>
                Forgot password?
              </button>
            </div>
          )}

          <div style={{ marginTop: "1rem", textAlign: "center" }}>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              disabled={busy}
            >
              {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
            </button>
          </div>

          {error && <FormError>{error}</FormError>}
        </div>
      )}
    </section>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16 4 9.1 8.6 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.1 39.3 16 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.1 35.4 45 30.3 45 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
