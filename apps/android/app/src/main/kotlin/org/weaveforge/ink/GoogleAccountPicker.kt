package org.weaveforge.ink

import android.app.Activity
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Google sign-in through the system account sheet instead of a password page.
 *
 * The page sees `window.AndroidGoogleSignIn` only on the app's own origin and
 * only in the top frame: WebView enforces the origin rule, so a Google or
 * third-party page in the same WebView can neither ask nor read the reply.
 */
class GoogleAccountPicker(private val activity: Activity) {
    private val credentials by lazy { CredentialManager.create(activity) }
    private val handler = Handler(Looper.getMainLooper())
    private var pending: PendingPick? = null

    fun install(webView: WebView, appUrl: String) {
        val origin = GoogleSignInMessages.originOf(appUrl) ?: return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, CHANNEL, setOf(origin)) { _, message, _, isMainFrame, reply ->
            if (isMainFrame && message.data == REQUEST) pick(reply)
        }
    }

    /**
     * Call from the activity's onResume. The sheet covers the activity, so a
     * resume means it closed; if no answer follows soon, it died without one.
     */
    fun onResume() {
        val pick = pending ?: return
        handler.postDelayed({ if (pending === pick && pick.abandon()) pending = null }, RESUME_GRACE_MS)
    }

    private fun pick(reply: JavaScriptReplyProxy) {
        pending?.abandon()
        val signal = CancellationSignal()
        val pick = PendingPick(post = reply::postMessage, cancel = signal::cancel)
        pending = pick
        val nonce = GoogleSignInMessages.newNonce()
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(false)
            .setNonce(GoogleSignInMessages.sha256Hex(nonce))
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        credentials.getCredentialAsync(
            activity,
            request,
            signal,
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val credential = result.credential
                    val message = if (
                        credential is CustomCredential &&
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    ) {
                        GoogleSignInMessages.signedIn(GoogleIdTokenCredential.createFrom(credential.data).idToken, nonce)
                    } else {
                        GoogleSignInMessages.failed("unexpected_credential")
                    }
                    finish(pick, message)
                }

                override fun onError(e: GetCredentialException) {
                    val message = when (e) {
                        is GetCredentialCancellationException -> GoogleSignInMessages.cancelled()
                        is NoCredentialException -> GoogleSignInMessages.failed("no_credential")
                        else -> {
                            Log.w(TAG, "Google account picker failed: ${e.type}")
                            GoogleSignInMessages.failed("error")
                        }
                    }
                    finish(pick, message)
                }
            },
        )
    }

    private fun finish(pick: PendingPick, message: String) {
        pick.settle(message)
        if (pending === pick) pending = null
    }

    private companion object {
        const val TAG = "WeaveForgeSignIn"
        const val CHANNEL = "AndroidGoogleSignIn"
        const val REQUEST = "request-id-token"
        const val RESUME_GRACE_MS = 3_000L
    }
}
