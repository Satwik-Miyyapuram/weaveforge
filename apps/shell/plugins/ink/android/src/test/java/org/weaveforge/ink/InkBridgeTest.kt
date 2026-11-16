package org.weaveforge.ink

import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class InkBridgeTest {
    @Test
    fun penAndHighlighterInk() {
        assertEquals(InkToolMode.INK, InkBridge.modeFor("pen"))
        assertEquals(InkToolMode.INK, InkBridge.modeFor("highlighter"))
    }

    @Test
    fun otherToolsLeaveThePenToThePage() {
        for (tool in listOf("select", "eraser", "", "Pen", "lasso")) {
            assertEquals(tool, InkToolMode.NONE, InkBridge.modeFor(tool))
        }
    }

    @Test
    fun coloursParseAndBadOnesAreBlack() {
        assertEquals(Color.RED, InkBridge.parseColour("#FF0000"))
        assertEquals(0x80112233.toInt(), InkBridge.parseColour("#80112233"))
        assertEquals(Color.BLACK, InkBridge.parseColour("not a colour"))
        assertEquals(Color.BLACK, InkBridge.parseColour(""))
    }

    @Test
    fun strokeScriptCallsThePageOnlyIfItListens() {
        assertEquals(
            "typeof window.onNativeStrokeComplete === 'function' && window.onNativeStrokeComplete([1,2,0.5,10])",
            InkBridge.strokeScript("[1,2,0.5,10]"),
        )
    }

    @Test
    fun theWebAppFindsTheBridgeByTheOldName() {
        assertEquals("AndroidInkingBridge", InkBridge.NAME)
    }
}
