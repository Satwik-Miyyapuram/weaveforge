package org.weaveforge.ink

import android.app.Activity
import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InkTeardownTest {

    private lateinit var activity: Activity
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        root = FrameLayout(activity)
        activity.setContentView(root)
        webView = WebView(activity)
        root.addView(View(activity))
        root.addView(webView, FrameLayout.LayoutParams(123, 456))
    }

    @Test
    fun teardownReleasesTheOverlayAndRemovesTheBridge() {
        val gesture = InkLayers.install(webView)
        webView.addJavascriptInterface(InkBridge(gesture), InkBridge.NAME)
        gesture.overlay.onStrokeFinished = { }
        assertNotNull(Shadows.shadowOf(webView).getJavascriptInterface(InkBridge.NAME))

        InkTeardown.run(webView, gesture.overlay)

        assertNull(gesture.overlay.onStrokeFinished)
        assertNull(Shadows.shadowOf(webView).getJavascriptInterface(InkBridge.NAME))
    }

    @Test
    fun teardownTwiceIsSafe() {
        val gesture = InkLayers.install(webView)
        webView.addJavascriptInterface(InkBridge(gesture), InkBridge.NAME)
        gesture.overlay.onStrokeFinished = { }
        assertNotNull(Shadows.shadowOf(webView).getJavascriptInterface(InkBridge.NAME))

        InkTeardown.run(webView, gesture.overlay)
        InkTeardown.run(webView, gesture.overlay)

        assertNull(gesture.overlay.onStrokeFinished)
        assertNull(Shadows.shadowOf(webView).getJavascriptInterface(InkBridge.NAME))
    }
}
