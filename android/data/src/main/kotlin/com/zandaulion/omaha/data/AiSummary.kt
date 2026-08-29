package com.zandaulion.omaha.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

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
    val generatedAt: String?,
    /** What this analysis was reasoned against — `assessStaleness` compares both against the current stock to decide whether the analysis still describes it. */
    val fiscalPeriodEnd: String?,
    val priceAtGeneration: Double?
)

/**
 * Parses `{summary: {...}}` — the shape both `getAiSummary` and
 * `generateAiSummary` return — or `null` for `{summary: null}`, a cache miss
 * that is a real answer, not an error.
 */
fun parseAiSummary(root: JsonObject): AiSummary? {
    val d = root["summary"] as? JsonObject ?: return null
    return parseAiSummaryObject(d)
}

/** The same parse, unwrapped — for [AiSummaryDao]'s cache row, which stores this shape directly rather than the relay's `{summary: ...}` envelope. */
fun parseAiSummaryObject(d: JsonObject): AiSummary {
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
        generatedAt = d.text("generatedAt"),
        fiscalPeriodEnd = d.text("fiscalPeriodEnd"),
        priceAtGeneration = d.dbl("priceAtGeneration")
    )
}

/** The inverse of [parseAiSummaryObject] — round-trips through [AiSummaryDao]'s stored text. Only the fields [AiSummary] carries survive; nothing downstream reads past it anyway. */
fun AiSummary.toJsonObject(): JsonObject = buildJsonObject {
    put("verdict", verdict)
    put("verdictGrade", verdictGrade)
    put("verdictBadge", verdictBadge)
    put("buffettPrinciple", buffettPrinciple)
    put("executiveSummary", executiveSummary)
    put("moatAndProfitability", moatAndProfitability.toJsonObject())
    put("solvencyAndSafety", solvencyAndSafety.toJsonObject())
    put("valuationAndDCF", valuationAndDCF.toJsonObject())
    putJsonArray("keyStrengths") { keyStrengths.forEach { add(it.toJsonObject()) } }
    putJsonArray("keyRisks") { keyRisks.forEach { add(it.toJsonObject()) } }
    putJsonObject("contextFromModelKnowledge") {
        put("hasContext", modelContext.hasContext)
        modelContext.asOfCaveat?.let { put("asOfCaveat", it) }
        putJsonArray("points") {
            modelContext.points.forEach { p ->
                addJsonObject {
                    put("claim", p.claim)
                    put("confidence", p.confidence)
                }
            }
        }
    }
    putJsonArray("dataLimitations") { dataLimitations.forEach { add(it) } }
    put("conclusion", conclusion)
    putJsonObject("buyZone") {
        put("maxPrice", buyZone.maxPrice)
        put("currency", buyZone.currency)
        buyZone.impliedDiscountToFairValuePct?.let { put("impliedDiscountToFairValuePct", it) }
        put("alreadyInZone", buyZone.alreadyInZone)
        put("perspective", buyZone.perspective)
    }
    putJsonArray("whatToWatch") { whatToWatch.forEach { add(it) } }
    put("includedNotes", includedNotes)
    generatedAt?.let { put("generatedAt", it) }
    fiscalPeriodEnd?.let { put("fiscalPeriodEnd", it) }
    priceAtGeneration?.let { put("priceAtGeneration", it) }
}

private fun Rating.toJsonObject(): JsonObject = buildJsonObject {
    put("rating", rating)
    put("ratingLabel", ratingLabel)
    put("explanation", explanation)
}

private fun StrengthOrRisk.toJsonObject(): JsonObject = buildJsonObject {
    put("title", title)
    put("detail", detail)
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
