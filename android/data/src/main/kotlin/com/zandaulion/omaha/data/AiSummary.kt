package com.zandaulion.omaha.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * One Gemini analysis, as `core/analysis/prompt.js`'s `RESPONSE_SCHEMA`
 * shapes it.
 *
 * A thin read of the relay's response, the same discipline [StockDetail]
 * follows for the scoring engine's: nothing here is computed, only carried.
 * The schema is defined once, in `core/`, and this is a projection of it —
 * not a second definition a future field could silently miss.
 */
data class Rating(val rating: String, val ratingLabel: String, val explanation: String)

data class StrengthOrRisk(val title: String, val detail: String)

data class ModelContextPoint(val claim: String, val confidence: String)

data class ModelContext(
    val hasContext: Boolean,
    val asOfCaveat: String?,
    val points: List<ModelContextPoint>
)

data class BuyZone(
    val maxPrice: Double,
    val currency: String,
    val impliedDiscountToFairValuePct: Double?,
    val alreadyInZone: Boolean,
    val perspective: String
)

data class AiSummary(
    val verdict: String,
    val verdictGrade: String,
    val verdictBadge: String,
    val buffettPrinciple: String,
    val executiveSummary: String,
    val moatAndProfitability: Rating,
    val solvencyAndSafety: Rating,
    val valuationAndDCF: Rating,
    val keyStrengths: List<StrengthOrRisk>,
    val keyRisks: List<StrengthOrRisk>,
    val modelContext: ModelContext,
    val dataLimitations: List<String>,
    val conclusion: String,
    val buyZone: BuyZone,
    val whatToWatch: List<String>,
    /**
     * Whether this analysis was written with the user's own thesis and
     * journal in front of the model. Recorded rather than re-derived: the
     * privacy toggle can change after generation, and a cached summary must
     * still be able to say what it actually was.
     */
    val includedNotes: Boolean,
    val generatedAt: String?
)

/**
 * Parses `{summary: {...}}` — the shape both `getAiSummary` and
 * `generateAiSummary` return — or `null` for `{summary: null}`, a cache miss
 * that is a real answer, not an error.
 */
fun parseAiSummary(root: JsonObject): AiSummary? {
    val d = root["summary"] as? JsonObject ?: return null
    return AiSummary(
        verdict = d.text("verdict") ?: "",
        verdictGrade = d.text("verdictGrade") ?: "INSUFFICIENT_DATA",
        verdictBadge = d.text("verdictBadge") ?: "",
        buffettPrinciple = d.text("buffettPrinciple") ?: "",
        executiveSummary = d.text("executiveSummary") ?: "",
        moatAndProfitability = d.rating("moatAndProfitability"),
        solvencyAndSafety = d.rating("solvencyAndSafety"),
        valuationAndDCF = d.rating("valuationAndDCF"),
        keyStrengths = d.strengthsOrRisks("keyStrengths"),
        keyRisks = d.strengthsOrRisks("keyRisks"),
        modelContext = (d["contextFromModelKnowledge"] as? JsonObject).let { c ->
            ModelContext(
                hasContext = c?.bool("hasContext") ?: false,
                asOfCaveat = c?.text("asOfCaveat"),
                points = (c?.get("points") as? JsonArray).orEmpty().map { el ->
                    val p = el.jsonObject
                    ModelContextPoint(
                        claim = p.text("claim") ?: "",
                        confidence = p.text("confidence") ?: "LOW"
                    )
                }
            )
        },
        dataLimitations = (d["dataLimitations"] as? JsonArray).orEmpty()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
        conclusion = d.text("conclusion") ?: "",
        buyZone = (d["buyZone"] as? JsonObject).let { b ->
            BuyZone(
                maxPrice = b?.dbl("maxPrice") ?: 0.0,
                currency = b?.text("currency") ?: "USD",
                impliedDiscountToFairValuePct = b?.dbl("impliedDiscountToFairValuePct"),
                alreadyInZone = b?.bool("alreadyInZone") ?: false,
                perspective = b?.text("perspective") ?: ""
            )
        },
        whatToWatch = (d["whatToWatch"] as? JsonArray).orEmpty()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
        includedNotes = d.bool("includedNotes") ?: false,
        generatedAt = d.text("generatedAt")
    )
}

private fun JsonObject.rating(key: String): Rating {
    val r = this[key] as? JsonObject
    return Rating(
        rating = r.text("rating") ?: "NOT_ASSESSABLE",
        ratingLabel = r.text("ratingLabel") ?: "Not assessable",
        explanation = r.text("explanation") ?: ""
    )
}

private fun JsonObject.strengthsOrRisks(key: String): List<StrengthOrRisk> =
    (this[key] as? JsonArray).orEmpty().map { el ->
        val s = el.jsonObject
        StrengthOrRisk(title = s.text("title") ?: "", detail = s.text("detail") ?: "")
    }

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

private fun JsonObject?.text(key: String): String? =
    (this?.get(key) as? JsonPrimitive)?.contentOrNull?.takeUnless { it == "null" || it.isEmpty() }

private fun JsonObject?.dbl(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull
private fun JsonObject?.bool(key: String): Boolean? =
    (this?.get(key) as? JsonPrimitive)?.contentOrNull?.let { it == "true" }
