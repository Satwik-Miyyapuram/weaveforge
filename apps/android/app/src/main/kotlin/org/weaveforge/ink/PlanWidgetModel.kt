package org.weaveforge.ink

import org.json.JSONObject
import java.net.URI
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The home screen deadlines widget, minus Android: the feed link it accepts,
 * the `widget.json` it reads, and the words it shows. Kept free of Android
 * types so the rules are a plain JVM test, like [InkGestureRouter].
 *
 * The data is the plan feed's `widget.json` (`packages/core/src/plan-feed.ts`,
 * `planWidgetData`): the same file a Rainmeter skin or a wallpaper page reads.
 */
object PlanWidgetModel {
    /** Rows the widget has room for at its default 4×2 size. */
    const val MAX_ROWS = 4

    data class Item(
        val id: String,
        val title: String,
        val project: String?,
        /** `YYYY-MM-DD`, the milestone's target date. */
        val date: String,
        val status: String,
    )

    data class Data(val items: List<Item>, val undated: Int)

    /**
     * The `widget.json` URL for whatever feed link the user pasted, or null.
     *
     * Settings → Calendar shows the calendar link first, so that is the one
     * people copy: `deadlines.ics`, maybe as `webcal://`, maybe with options
     * in the query. All of them name the same token; the widget wants its own
     * file. The query is dropped because the widget's options are not the
     * calendar's.
     *
     * The host must be one this build may load. The link is a credential, and
     * a widget that fetched any URL pasted into it would send it anywhere.
     */
    fun widgetUrl(input: String, allowedHosts: Collection<String>, allowCleartext: Boolean = false): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        val uri = runCatching { URI(trimmed.replaceFirst(Regex("^webcal://", RegexOption.IGNORE_CASE), "https://")) }
            .getOrNull() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (allowedHosts.none { host == it || host.endsWith(".$it") }) return null
        val scheme = uri.scheme?.lowercase()
        // Plain http only in a build that was itself pointed at an http address.
        if (scheme != "https" && !(scheme == "http" && allowCleartext)) return null
        val match = FEED_PATH.matchEntire(uri.rawPath ?: "") ?: return null
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "$scheme://$host$port/api/plan/feed/${match.groupValues[1]}/widget.json"
    }

    /** The feed's `widget.json`, or null if it is not one. Unknown fields are ignored. */
    fun parse(json: String): Data? = runCatching {
        val root = JSONObject(json)
        val array = root.getJSONArray("items")
        val items = (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val date = item.optString("date").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            Item(
                id = item.optString("id"),
                title = item.optString("title").ifEmpty { "Untitled milestone" },
                project = if (item.isNull("project")) null else item.optString("project").ifEmpty { null },
                date = date,
                status = item.optString("status"),
            )
        }
        Data(items, root.optInt("undated", 0))
    }.getOrNull()

    private val FEED_PATH = Regex("/api/plan/feed/([A-Za-z0-9_\\-]+)/(?:deadlines\\.ics|widget\\.json)/?")

    /**
     * Days from [today] to [date]; negative when late. Counted on the phone,
     * not taken from the file, because the file is cached and today moves.
     */
    fun daysUntil(date: String, today: LocalDate): Long? =
        runCatching { ChronoUnit.DAYS.between(today, LocalDate.parse(date)) }.getOrNull()

    /** The pill: the same words as the desktop widget. */
    fun whenText(days: Long): String = when {
        days == 0L -> "Today"
        days == 1L -> "Tomorrow"
        days == -1L -> "1 day late"
        days < 0 -> "${-days} days late"
        days < 14 -> "$days days"
        else -> "${Math.round(days / 7.0)} weeks"
    }

    enum class Tone { LATE, SOON, LATER }

    fun tone(days: Long): Tone = when {
        days < 0 -> Tone.LATE
        days <= 3 -> Tone.SOON
        else -> Tone.LATER
    }
}
