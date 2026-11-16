package org.weaveforge.ink

/**
 * One account-picker request: the page gets exactly one answer.
 *
 * Some phones kill the system account sheet as it opens, and then Credential
 * Manager never calls back. [abandon] answers the page with an error (so it
 * falls back to the web sign-in) and cancels the request; whichever of the
 * real answer or the abandon comes first wins.
 */
class PendingPick(private val post: (String) -> Unit, private val cancel: () -> Unit) {
    var isSettled = false
        private set

    fun settle(message: String): Boolean {
        if (isSettled) return false
        isSettled = true
        runCatching { post(message) }
        return true
    }

    fun abandon(): Boolean {
        if (!settle(GoogleSignInMessages.failed("error"))) return false
        runCatching { cancel() }
        return true
    }
}
