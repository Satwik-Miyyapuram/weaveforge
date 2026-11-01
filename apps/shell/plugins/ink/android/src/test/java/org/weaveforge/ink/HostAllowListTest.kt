package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one host match the shell, the widget setup and the widget model share
 * (42-15): a host is allowed when it is a listed host or a subdomain of one.
 */
class HostAllowListTest {
    private val hosts = HostAllowList.parse("weaveforge.org, Google.com,,  ")

    @Test
    fun `the build list is trimmed, lower-cased and has no blanks`() {
        assertEquals(setOf("weaveforge.org", "google.com"), hosts)
        assertEquals(emptySet<String>(), HostAllowList.parse(""))
    }

    @Test
    fun `a listed host and its subdomains are allowed, in any case`() {
        assertTrue(HostAllowList.allows("weaveforge.org", hosts))
        assertTrue(HostAllowList.allows("app.weaveforge.org", hosts))
        assertTrue(HostAllowList.allows("APP.WeaveForge.org", hosts))
        assertTrue(HostAllowList.allows("accounts.google.com", hosts))
    }

    @Test
    fun `a look-alike host is refused`() {
        assertFalse(HostAllowList.allows("evilweaveforge.org", hosts))
        assertFalse(HostAllowList.allows("evil-weaveforge.org", hosts))
        assertFalse(HostAllowList.allows("weaveforge.org.evil.example", hosts))
        assertFalse(HostAllowList.allows("example.com", hosts))
    }

    @Test
    fun `no host is refused`() {
        assertFalse(HostAllowList.allows(null, hosts))
        assertFalse(HostAllowList.allows("", hosts))
        assertFalse(HostAllowList.allows("weaveforge.org", emptySet()))
    }
}
