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
 * Play prompt until a person actually asks for one. The exception is
 * [settleUnredeemed], which prompts nothing: it re-redeems purchases that
 * were paid for but never credited.
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
            if (user != null) settleUnredeemed()
        }
    }

    /**
     * Redeems any credit purchase Play still holds as unsettled — one whose
     * `redeemPurchase` call failed after the money was taken. Returns true if
     * something was found, whether or not crediting it succeeded, so a caller
     * about to buy again knows not to: Play refuses a second purchase of an
     * unconsumed item.
     */
    private suspend fun settleUnredeemed(): Boolean {
        val unsettled = runCatching { handles.billing.unsettledPurchases() }.getOrDefault(emptyList())
        for (purchase in unsettled) {
            try {
                val result = handles.relay.redeemPurchase(purchase.productId, purchase.purchaseToken)
                updateReady { it.copy(credits = result.credits) }
            } catch (e: RelayFailure) {
                updateReady { it.copy(error = UNCREDITED_PURCHASE) }
            }
        }
        return unsettled.isNotEmpty()
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
                    settleUnredeemed()
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
            // An earlier purchase still unsettled would make Play refuse this
            // one as "already owned" — credit that instead of buying again.
            if (settleUnredeemed()) {
                updateReady { it.copy(busy = null) }
                return@launch
            }
            when (val outcome = handles.billing.purchase(activity)) {
                is PurchaseOutcome.Success -> {
                    try {
                        val result = handles.relay.redeemPurchase(outcome.productId, outcome.purchaseToken)
                        updateReady { it.copy(credits = result.credits, busy = null) }
                    } catch (e: RelayFailure) {
                        updateReady { it.copy(busy = null, error = UNCREDITED_PURCHASE) }
                    }
                }
                PurchaseOutcome.Cancelled -> updateReady { it.copy(busy = null) }
                is PurchaseOutcome.Failed -> updateReady { it.copy(busy = null, error = outcome.message) }
            }
        }
    }
}

/** The money is taken but the credits are not — say so plainly, not the relay's bare error code. */
private const val UNCREDITED_PURCHASE =
    "Your purchase went through but couldn't be credited yet. It will be retried the next time you open " +
        "this tab; if it still fails within 3 days, Google Play refunds it automatically."

private fun relayErrorMessage(e: RelayFailure): String = when (e.code) {
    "unauthenticated" -> "Sign in to continue."
    "resource-exhausted" -> "You're out of credits."
    // An uncaught exception in a callable reaches the client as just "INTERNAL".
    "internal" -> "Something went wrong on the server. Please try again later."
    else -> e.message.takeUnless { it.isNullOrBlank() } ?: "The relay could not complete that request."
}
