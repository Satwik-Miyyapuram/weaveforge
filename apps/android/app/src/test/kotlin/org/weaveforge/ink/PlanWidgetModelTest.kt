package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

/**
 * The deadlines widget's rules: which pasted links it accepts, how it reads
 * `widget.json`, and the words on each row.
 */
class PlanWidgetModelTest {
    private val hosts = listOf("weaveforge.org")
    private val token = "tt_AbC-12_x"

    @Test
    fun `the calendar link becomes the widget link`() {
        val expected = "https://app.weaveforge.org/api/plan/feed/$token/widget.json"
        assertEquals(expected, PlanWidgetModel.widgetUrl("https://app.weaveforge.org/api/plan/feed/$token/deadlines.ics", hosts))
        assertEquals(expected, PlanWidgetModel.widgetUrl("  webcal://app.weaveforge.org/api/plan/feed/$token/deadlines.ics  ", hosts))
        assertEquals(expected, PlanWidgetModel.widgetUrl("https://app.weaveforge.org/api/plan/feed/$token/deadlines.ics?days=90", hosts))
        assertEquals(expected, PlanWidgetModel.widgetUrl(expected, hosts))
    }

    @Test
    fun `a link to another host or path is refused`() {
        assertNull(PlanWidgetModel.widgetUrl("https://evil.example/api/plan/feed/$token/deadlines.ics", hosts))
        assertNull(PlanWidgetModel.widgetUrl("https://weaveforge.org.evil.example/api/plan/feed/$token/widget.json", hosts))
        assertNull(PlanWidgetModel.widgetUrl("https://app.weaveforge.org/api/other/$token/widget.json", hosts))
        assertNull(PlanWidgetModel.widgetUrl("https://app.weaveforge.org/api/plan/feed/a%2Fb/widget.json", hosts))
        assertNull(PlanWidgetModel.widgetUrl("", hosts))
        assertNull(PlanWidgetModel.widgetUrl("not a link", hosts))
    }

    @Test
    fun `plain http only when the build allows it`() {
        val link = "http://192.168.1.10:3000/api/plan/feed/$token/deadlines.ics"
        val lan = listOf("192.168.1.10")
        assertNull(PlanWidgetModel.widgetUrl(link, lan))
        assertEquals(
            "http://192.168.1.10:3000/api/plan/feed/$token/widget.json",
            PlanWidgetModel.widgetUrl(link, lan, allowCleartext = true),
        )
    }

    @Test
    fun `parse keeps dated items and counts the undated`() {
        val data = PlanWidgetModel.parse(
            """
            {"items":[
              {"id":"a","title":"Draft","project":"Thesis","date":"2026-10-01","status":"planned"},
              {"id":"b","title":"","project":null,"date":"2026-10-02","status":"blocked"},
              {"id":"c","title":"No date"}
            ],"undated":3,"extra":true}
            """.trimIndent(),
        )!!
        assertEquals(listOf("a", "b"), data.items.map { it.id })
        assertEquals("Thesis", data.items[0].project)
        assertEquals("Untitled milestone", data.items[1].title)
        assertNull(data.items[1].project)
        assertEquals(3, data.undated)
        assertNull(PlanWidgetModel.parse("<html>"))
        assertNull(PlanWidgetModel.parse("{}"))
    }

    @Test
    fun `when words and tones match the desktop widget`() {
        val today = LocalDate.of(2026, 9, 26)
        assertEquals(-6L, PlanWidgetModel.daysUntil("2026-09-20", today))
        assertNull(PlanWidgetModel.daysUntil("soon", today))
        assertEquals("Today", PlanWidgetModel.whenText(0))
        assertEquals("Tomorrow", PlanWidgetModel.whenText(1))
        assertEquals("1 day late", PlanWidgetModel.whenText(-1))
        assertEquals("6 days late", PlanWidgetModel.whenText(-6))
        assertEquals("13 days", PlanWidgetModel.whenText(13))
        assertEquals("2 weeks", PlanWidgetModel.whenText(14))
        assertEquals(PlanWidgetModel.Tone.LATE, PlanWidgetModel.tone(-1))
        assertEquals(PlanWidgetModel.Tone.SOON, PlanWidgetModel.tone(3))
        assertEquals(PlanWidgetModel.Tone.LATER, PlanWidgetModel.tone(4))
    }
}
