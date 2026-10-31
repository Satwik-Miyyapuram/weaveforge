package org.weaveforge.ink

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin

/** Puts the pen surface over Tauri's WebView and gives the page the old app's ink bridge. */
@TauriPlugin
class InkPlugin(private val activity: Activity) : Plugin(activity) {
    /** The gesture parent, once [load] has run. */
    var gesture: InkGestureView? = null
        private set
    private var webView: WebView? = null
    private val accountPicker = GoogleAccountPicker(activity)

    /**
     * Tauri calls this once the WebView exists. The reparenting lives in [InkLayers] and
     * the settings in [InkWebSettings] so both can be tested without Tauri.
     */
    @SuppressLint("JavascriptInterface")
    override fun load(webView: WebView) {
        activity.runOnUiThread {
            val gesture = InkLayers.install(webView)
            this.gesture = gesture
            this.webView = webView
            InkWebSettings.apply(webView)
            webView.addJavascriptInterface(InkBridge(gesture), InkBridge.NAME)
            accountPicker.install(webView, InkRoute.APP_ORIGIN)
            gesture.overlay.onStrokeFinished = { pointsJson ->
                activity.runOnUiThread { webView.evaluateJavascript(InkBridge.strokeScript(pointsJson), null) }
            }
            // A widget tap that cold-started the app asks for its page here.
            val route = InkRoute.url(activity.intent?.getStringExtra(InkRoute.EXTRA_ROUTE))
            activity.intent?.removeExtra(InkRoute.EXTRA_ROUTE)
            // A JS interface shows up only on the next page load.
            if (route != null) webView.loadUrl(route) else if (webView.url != null) webView.reload()
        }
    }

    /** A widget tap while the app runs: open the page it asks for. */
    override fun onNewIntent(intent: Intent) {
        val url = InkRoute.url(intent.getStringExtra(InkRoute.EXTRA_ROUTE)) ?: return
        webView?.loadUrl(url)
    }

    /** The account sheet covers the activity, so a resume means it closed. */
    override fun onResume(activity: AppCompatActivity) {
        accountPicker.onResume()
        super.onResume(activity)
    }

    /** The activity is finishing: break the bridge and overlay cycle (see [InkTeardown]). */
    override fun onDestroy(activity: AppCompatActivity) {
        val webView = webView
        val gesture = gesture
        if (webView != null && gesture != null) InkTeardown.run(webView, gesture.overlay)
        this.webView = null
        this.gesture = null
        super.onDestroy(activity)
    }
}
