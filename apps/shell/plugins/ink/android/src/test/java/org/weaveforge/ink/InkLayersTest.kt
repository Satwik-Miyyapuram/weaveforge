package org.weaveforge.ink

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InkLayersTest {

    private lateinit var activity: Activity
    private lateinit var root: FrameLayout
    private lateinit var before: View
    private lateinit var webView: WebView
    private lateinit var after: View

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        root = FrameLayout(activity)
        activity.setContentView(root)
        before = View(activity)
        webView = WebView(activity)
        val params = FrameLayout.LayoutParams(123, 456)
        after = View(activity)
        root.addView(before)
        root.addView(webView, params)
        root.addView(after)
    }

    @Test
    fun wrapsTheWebViewInPlace() {
        val gesture = InkLayers.install(webView)

        assertEquals(3, root.childCount)
        assertSame(before, root.getChildAt(0))
        assertSame(gesture, root.getChildAt(1))
        assertSame(after, root.getChildAt(2))

        assertEquals(123, gesture.layoutParams.width)
        assertEquals(456, gesture.layoutParams.height)

        assertEquals(2, gesture.childCount)
        assertSame(webView, gesture.getChildAt(0))
        assertTrue(gesture.getChildAt(1) is InkingOverlayView)

        val overlay = gesture.getChildAt(1) as InkingOverlayView
        assertEquals(View.GONE, overlay.visibility)

        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, webView.layoutParams.width)
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, webView.layoutParams.height)
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, overlay.layoutParams.width)
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, overlay.layoutParams.height)
    }

    @Test
    fun installTwiceIsANoOp() {
        val first = InkLayers.install(webView)
        val second = InkLayers.install(webView)

        assertNotNull(first)
        assertSame(first, second)
        assertEquals(3, root.childCount)
        assertEquals(2, first.childCount)
    }

    @Test
    fun webViewWithoutParentThrows() {
        val lone = WebView(activity)

        assertThrows(IllegalStateException::class.java) { InkLayers.install(lone) }
    }
}
