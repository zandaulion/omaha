package com.zandaulion.omaha.data

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.queryProductDetails
import kotlinx.coroutines.suspendCancellableCoroutine

/** The one real Play product this app sells. `functions/src/products.js` defines the credit grant for it. */
private const val CREDIT_PRODUCT_ID = "omaha_credits_10"

data class CreditProduct(val productId: String, val formattedPrice: String)

sealed interface PurchaseOutcome {
    data class Success(val productId: String, val purchaseToken: String) : PurchaseOutcome
    /** The Play sheet was dismissed. Not an error — the ordinary way to decline. */
    data object Cancelled : PurchaseOutcome
    data class Failed(val message: String) : PurchaseOutcome
}

/**
 * Play Billing for `omaha_credits_10`.
 *
 * Deliberately never calls `consumePurchase`/`acknowledgePurchase` —
 * `functions/src/billing.js`'s `redeemPurchase` does both, server-side, only
 * after verifying the purchase token against the Play Developer API, and
 * decides which one via `settlementFor()` since Play's one-time-products
 * system dropped the "consumable" product type entirely. This class's only
 * job is to launch the purchase sheet and hand the resulting purchase token
 * to the relay; settling it a second time here would race the server's
 * settlement, which is the one whose result Play actually trusts.
 *
 * Called lazily, the same discipline [AuthRepository]'s header describes —
 * binding to Play's billing service is a cost paid only once the AI tab's
 * purchase button is actually reached, not from app startup.
 */
class BillingRepository(context: Context) {

    private var pendingPurchase: ((PurchaseOutcome) -> Unit)? = null

    private val client: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { billingResult, purchases ->
            val outcome = when (billingResult.responseCode) {
                BillingClient.BillingResponseCode.OK -> {
                    val purchase = purchases?.firstOrNull { CREDIT_PRODUCT_ID in it.products }
                    if (purchase != null) {
                        PurchaseOutcome.Success(CREDIT_PRODUCT_ID, purchase.purchaseToken)
                    } else {
                        PurchaseOutcome.Failed("Purchase completed but no matching purchase came back.")
                    }
                }
                BillingClient.BillingResponseCode.USER_CANCELED -> PurchaseOutcome.Cancelled
                else -> PurchaseOutcome.Failed(
                    billingResult.debugMessage.ifBlank { "Billing error ${billingResult.responseCode}" }
                )
            }
            pendingPurchase?.invoke(outcome)
            pendingPurchase = null
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    private suspend fun ensureConnected() {
        if (client.connectionState == BillingClient.ConnectionState.CONNECTED) return
        suspendCancellableCoroutine { cont ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (cont.isActive) cont.resume(Unit, onCancellation = null)
                }
                // enableAutoServiceReconnection() retries on its own; the next
                // call in on this repository re-checks connectionState rather
                // than waiting on a second callback here.
                override fun onBillingServiceDisconnected() = Unit
            })
        }
    }

    private suspend fun queryCreditProduct(): ProductDetails? {
        ensureConnected()
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(CREDIT_PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
            )
            .build()
        return client.queryProductDetails(params).productDetailsList?.firstOrNull()
    }

    /** For showing a price before the purchase button is tapped. `null` if Play has nothing for this product right now. */
    suspend fun product(): CreditProduct? {
        val details = queryCreditProduct() ?: return null
        val price = details.oneTimePurchaseOfferDetails?.formattedPrice ?: return null
        return CreditProduct(CREDIT_PRODUCT_ID, price)
    }

    /** Shows the Play purchase sheet and suspends until it resolves. `activity` must host it — Play Billing has no headless flow. */
    suspend fun purchase(activity: Activity): PurchaseOutcome {
        val details = queryCreditProduct()
            ?: return PurchaseOutcome.Failed("The credits product is not available right now.")
        val offerToken = details.oneTimePurchaseOfferDetails?.offerToken
            ?: return PurchaseOutcome.Failed("The credits product has no purchasable offer.")

        return suspendCancellableCoroutine { cont ->
            pendingPurchase = { outcome -> if (cont.isActive) cont.resume(outcome, onCancellation = null) }

            val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(offerToken)
                .build()
            val flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productParams))
                .build()

            val launchResult = client.launchBillingFlow(activity, flowParams)
            if (launchResult.responseCode != BillingClient.BillingResponseCode.OK) {
                pendingPurchase = null
                cont.resume(
                    PurchaseOutcome.Failed(launchResult.debugMessage.ifBlank { "Could not start the purchase flow." }),
                    onCancellation = null
                )
            }
        }
    }

    fun close() = client.endConnection()
}
