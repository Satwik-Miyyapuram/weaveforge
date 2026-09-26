"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { useAuth } from "@/features/auth";
import { hasServerRoutes } from "@/deployment/capabilities";
import { formatError } from "@/lib/format-error";
import { PlanWidgetToggle } from "./plan-widget-toggle";
import {
  planFeedOrigin,
  planFeedUrls,
  type PlanFeedLink,
} from "@/features/plan/infrastructure/plan-feed-links";

const REMINDER_OPTIONS = [
  { value: "0", label: "No reminder" },
  { value: "1", label: "1 day before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "1 week before" },
] as const;

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Settings → Calendar: one private link that puts milestone deadlines in any
 * calendar app, and that phone widgets read; and, in the desktop app, the
 * widget on the wallpaper, which reads this computer's own copy instead.
 *
 * The link is the credential, and only its hash is stored, so the full link is
 * on screen once — right after it is made. After that the panel says a link is
 * active and offers a new one, which turns the old one off.
 */
export function CalendarFeedPanel() {
  const { user } = useAuth();
  const [link, setLink] = useState<PlanFeedLink | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [reminder, setReminder] = useState("1");
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"replace" | "off" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLink(await getContainer().plan.feedLinks.current());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const make = () =>
    run(async () => {
      const made = await getContainer().plan.feedLinks.create();
      setLink(made.link);
      setToken(made.token);
    });

  const turnOff = () =>
    run(async () => {
      await getContainer().plan.feedLinks.revoke();
      setLink(null);
      setToken(null);
    });

  const urls = token
    ? planFeedUrls(planFeedOrigin(hasServerRoutes(), window.location.origin), token, {
        includeDone,
        reminderDays: Number(reminder),
      })
    : null;

  function copy(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1200);
    });
  }

  return (
    <div id="settings-calendar" className="card add-form settings-anchor calendar-feed" role="tabpanel" aria-labelledby="settings-tab-calendar">
      <h3 className="settings-group">Deadlines in your calendar</h3>
      <p className="muted api-token-intro">
        One private link puts every dated milestone in Google Calendar, Outlook or Apple Calendar as an
        all-day event, and keeps it up to date. Widgets on your phone read the same link.
      </p>

      <FormError>{error}</FormError>

      <div className="calendar-feed-options">
        <label className="calendar-feed-check">
          <input type="checkbox" className="themed-check" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
          Include finished milestones
        </label>
        <div className="field">
          <label htmlFor="calendar-reminder">Reminder</label>
          <Select id="calendar-reminder" value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {REMINDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="muted">Checking for a link…</p>
      ) : urls ? (
        <div className="calendar-feed-links">
          <p className="muted">Copy it now. For your safety it is only shown once.</p>
          {(
            [
              ["webcal", "Calendar link", urls.webcal],
              ["widget", "Widget link", urls.widget],
            ] as const
          ).map(([key, label, value]) => (
            <div key={key} className="field calendar-feed-link">
              <label htmlFor={`calendar-${key}`}>{label}</label>
              <div className="calendar-feed-row">
                <input id={`calendar-${key}`} className="mono" value={value} readOnly onFocus={(e) => e.target.select()} />
                <button type="button" className="btn-secondary" onClick={() => copy(key, value)}>
                  {copied === key ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
          <p className="muted calendar-feed-help">
            Google Calendar: Other calendars → From URL, and paste the calendar link. Outlook: Add calendar →
            Subscribe from web. Apple Calendar opens it straight away:{" "}
            <a href={urls.webcal}>open in calendar app</a>.
          </p>
          <p className="muted calendar-feed-help">
            Changed the options above? Copy the link again; the same link takes the new options.
          </p>
        </div>
      ) : link ? (
        <p className="muted">
          A link is on: <span className="mono">{link.tokenPrefix}</span>, made {formatWhen(link.createdAt)}, last read{" "}
          {formatWhen(link.lastUsedAt)}. To copy it again, make a new one; the old one stops working.
        </p>
      ) : (
        <p className="muted">No link yet.</p>
      )}

      {!loading && (
        <div className="api-token-toolbar calendar-feed-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => (link ? setConfirming("replace") : void make())}
          >
            {busy ? "Working…" : link ? "Make a new link" : "Make a link"}
          </button>
          {link ? (
            <button type="button" className="link-btn danger" disabled={busy} onClick={() => setConfirming("off")}>
              Turn off
            </button>
          ) : null}
        </div>
      )}

      <PlanWidgetToggle />

      {confirming ? (
        <ConfirmDialog
          title={confirming === "replace" ? "Make a new link?" : "Turn the link off?"}
          body={
            confirming === "replace"
              ? "Calendars and widgets using the current link stop updating. You will add the new one to them."
              : "Calendars and widgets using this link stop updating. Their events stay until you remove the calendar."
          }
          confirmLabel={confirming === "replace" ? "Make new link" : "Turn off"}
          danger={confirming === "off"}
          onConfirm={() => void (confirming === "replace" ? make() : turnOff())}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}
