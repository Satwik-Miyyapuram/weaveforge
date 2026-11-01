package org.weaveforge.ink

import android.graphics.Color
import android.view.View
import android.webkit.JavascriptInterface

/**
 * `window.AndroidInkingBridge`: the calls the web app's ink bar makes, unchanged from
 * the old app's `MainActivity.NativeBridge` so the web side needs no change.
 *
 * The interface lives as long as the WebView. That is safe only because the shell's
 * navigation rule keeps that WebView on the app's own origin; a method that touches
 * storage would have to re-argue that gate.
 */
class InkBridge(private val gesture: InkGestureView) {
    private val overlay = gesture.overlay

    /** Which tool is selected; pen and highlighter ink, anything else leaves the page to the pen. */
    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun setToolMode(tool: String, penOnly: Boolean) {
        val mode = modeFor(tool)
        gesture.post {
            gesture.toolMode = mode
            overlay.visibility = if (mode == InkToolMode.INK) View.VISIBLE else View.GONE
        }
    }

    /** Where the page is, in CSS pixels; scaled to device pixels here. */
    @JavascriptInterface
    fun setViewport(left: Float, top: Float, width: Float, height: Float, dpr: Float) {
        overlay.post { overlay.setViewport(left * dpr, top * dpr, width * dpr, height * dpr) }
    }

    /** No page to ink on. */
    @JavascriptInterface
    fun clearViewport() {
        overlay.post { overlay.clearViewport() }
    }

    /** Pen colour (any `Color.parseColor` form; black if it does not parse) and width. */
    @JavascriptInterface
    fun setTool(colourArgb: String, widthPx: Float) {
        val colour = parseColour(colourArgb)
        overlay.post { overlay.setPenStyle(colour, widthPx) }
    }

    /** A no-op the web side still calls; its own gate enforces pen-only. */
    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun setPenOnly(enabled: Boolean) = Unit

    /** A no-op: no rest-zone heuristic reads it yet. */
    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun setHandedness(hand: String) = Unit

    /** Drops the strokes still on the overlay. */
    @JavascriptInterface
    fun clearOverlay() {
        overlay.post { overlay.clear() }
    }

    companion object {
        /** The name the web app looks for. */
        const val NAME = "AndroidInkingBridge"

        /** Pen and highlighter ink; every other tool leaves the pen to the page. */
        fun modeFor(tool: String): InkToolMode =
            if (tool == "pen" || tool == "highlighter") InkToolMode.INK else InkToolMode.NONE

        /** The colour, or black when the web side sends something unparseable. */
        fun parseColour(value: String): Int =
            // parseColor("") throws StringIndexOutOfBounds, not IllegalArgument.
            if (value.isEmpty()) Color.BLACK else try {
                Color.parseColor(value)
            } catch (_: IllegalArgumentException) {
                Color.BLACK
            }

        /** The script that hands a finished stroke to the page, if the page listens. */
        fun strokeScript(pointsJson: String): String =
            "typeof window.onNativeStrokeComplete === 'function' && window.onNativeStrokeComplete($pointsJson)"
    }
}
