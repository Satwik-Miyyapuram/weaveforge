package org.weaveforge.ink

import android.view.View
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class InkWebSettingsTest {
    private val webViewUa =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36"

    @Test
    fun webViewMarkersAreStripped() {
        assertEquals(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/129.0.6668.100 Mobile Safari/537.36",
            InkWebSettings.chromeUserAgent(webViewUa),
        )
    }

    @Test
    fun aChromeAgentIsLeftAlone() {
        val chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"
        assertEquals(chrome, InkWebSettings.chromeUserAgent(chrome))
    }

    @Test
    fun settingsMatchTheOldApp() {
        val webView = WebView(ApplicationProvider.getApplicationContext())
        InkWebSettings.apply(webView)
        val s = webView.settings
        assertTrue(s.javaScriptEnabled)
        assertTrue(s.domStorageEnabled)
        assertTrue(s.mediaPlaybackRequiresUserGesture)
        assertFalse(s.allowFileAccess)
        assertFalse(s.allowContentAccess)
        assertFalse(s.supportZoom())
        assertEquals(View.OVER_SCROLL_NEVER, webView.overScrollMode)
        assertFalse(s.userAgentString.contains("; wv"))
    }
}
