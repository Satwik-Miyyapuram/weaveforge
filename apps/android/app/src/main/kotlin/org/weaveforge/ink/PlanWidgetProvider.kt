package org.weaveforge.ink

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The deadlines widget on the home screen.
 *
 * It reads the plan feed's `widget.json` through the link the user pasted in
 * [PlanWidgetConfigActivity], keeps the last good copy, and draws from that
 * copy when the phone is offline. The link is the only credential; it lives
 * in this app's private preferences and goes nowhere but its own host.
 *
 * One link serves every instance: they all show the same person's plan.
 */
class PlanWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        // Draw the cached copy now, then refresh off the main thread.
        render(context, manager, ids)
        val pending = goAsync()
        Thread {
            try {
                refresh(context)
                render(context, manager, ids)
            } finally {
                pending.finish()
            }
        }.start()
    }

    override fun onDisabled(context: Context) {
        // The last widget is gone: forget the link rather than keep a credential
        // nothing uses.
        prefs(context).edit().clear().apply()
    }

    companion object {
        private const val TAG = "PlanWidget"
        private const val PREFS = "plan-widget"
        private const val KEY_URL = "url"
        private const val KEY_JSON = "json"
        private const val KEY_STATE = "state"
        private const val STATE_OK = "ok"
        private const val STATE_OFFLINE = "offline"
        private const val STATE_GONE = "gone"

        private val ROWS = listOf(
            RowIds(R.id.widget_row0, R.id.widget_title0, R.id.widget_meta0, R.id.widget_when0),
            RowIds(R.id.widget_row1, R.id.widget_title1, R.id.widget_meta1, R.id.widget_when1),
            RowIds(R.id.widget_row2, R.id.widget_title2, R.id.widget_meta2, R.id.widget_when2),
            RowIds(R.id.widget_row3, R.id.widget_title3, R.id.widget_meta3, R.id.widget_when3),
        )

        private data class RowIds(val row: Int, val title: Int, val meta: Int, val whenPill: Int)

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun feedUrl(context: Context): String? = prefs(context).getString(KEY_URL, null)

        /** Keep a new link and drop what the old one fetched. */
        fun saveFeedUrl(context: Context, url: String) {
            prefs(context).edit().putString(KEY_URL, url).remove(KEY_JSON).remove(KEY_STATE).apply()
        }

        /** Redraw every instance, refreshing first. */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, PlanWidgetProvider::class.java))
            if (ids.isEmpty()) return
            context.sendBroadcast(
                Intent(context, PlanWidgetProvider::class.java)
                    .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
            )
        }

        /**
         * Fetch the feed once. A 404 means the link was turned off in Settings;
         * anything else that fails keeps the last copy and says so.
         */
        private fun refresh(context: Context) {
            val url = feedUrl(context) ?: return
            val state = try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("Accept", "application/json")
                try {
                    when (connection.responseCode) {
                        200 -> {
                            val body = connection.inputStream.bufferedReader().use { it.readText() }
                            if (PlanWidgetModel.parse(body) != null) {
                                prefs(context).edit().putString(KEY_JSON, body).apply()
                                STATE_OK
                            } else {
                                STATE_OFFLINE
                            }
                        }
                        404 -> STATE_GONE
                        else -> STATE_OFFLINE
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (error: Exception) {
                Log.w(TAG, "refresh failed: ${error.javaClass.simpleName}")
                STATE_OFFLINE
            }
            prefs(context).edit().putString(KEY_STATE, state).apply()
        }

        private fun openIntent(context: Context, configured: Boolean): PendingIntent {
            val intent = if (configured) {
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_ROUTE, MainActivity.ROUTE_PLAN)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            } else {
                Intent(context, PlanWidgetConfigActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return PendingIntent.getActivity(
                context,
                if (configured) 1 else 2,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val views = RemoteViews(context.packageName, R.layout.widget_plan)
            val today = LocalDate.now()
            views.setTextViewText(
                R.id.widget_today,
                today.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())),
            )

            val prefs = prefs(context)
            val url = prefs.getString(KEY_URL, null)
            val state = prefs.getString(KEY_STATE, null)
            val data = prefs.getString(KEY_JSON, null)?.let(PlanWidgetModel::parse)
            // A turned-off link needs a new one; tapping goes back to setup.
            val configured = url != null && state != STATE_GONE
            views.setOnClickPendingIntent(R.id.widget_root, openIntent(context, configured))
            views.setContentDescription(
                R.id.widget_root,
                context.getString(if (configured) R.string.plan_widget_open else R.string.plan_widget_setup_title),
            )

            val message = when {
                url == null -> context.getString(R.string.plan_widget_setup)
                state == STATE_GONE -> context.getString(R.string.plan_widget_gone)
                data == null && state == STATE_OFFLINE -> context.getString(R.string.plan_widget_offline)
                data != null && data.items.isEmpty() -> context.getString(R.string.plan_widget_empty)
                else -> null
            }
            views.setViewVisibility(R.id.widget_message, if (message == null) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.widget_message, message ?: "")

            val shown = if (configured) data?.items.orEmpty().take(PlanWidgetModel.MAX_ROWS) else emptyList()
            var late = 0
            data?.items?.forEach { item ->
                val days = PlanWidgetModel.daysUntil(item.date, today)
                if (days != null && days < 0) late++
            }
            ROWS.forEachIndexed { index, slot ->
                val item = shown.getOrNull(index)
                if (item == null) {
                    views.setViewVisibility(slot.row, View.GONE)
                    return@forEachIndexed
                }
                views.setViewVisibility(slot.row, View.VISIBLE)
                views.setTextViewText(slot.title, item.title)
                val date = runCatching {
                    LocalDate.parse(item.date).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
                }.getOrDefault(item.date)
                val blocked = if (item.status == "blocked") "Blocked · " else ""
                views.setTextViewText(slot.meta, "$blocked${item.project ?: "No project"} · $date")
                val days = PlanWidgetModel.daysUntil(item.date, today)
                views.setTextViewText(slot.whenPill, days?.let(PlanWidgetModel::whenText) ?: item.date)
                val pill = when (days?.let(PlanWidgetModel::tone)) {
                    PlanWidgetModel.Tone.LATE -> R.drawable.widget_pill_late
                    PlanWidgetModel.Tone.SOON -> R.drawable.widget_pill_soon
                    else -> R.drawable.widget_pill_later
                }
                views.setInt(slot.whenPill, "setBackgroundResource", pill)
                views.setTextColor(
                    slot.whenPill,
                    context.getColor(if (pill == R.drawable.widget_pill_late) R.color.widget_on_fill else R.color.widget_text),
                )
            }

            val lateShown = configured && late > 0
            views.setViewVisibility(R.id.widget_late, if (lateShown) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.widget_late, "$late late")

            val hidden = (data?.items?.size ?: 0) - shown.size
            val footer = buildList {
                if (configured && hidden > 0) add("+$hidden more")
                if (configured && (data?.undated ?: 0) > 0) add("+${data?.undated} without a date")
            }.joinToString(" · ")
            views.setTextViewText(R.id.widget_undated, footer)

            manager.updateAppWidget(ids, views)
        }
    }
}
