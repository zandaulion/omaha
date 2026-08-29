package com.zandaulion.omaha.data

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.tasks.await

/** What the UI needs to know about who is signed in. Not a [com.google.firebase.auth.FirebaseUser] directly, so nothing above this layer has to import Firebase types to show a name. */
data class SignedInUser(val uid: String, val displayName: String?, val email: String?)

sealed interface SignInOutcome {
    data class Success(val user: SignedInUser) : SignInOutcome
    /** The system picker was dismissed. Not an error — the ordinary way to decline. */
    data object Cancelled : SignInOutcome
    data class Failed(val message: String) : SignInOutcome
}

/**
 * Google Sign-In, via Credential Manager rather than the deprecated
 * `GoogleSignInClient`.
 *
 * **Called lazily, never from `onCreate` or a `LaunchedEffect` on screen
 * entry.** Doc 13 §7, decided 2026-08-28: the app stays anonymous unless a
 * credit is actually spent or the free grant claimed, and the specific
 * mistake that line exists to prevent is a screen that checks "am I signed
 * in?" the instant it renders, which quietly forces sign-in on anyone who
 * opened the AI tab out of curiosity. Every call in this class is meant to be
 * reached from a button tap, not from composition.
 */
class AuthRepository(private val context: Context) {

    private val auth: FirebaseAuth get() = FirebaseAuth.getInstance()

    /**
     * The Firebase project's **web** OAuth client, not the Android one.
     * Credential Manager's Sign-in-with-Google flow authenticates the person
     * to this client ID; Firebase then verifies the resulting ID token was
     * issued for it. Not a secret — it is meant to travel inside every app
     * binary that uses this Firebase project, the same way a Firebase project
     * ID is public. From android/app/google-services.json's oauth_client
     * entry of type 3.
     */
    private val webClientId =
        "516880666355-c8la8i0vic5m18o61ln196eam9p1ra2v.apps.googleusercontent.com"

    fun currentUser(): SignedInUser? = auth.currentUser?.let {
        SignedInUser(uid = it.uid, displayName = it.displayName, email = it.email)
    }

    fun signOut() = auth.signOut()

    /**
     * Shows the system account picker and, on a chosen account, signs into
     * Firebase with it.
     *
     * A cancellation is reported through [SignInOutcome.Cancelled] rather than
     * thrown — [GetCredentialCancellationException] is exactly what fires when
     * someone taps outside the picker, which is the ordinary way to decline,
     * not a fault to log or retry.
     */
    suspend fun signIn(): SignInOutcome {
        // GetGoogleIdOption, even with setFilterByAuthorizedAccounts(false),
        // depends on Play Services' "authorized accounts" bookkeeping and can
        // throw NoCredentialException ("No credentials available") on a
        // first-ever sign-in regardless of that flag — confirmed against a
        // real device, 2026-08-29. GetSignInWithGoogleOption always shows the
        // classic account chooser instead, which also happens to be the
        // right UX here: this flow is already an explicit button tap, never
        // a silent one-tap auto-select.
        val option = GetSignInWithGoogleOption.Builder(serverClientId = webClientId).build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()

        val credential = try {
            CredentialManager.create(context).getCredential(context, request).credential
        } catch (e: GetCredentialCancellationException) {
            return SignInOutcome.Cancelled
        } catch (e: GetCredentialException) {
            return SignInOutcome.Failed(e.message ?: e.javaClass.simpleName)
        }

        val idToken = try {
            require(credential is CustomCredential)
            require(credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
            GoogleIdTokenCredential.createFrom(credential.data).idToken
        } catch (e: GoogleIdTokenParsingException) {
            return SignInOutcome.Failed("Could not read the Google credential: ${e.message}")
        } catch (e: IllegalArgumentException) {
            return SignInOutcome.Failed("Unexpected credential type from the system picker.")
        }

        return try {
            val firebaseCredential = GoogleAuthProvider.getCredential(idToken, null)
            val result = auth.signInWithCredential(firebaseCredential).await()
            val user = result.user ?: return SignInOutcome.Failed("Signed in, but no account came back.")
            SignInOutcome.Success(SignedInUser(uid = user.uid, displayName = user.displayName, email = user.email))
        } catch (e: Exception) {
            SignInOutcome.Failed(e.message ?: "Firebase sign-in failed.")
        }
    }
}
