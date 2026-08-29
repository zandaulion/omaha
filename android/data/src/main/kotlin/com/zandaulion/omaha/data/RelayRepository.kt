package com.zandaulion.omaha.data

import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/**
 * A relay call that reached Firebase but was refused.
 *
 * `code` is the vocabulary the relay's callables actually throw —
 * `unauthenticated`, `resource-exhausted`, `failed-precondition`,
 * `invalid-argument` — the same discipline `StockUnavailable.kind` follows
 * for the scoring engine's errors: a string the caller can branch on, spelled
 * however the thing that threw it spells it, rather than re-guessed here.
 */
class RelayFailure(val code: String, message: String) : Exception(message)

/**
 * The five Cloud Function callables, and nothing about what they mean.
 *
 * Firebase Functions attaches the caller's Firebase Auth ID token
 * automatically when one exists — this class never reads or passes one
 * itself, and never decides whether the caller is signed in. That is
 * [AuthRepository]'s question; a `RelayFailure("unauthenticated", ...)` here
 * is what answers it when the answer was "no."
 */
class RelayRepository {

    private val functions: FirebaseFunctions get() = FirebaseFunctions.getInstance()

    suspend fun getCachedSummary(ticker: String): AiSummary? {
        val root = call("getAiSummary", mapOf("ticker" to ticker))
        return parseAiSummary(root)
    }

    /** `credits` is the balance immediately after the spend. */
    data class GenerateResult(val summary: AiSummary, val credits: Int)

    suspend fun generateSummary(ticker: String, stockJson: String, thesis: Thesis?): GenerateResult {
        val data = buildMap {
            put("ticker", ticker)
            put("stock", parseToPlain(stockJson))
            thesis?.let { put("thesis", it.toPlain()) }
        }
        val root = call("generateAiSummary", data)
        val summary = parseAiSummary(root)
            ?: throw RelayFailure("internal", "The relay returned no analysis.")
        return GenerateResult(summary, root.int("credits") ?: 0)
    }

    suspend fun getBalance(): Int = call("getBalance", emptyMap()).int("credits") ?: 0

    data class ClaimResult(val credits: Int, val granted: Boolean)

    suspend fun claimFreeGrant(): ClaimResult {
        val root = call("claimFreeGrant", emptyMap())
        return ClaimResult(root.int("credits") ?: 0, root.bool("granted") ?: false)
    }

    data class RedeemResult(val credits: Int, val productLabel: String)

    suspend fun redeemPurchase(productId: String, purchaseToken: String): RedeemResult {
        val root = call(
            "redeemPurchase",
            mapOf("productId" to productId, "purchaseToken" to purchaseToken)
        )
        return RedeemResult(root.int("credits") ?: 0, root.text("productLabel") ?: "")
    }

    /**
     * One callable, converted to a [JsonObject] on the way back.
     *
     * The Functions SDK hands the response back as native `Map`/`List`/
     * primitive types, not JSON — [Any?.toJsonElement] bridges into the same
     * `kotlinx.serialization` vocabulary [StockDetailRepository] and
     * [AiSummary]'s parser already use, so there is one set of `.text()`/
     * `.int()` reading helpers in this module rather than two.
     */
    private suspend fun call(name: String, data: Map<String, Any?>): JsonObject {
        val result = try {
            functions.getHttpsCallable(name).call(data).await()
        } catch (e: FirebaseFunctionsException) {
            throw RelayFailure(e.code.name.lowercase().replace('_', '-'), e.message ?: e.code.name)
        }
        return (result.data.toJsonElement() as? JsonObject)
            ?: throw RelayFailure("internal", "$name returned an unexpected shape.")
    }
}

// ---------------------------------------------------------------- outbound

/** A JSON string, as the nested `Map`/`List`/primitive structure the Functions SDK's `data` parameter expects. */
private fun parseToPlain(json: String): Any? =
    kotlinx.serialization.json.Json.parseToJsonElement(json).toPlain()

private fun JsonElement.toPlain(): Any? = when (this) {
    is JsonObject -> entries.associate { (k, v) -> k to v.toPlain() }
    is JsonArray -> map { it.toPlain() }
    JsonNull -> null
    is JsonPrimitive -> if (isString) content else booleanOrNumberOrString()
}

private fun JsonPrimitive.booleanOrNumberOrString(): Any =
    content.toBooleanStrictOrNull() ?: content.toDoubleOrNull() ?: content

private fun Thesis.toPlain(): Map<String, Any?> = mapOf(
    "conviction" to conviction,
    "targetBuyPrice" to targetBuyPrice,
    "coreRationale" to coreRationale,
    "moatTags" to moatTags,
    "sellTriggers" to sellTriggers.map {
        mapOf("id" to it.id, "text" to it.text, "triggered" to it.triggered)
    },
    "journalEntries" to journalEntries.map {
        mapOf("id" to it.id, "date" to it.date, "note" to it.note)
    }
)

// ----------------------------------------------------------------- inbound

/**
 * The Functions SDK's native response shape, as a [JsonElement].
 *
 * `Number` covers everything Firebase's Gson-based decoding produces for a
 * JSON number — `Double`, `Long`, `Int` all reach here depending on the
 * value — so this reads the boxed type rather than assuming one.
 */
private fun Any?.toJsonElement(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is Map<*, *> -> JsonObject(entries.associate { (k, v) -> k.toString() to v.toJsonElement() })
    is List<*> -> JsonArray(map { it.toJsonElement() })
    is String -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    else -> JsonPrimitive(this.toString())
}

private fun JsonObject.text(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.takeUnless { it == "null" || it.isEmpty() }

private fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)?.let { it.intOrNull ?: it.doubleOrNull?.toInt() }

private fun JsonObject.bool(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.let { it == "true" }
