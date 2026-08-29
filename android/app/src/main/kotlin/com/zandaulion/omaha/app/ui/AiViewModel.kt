package com.zandaulion.omaha.app.ui

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.AiSummary
import com.zandaulion.omaha.data.PurchaseOutcome
import com.zandaulion.omaha.data.RelayFailure
import com.zandaulion.omaha.data.SignInOutcome
import com.zandaulion.omaha.data.SignedInUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Which network round trip [AiUiState.Ready.busy] is waiting on — lets the UI say something specific rather than a bare spinner. */
enum class AiBusyKind { SigningIn, Generating, ClaimingFreeGrant, Purchasing }

sealed interface AiUiState {
    data object Loading : AiUiState
    data class Ready(
        val ticker: String,
        val summary: AiSummary?,
        val user: SignedInUser?,
        val credits: Int?,
        val busy: AiBusyKind?,
        val error: String?
    ) : AiUiState
}

/**
 * One ticker's AI analysis: sign-in, balance, purchase, and the generated
 * summary itself.
 *
 * Sequences [AuthRepository], [BillingRepository], [RelayRepository] and
 * [AiRepository] for the tab; owns nothing about what any of them mean.
 * Every action here is reached from a button tap, never from [open] or
 * composition — doc 13 §7's lazy sign-in discipline, extended to purchase
 * and the free grant: opening the AI tab must stay free of any Google or
 * Play prompt until a person actually asks for one.
 */
class AiViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<AiUiState>(AiUiState.Loading)
    val state: StateFlow<AiUiState> = _state.asStateFlow()

    private var current: String? = null
    private val handles get() = OmahaEngine.get(getApplication())

    fun open(ticker: String) {
        if (ticker == current) return
        current = ticker
        _state.value = AiUiState.Loading
        viewModelScope.launch {
            // The cached read needs no sign-in — getAiSummary is public, so a
            // previously generated summary shows even before anyone signs in.
            // ai.cachedSummary checks the on-device cache before the relay's.
            val summary = runCatching { handles.ai.cachedSummary(ticker) }.getOrNull()
            val user = handles.auth.currentUser()
            val credits = user?.let { runCatching { handles.relay.getBalance() }.getOrNull() }
            _state.value = AiUiState.Ready(ticker, summary, user, credits, busy = null, error = null)
        }
    }

    private inline fun updateReady(transform: (AiUiState.Ready) -> AiUiState.Ready) {
        (_state.value as? AiUiState.Ready)?.let { _state.value = transform(it) }
    }

    fun dismissError() = updateReady { it.copy(error = null) }

    fun signIn() = signInThen {}

    /** Signs in first if nobody is signed in yet. */
    fun generate() = whenSignedIn(::generateNow)

    fun claimFreeGrant() = whenSignedIn(::claimFreeGrantNow)

    /** Play Billing has no headless flow — `activity` hosts the purchase sheet. */
    fun purchase(activity: Activity) = whenSignedIn { purchaseNow(activity) }

    private fun whenSignedIn(action: () -> Unit) {
        val ready = _state.value as? AiUiState.Ready ?: return
        if (ready.busy != null) return
        if (ready.user == null) signInThen(action) else action()
    }

    private fun signInThen(after: () -> Unit) {
        val ready = _state.value as? AiUiState.Ready ?: return
        if (ready.busy != null) return
        updateReady { it.copy(busy = AiBusyKind.SigningIn, error = null) }
        viewModelScope.launch {
            when (val outcome = handles.auth.signIn()) {
                is SignInOutcome.Success -> {
                    val credits = runCatching { handles.relay.getBalance() }.getOrNull()
                    updateReady { it.copy(user = outcome.user, credits = credits, busy = null) }
                    after()
                }
                SignInOutcome.Cancelled -> updateReady { it.copy(busy = null) }
                is SignInOutcome.Failed -> updateReady { it.copy(busy = null, error = outcome.message) }
            }
        }
    }

    private fun generateNow() {
        val ticker = (_state.value as? AiUiState.Ready)?.ticker ?: return
        updateReady { it.copy(busy = AiBusyKind.Generating, error = null) }
        viewModelScope.launch {
            try {
                val result = handles.ai.generate(ticker)
                updateReady { it.copy(summary = result.summary, credits = result.credits, busy = null) }
            } catch (e: RelayFailure) {
                updateReady { it.copy(busy = null, error = relayErrorMessage(e)) }
            } catch (e: Exception) {
                updateReady { it.copy(busy = null, error = e.message ?: "Could not generate an analysis.") }
            }
        }
    }

    private fun claimFreeGrantNow() {
        updateReady { it.copy(busy = AiBusyKind.ClaimingFreeGrant, error = null) }
        viewModelScope.launch {
            try {
                val result = handles.relay.claimFreeGrant()
                updateReady {
                    it.copy(
                        credits = result.credits,
                        busy = null,
                        error = if (!result.granted) "The free grant has already been claimed on this account." else null
                    )
                }
            } catch (e: RelayFailure) {
                updateReady { it.copy(busy = null, error = relayErrorMessage(e)) }
            } catch (e: Exception) {
                updateReady { it.copy(busy = null, error = e.message ?: "Could not claim the free grant.") }
            }
        }
    }

    private fun purchaseNow(activity: Activity) {
        updateReady { it.copy(busy = AiBusyKind.Purchasing, error = null) }
        viewModelScope.launch {
            when (val outcome = handles.billing.purchase(activity)) {
                is PurchaseOutcome.Success -> {
                    try {
                        val result = handles.relay.redeemPurchase(outcome.productId, outcome.purchaseToken)
                        updateReady { it.copy(credits = result.credits, busy = null) }
                    } catch (e: RelayFailure) {
                        updateReady { it.copy(busy = null, error = relayErrorMessage(e)) }
                    }
                }
                PurchaseOutcome.Cancelled -> updateReady { it.copy(busy = null) }
                is PurchaseOutcome.Failed -> updateReady { it.copy(busy = null, error = outcome.message) }
            }
        }
    }
}

private fun relayErrorMessage(e: RelayFailure): String = when (e.code) {
    "unauthenticated" -> "Sign in to continue."
    "resource-exhausted" -> "You're out of credits."
    else -> e.message.takeUnless { it.isNullOrBlank() } ?: "The relay could not complete that request."
}
