package org.weaveforge.ink

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The account picker's pure parts: the nonce Google signs into the ID token,
 * the one origin allowed to ask for a token, and the replies the page reads.
 */
class GoogleSignInMessagesTest {
    @Test
    fun `a nonce is 64 hex characters and never repeats`() {
        val a = GoogleSignInMessages.newNonce()
        val b = GoogleSignInMessages.newNonce()
        assertTrue(a.matches(Regex("[0-9a-f]{64}")))
        assertNotEquals(a, b)
    }

    @Test
    fun `the hashed nonce is lower-case SHA-256 hex`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            GoogleSignInMessages.sha256Hex("abc"),
        )
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            GoogleSignInMessages.sha256Hex(""),
        )
    }

    @Test
    fun `only an https app address gives an origin`() {
        assertEquals("https://app.weaveforge.org", GoogleSignInMessages.originOf("https://app.weaveforge.org"))
        assertEquals("https://app.weaveforge.org", GoogleSignInMessages.originOf("https://App.WeaveForge.org/papers?x=1#y"))
        assertEquals("https://dev.test:8443", GoogleSignInMessages.originOf("https://dev.test:8443/"))
        assertNull(GoogleSignInMessages.originOf("http://app.weaveforge.org"))
        assertNull(GoogleSignInMessages.originOf("javascript:alert(1)"))
        assertNull(GoogleSignInMessages.originOf("not a url"))
        assertNull(GoogleSignInMessages.originOf(""))
    }

    @Test
    fun `a signed-in reply carries the token and the raw nonce`() {
        val reply = JSONObject(GoogleSignInMessages.signedIn("h.p.s", "abc"))
        assertEquals("signed-in", reply.getString("status"))
        assertEquals("h.p.s", reply.getString("idToken"))
        assertEquals("abc", reply.getString("nonce"))
    }

    @Test
    fun `cancel and failure replies carry no token`() {
        val cancelled = JSONObject(GoogleSignInMessages.cancelled())
        assertEquals("cancelled", cancelled.getString("status"))
        assertFalse(cancelled.has("idToken"))
        val failed = JSONObject(GoogleSignInMessages.failed("no \"account\""))
        assertEquals("failed", failed.getString("status"))
        assertEquals("no \"account\"", failed.getString("reason"))
        assertFalse(failed.has("idToken"))
    }
}
