package org.weaveforge.ink

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * The Android inking shell (docs/internal/design/ink-native-bridges.md §2).
 *
 * The whole app is the web app, loaded in a WebView; this activity adds one
 * thing over it, the [InkingOverlayView], and the bridge the web side uses to
 * tell the overlay where the page is and what the pen looks like. A finished
 * stroke goes back as `window.onNativeStrokeComplete([x, y, p, t, ...])`.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var inkOverlay: InkingOverlayView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        inkOverlay = findViewById(R.id.inkOverlay)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // The web app checks for the bridge object, not the UA, but a
            // distinct token makes the shell visible in logs.
            userAgentString = "$userAgentString WeaveForgeInk/${BuildConfig.VERSION_NAME}"
        }
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(NativeBridge(inkOverlay), "AndroidInkingBridge")

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

        if (savedInstanceState == null) webView.loadUrl(BuildConfig.APP_URL)
        else webView.restoreState(savedInstanceState)
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

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /**
     * What `window.AndroidInkingBridge` is on the web side. Every method runs on
     * the WebView's JavaScript thread, so anything touching the view is posted
     * to the main thread. Only primitives cross; the viewport is five numbers.
     */
    class NativeBridge(private val overlay: InkingOverlayView) {
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
}
