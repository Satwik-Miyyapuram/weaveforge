package org.weaveforge.ink

import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The account picker's pure parts. The page receives the raw nonce; Google
 * signs its SHA-256 into the ID token, and the auth server checks the two match.
 */
object GoogleSignInMessages {
    private val random = SecureRandom()

    fun newNonce(): String = ByteArray(32).also(random::nextBytes).toHex()

    fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).toHex()

    /** `https://host[:port]` of an https address, else null: the one origin allowed to ask. */
    fun originOf(url: String): String? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        val host = uri.host?.lowercase() ?: return null
        return if (uri.port == -1) "https://$host" else "https://$host:${uri.port}"
    }

    fun signedIn(idToken: String, nonce: String): String =
        JSONObject().put("status", "signed-in").put("idToken", idToken).put("nonce", nonce).toString()

    fun cancelled(): String = JSONObject().put("status", "cancelled").toString()

    fun failed(reason: String): String = JSONObject().put("status", "failed").put("reason", reason).toString()

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
