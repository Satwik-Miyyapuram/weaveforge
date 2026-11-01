package org.weaveforge.ink

import android.webkit.WebView

/**
 * Undoes what [InkPlugin.load] added, in the old app's order: the overlay first, so no
 * stroke posts into a dead renderer, then the bridge. The bridge holds the overlay and the
 * overlay's callback holds the WebView, so skipping this keeps the activity alive.
 * Tauri owns the WebView itself and destroys it; this leaves that to Tauri.
 */
object InkTeardown {
    /** Must run on the UI thread. Safe to call twice. */
    fun run(webView: WebView, overlay: InkingOverlayView) {
        overlay.release()
        webView.removeJavascriptInterface(InkBridge.NAME)
    }
}
