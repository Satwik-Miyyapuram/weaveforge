package org.weaveforge.ink

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout

/** Builds the old app's layer tree (activity_main.xml) around Tauri's WebView. */
object InkLayers {

    /**
     * Must run on the UI thread. Returns the InkGestureView now holding [webView].
     *
     * Idempotent: a web view already inside an InkGestureView is returned as is.
     */
    fun install(webView: WebView): InkGestureView {
        (webView.parent as? InkGestureView)?.let { return it }

        val parent = webView.parent as? ViewGroup
            ?: throw IllegalStateException("WebView has no parent")
        val index = parent.indexOfChild(webView)
        val params = webView.layoutParams
        parent.removeViewAt(index)

        // Order is load-bearing: the web view sits below and the overlay above, as in the old layout.
        val overlay = InkingOverlayView(webView.context).apply { visibility = View.GONE }
        val gesture = InkGestureView(webView.context, overlay)
        gesture.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        gesture.addView(
            overlay,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        parent.addView(gesture, index, params)
        return gesture
    }
}
