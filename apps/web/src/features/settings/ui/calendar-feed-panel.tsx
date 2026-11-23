"use client";

import { PlanWidgetToggle } from "./plan-widget-toggle";

/**
 * Settings → Calendar: in the desktop app, the deadlines widget on the
 * wallpaper, which reads this computer's own copy of the plan.
 *
 * The private calendar link this panel used to make (a `tt_` token) stopped
 * working in 0.9.8: the server answers only `wff_` feed links now, so the panel
 * no longer offers to make one and says so instead.
 */
export function CalendarFeedPanel() {
  return (
    <div id="settings-calendar" className="add-form settings-anchor calendar-feed" role="tabpanel" aria-labelledby="settings-tab-calendar">
      <h3 className="settings-group">Deadlines in your calendar</h3>
      <p className="muted api-token-intro">
        Calendar links made in earlier versions no longer work. You can remove that calendar from your calendar app.
      </p>
      <PlanWidgetToggle />
    </div>
  );
}
