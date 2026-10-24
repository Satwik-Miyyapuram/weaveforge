package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Test

/** The stroke payload the web side's `nativeStrokeEvents` reads as `[x, y, p, t, …]`. */
class StrokeEncodingTest {

    private fun fixed(value: Float, decimals: Int) =
        StringBuilder().also { appendFixed(it, value, decimals) }.toString()

    @Test
    fun `a value between minus one and zero keeps its sign`() {
        // 42-03: the whole part of -0.5 is 0, and 0 has no sign to print.
        assertEquals("-0.50", fixed(-0.5f, 2))
        assertEquals("-0.005", fixed(-0.005f, 3))
        assertEquals("-1.25", fixed(-1.25f, 2))
    }

    @Test
    fun `zero and positive values are unchanged`() {
        assertEquals("0.00", fixed(0f, 2))
        assertEquals("0.00", fixed(-0.001f, 2))
        assertEquals("0.05", fixed(0.05f, 2))
        assertEquals("12.34", fixed(12.34f, 2))
        assertEquals("0.500", fixed(0.5f, 3))
    }

    @Test
    fun `timestamps past two to the twenty-fourth keep millisecond steps`() {
        // 42-06: a Float holds whole numbers exactly only up to 2^24 ms, about
        // 4.7 hours of uptime. Times are stored relative to the stroke's first
        // sample and the absolute uptime is restored when encoded.
        val origin = (1L shl 24) + 1
        val points = arrayListOf(1f, 2f, 0.5f, 0f, -0.5f, 2f, 0.5f, 1f)
        assertEquals(
            "[1.00,2.00,0.500,16777217,-0.50,2.00,0.500,16777218]",
            encodeStroke(points, origin),
        )
    }
}
