package org.weaveforge.ink

import android.view.View
import android.webkit.CookieManager
import android.webkit.WebView

/** The old app's WebView settings, applied to Tauri's WebView. */
object InkWebSettings {

    /** Must run on the UI thread. */
    fun apply(webView: WebView) {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            // A tap first: a note can carry a collaborator's link that would otherwise autoplay.
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            setSafeBrowsingEnabled(true)
            // One first-party origin; file: and content: are old WebView escalation paths.
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            userAgentString = chromeUserAgent(userAgentString)
        }
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = View.OVER_SCROLL_NEVER
    }

    /**
     * Google sign-in refuses WebViews ("403: disallowed_useragent") by the `; wv` and
     * `Version/x` markers; without them the agent is plain Chrome Mobile. The web app
     * finds the shell through `window.AndroidInkingBridge`, not the agent.
     */
    fun chromeUserAgent(raw: String): String =
        raw.replace("; wv", "").replace(Regex("Version/[0-9.]+ "), "")
}
