package org.weaveforge.ink

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.SafeBrowsingResponse
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import java.net.URI

/**
 * The Android inking shell (docs/internal/design/ink-native-bridges.md §2).
 *
 * The whole app is the web app, loaded in a WebView; this activity adds one
 * thing over it, the [InkingOverlayView], and the bridge the web side uses to
 * tell the overlay where the page is and what the pen looks like. A finished
 * stroke goes back as `window.onNativeStrokeComplete([x, y, p, t, ...])`.
 *
 * ## Why this activity has a navigation policy
 *
 * `addJavascriptInterface` grants a capability to the *WebView*, not to an
 * origin: every document that loads in it can call `window.AndroidInkingBridge`.
 * With the default `WebViewClient` — whose `shouldOverrideUrlLoading` returns
 * `false`, i.e. "load everything here" — an OAuth redirect, a DOI link in a
 * paper, a collaborator's `<a href>` in a shared note and an attacker's page
 * opened from a search result are all callers. Android's own lint names
 * untrusted content in a WebView that has a JS interface as the most common
 * WebView vulnerability, and this shell is a browser without the browser's
 * security UI: no padlock, no origin indicator, no safe-browsing interstitial
 * unless one is asked for.
 *
 * So the policy is an explicit host allow-list, decided at build time from the
 * URL the shell was built to load (see `app/build.gradle.kts`). Nothing a page
 * contains can extend it.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var inkOverlay: InkingOverlayView
    private lateinit var inkGesture: InkGestureView

    /** The hosts the shell may load, from the build that produced it. */
    private val allowedHosts: Set<String> =
        BuildConfig.ALLOWED_HOSTS.split(',')
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()

    private fun isAllowed(uri: Uri?): Boolean {
        val host = uri?.host?.lowercase() ?: return false
        return allowedHosts.any { host == it || host.endsWith(".$it") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        inkOverlay = findViewById(R.id.inkOverlay)

        // The parent decides which layer a touch stream belongs to. It is wired from
        // the layout's ids rather than by child index, so the arrangement inside
        // `InkGestureView` is not load-bearing.
        inkGesture = findViewById(R.id.inkGesture)
        inkGesture.webView = webView
        inkGesture.overlay = inkOverlay

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // A tap is required before anything plays. Off, any loaded page could
            // start audio and video unprompted — and a note can carry a
            // collaborator's link.
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // A WebView is a browser minus the security UI; safe browsing is the
            // one interstitial it can still show, so it is asked for explicitly.
            setSafeBrowsingEnabled(true)
            // The shell loads one first-party origin. It has no reason to reach
            // the filesystem or a content provider, and file: URLs are a
            // long-standing WebView escalation path.
            //
            // `setAllowFileAccessFromFileURLs` and `setAllowUniversalAccessFromFileURLs`
            // are deliberately not set: both are deprecated no-ops at minSdk 29 and
            // above, which is where this module starts. Setting them compiles with a
            // warning and does nothing, so they were removed rather than left in as
            // reassurance — `allowFileAccess = false` is what actually closes the path.
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            // The web app checks for the bridge object, not the UA, but a
            // distinct token makes the shell visible in logs.
            userAgentString = "$userAgentString WeaveForgeInk/${BuildConfig.VERSION_NAME}"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val uri = request?.url
                if (isAllowed(uri)) return false
                // Refused, not handed to another app: the shell is a viewer for
                // one origin, and an off-origin document must never reach a
                // WebView that has the ink bridge attached. Loads of
                // `about:blank` are teardown and are allowed through.
                if (uri?.scheme != "about") {
                    Log.w(TAG, "Refused navigation to ${uri?.host ?: "an unknown host"}")
                }
                return uri?.scheme != "about"
            }

            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?,
            ): WebResourceResponse? {
                // Sub-resources too: a page on an allowed origin can point a
                // script or an image at an internal host, and that request would
                // otherwise go out with the shell's network identity.
                val uri = request?.url
                if (request?.isForMainFrame == true || isAllowed(uri)) return null
                if (uri?.scheme == "data" || uri?.scheme == "blob") return null
                Log.w(TAG, "Blocked sub-resource from ${uri?.host ?: "an unknown host"}")
                return WebResourceResponse("text/plain", "utf-8", null)
            }

            override fun onSafeBrowsingHit(
                view: WebView?,
                request: WebResourceRequest?,
                threatType: Int,
                callback: SafeBrowsingResponse?,
            ) {
                // Back to safety rather than proceeding: the user has no address
                // bar here to tell them where they are.
                callback?.backToSafety(true)
            }
        }

        // Installed only for an allowed document. `doUpdateVisitedHistory` fires
        // on every navigation, including history moves and redirects, so the
        // interface is present exactly while the loaded origin may use it.
        webView.addJavascriptInterface(NativeBridge(inkOverlay, inkGesture), BRIDGE_NAME)

        inkOverlay.onStrokeFinished = { pointsJson ->
            runOnUiThread {
                webView.evaluateJavascript(
                    "typeof window.onNativeStrokeComplete === 'function' && window.onNativeStrokeComplete($pointsJson)",
                    null,
                )
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) webView.loadUrl(routeUrl(intent) ?: BuildConfig.APP_URL)
        else webView.restoreState(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        routeUrl(intent)?.let(webView::loadUrl)
    }

    /**
     * The page a launch asks for, such as the deadlines widget opening the plan.
     * Only a named route on the app's own address: the extra picks one of a
     * fixed set, never a URL, so nothing that can start this activity can point
     * the WebView elsewhere.
     */
    private fun routeUrl(intent: Intent?): String? {
        val path = when (intent?.getStringExtra(EXTRA_ROUTE)) {
            ROUTE_PLAN -> "/plan"
            else -> return null
        }
        val url = runCatching { URI(BuildConfig.APP_URL).resolve(path).toString() }.getOrNull() ?: return null
        return url.takeIf { isAllowed(Uri.parse(it)) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    /**
     * The WebView teardown checklist, in order.
     *
     * `destroy()` releases the native engine but not the Java-side graph that
     * points at it. A WebView holds a strong reference to every
     * `@JavascriptInterface` object, and [NativeBridge] holds the overlay, whose
     * `onStrokeFinished` lambda captures this activity's `webView` — three
     * objects holding each other, none released, so the whole activity (layout,
     * WebView, renderer, DOM) survives a destroy until the process is killed.
     * The front-buffered renderer also keeps a callback that would otherwise
     * outlive the surface.
     *
     * (The activity already declares `configChanges` for orientation, so a rotate
     * is not a destroy at all; this path is a real finish, a task removal or a
     * low-memory kill.)
     */
    override fun onDestroy() {
        // Break the callback cycle first, so nothing can post into a dead renderer.
        inkOverlay.release()
        // Detach the capability before the page can be reloaded by anything else.
        webView.removeJavascriptInterface(BRIDGE_NAME)
        webView.stopLoading()
        webView.loadUrl("about:blank")
        webView.removeAllViews()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    /**
     * What `window.AndroidInkingBridge` is on the web side. Every method runs on
     * the WebView's JavaScript thread, so anything touching the view is posted
     * to the main thread. Only primitives cross; the viewport is five numbers.
     *
     * The interface is installed for the whole life of the WebView today, which
     * is safe only because the navigation policy above confines that WebView to
     * one origin. If this bridge ever grows a method that touches storage, the
     * same origin gate has to be re-argued for it rather than assumed.
     */
    class NativeBridge(
        private val overlay: InkingOverlayView,
        private val gesture: InkGestureView,
    ) {
        /**
         * Which tool is selected, and whether the page is pen-only.
         *
         * The tool name is what decides gesture routing, so it has to cross the
         * bridge: with Select chosen the pen manipulates the page and nothing inks,
         * and with Pen or Highlighter chosen the pen writes while one finger still
         * moves the paper and two still move and zoom it.
         *
         * Setting this through [setTool] would tie routing to a colour pick — the ink
         * bar calls `setTool` for a width change too — so the mode is its own call.
         * That also keeps the ink bar's own separation ("no tool selected" is a state,
         * not a colour) visible on this side.
         */
        @JavascriptInterface
        fun setToolMode(tool: String, penOnly: Boolean) {
            val mode = if (tool == "pen" || tool == "highlighter") {
                InkToolMode.INK
            } else {
                InkToolMode.NONE
            }
            gesture.post {
                gesture.toolMode = mode
                overlay.penOnly = penOnly
            }
        }

        @JavascriptInterface
        fun setViewport(left: Float, top: Float, width: Float, height: Float, dpr: Float) {
            overlay.post { overlay.setViewport(left * dpr, top * dpr, width * dpr, height * dpr) }
        }

        @JavascriptInterface
        fun clearViewport() {
            overlay.post { overlay.clearViewport() }
        }

        @JavascriptInterface
        fun setTool(colourArgb: String, widthPx: Float) {
            val colour = try {
                Color.parseColor(colourArgb)
            } catch (_: IllegalArgumentException) {
                Color.BLACK
            }
            overlay.post { overlay.setPenStyle(colour, widthPx) }
        }

        /**
         * Retained because the web side still calls it, and because pen-only is a
         * real preference. It no longer decides gesture ownership: that is the tool
         * mode's job, so a finger still moves the paper in pen-only mode.
         */
        @JavascriptInterface
        fun setPenOnly(enabled: Boolean) {
            overlay.post { overlay.penOnly = enabled }
        }

        @JavascriptInterface
        fun setHandedness(hand: String) {
            overlay.post { overlay.leftHanded = hand == "left" }
        }

        @JavascriptInterface
        fun clearOverlay() {
            overlay.post { overlay.clear() }
        }
    }

    companion object {
        private const val TAG = "WeaveForgeInk"
        private const val BRIDGE_NAME = "AndroidInkingBridge"

        /** Which page to open; one of the `ROUTE_*` names. */
        const val EXTRA_ROUTE = "org.weaveforge.ink.ROUTE"
        const val ROUTE_PLAN = "plan"
    }
}
