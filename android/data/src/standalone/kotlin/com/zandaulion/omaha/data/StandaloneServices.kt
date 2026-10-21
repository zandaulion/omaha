@file:Suppress("UNUSED_PARAMETER")

package com.zandaulion.omaha.data

import android.app.Activity
import android.content.Context

private const val UNAVAILABLE = "Cloud AI and credit purchases are not included in Pocket Omaha Core."

// Keep the repository contract shared with the Play edition. This source set
// never initializes an account SDK, opens a purchase sheet or contacts a relay.
data class SignedInUser(val uid: String, val displayName: String?, val email: String?)

sealed interface SignInOutcome {
    data class Success(val user: SignedInUser) : SignInOutcome
    data object Cancelled : SignInOutcome
    data class Failed(val message: String) : SignInOutcome
}

class AuthRepository(context: Context) {
    fun currentUser(): SignedInUser? = null
    fun signOut() = Unit
    suspend fun signIn(): SignInOutcome = SignInOutcome.Failed(UNAVAILABLE)
}

data class CreditProduct(val productId: String, val formattedPrice: String)

sealed interface PurchaseOutcome {
    data class Success(val productId: String, val purchaseToken: String) : PurchaseOutcome
    data object Cancelled : PurchaseOutcome
    data class Failed(val message: String) : PurchaseOutcome
}

class BillingRepository(context: Context) {
    suspend fun product(): CreditProduct? = null
    suspend fun purchase(activity: Activity): PurchaseOutcome = PurchaseOutcome.Failed(UNAVAILABLE)
    suspend fun unsettledPurchases(): List<PurchaseOutcome.Success> = emptyList()
    fun close() = Unit
}

class RelayFailure(val code: String, message: String) : Exception(message)

class RelayRepository {
    suspend fun getCachedSummary(ticker: String): AiSummary? = null
    data class GenerateResult(val summary: AiSummary, val credits: Int)
    suspend fun generateSummary(ticker: String, stockJson: String, thesis: Thesis?): GenerateResult = unavailable()
    suspend fun getBalance(): Int = 0
    data class ClaimResult(val credits: Int, val granted: Boolean)
    suspend fun claimFreeGrant(): ClaimResult = unavailable()
    data class RedeemResult(val credits: Int, val productLabel: String)
    suspend fun redeemPurchase(productId: String, purchaseToken: String): RedeemResult = unavailable()

    private fun unavailable(): Nothing = throw RelayFailure("unavailable", UNAVAILABLE)
}
