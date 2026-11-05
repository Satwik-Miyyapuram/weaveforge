package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InkRouteTest {
    @Test
    fun planRouteOpensThePlanPageOnTheAppOrigin() {
        assertEquals("https://app.localhost/plan", InkRoute.url(InkRoute.ROUTE_PLAN))
    }

    @Test
    fun noRouteOrAnUnknownOneOpensNothing() {
        assertNull(InkRoute.url(null))
        assertNull(InkRoute.url(""))
        assertNull(InkRoute.url("settings"))
        assertNull(InkRoute.url("https://evil.example/plan"))
    }

    @Test
    fun extraNameMatchesTheOldAppSoPinnedWidgetsKeepWorking() {
        assertEquals("org.weaveforge.ink.ROUTE", InkRoute.EXTRA_ROUTE)
        assertEquals("plan", InkRoute.ROUTE_PLAN)
    }
}
