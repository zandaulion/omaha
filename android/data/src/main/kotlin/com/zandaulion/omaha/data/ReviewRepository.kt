package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

data class ReviewChange(val title: String, val body: String, val severity: String, val at: String)

data class CompanyReview(
    val ticker: String, val name: String, val status: String, val label: String, val reason: String,
    val lastReviewedAt: String?, val assessment: String?, val changeCount: Int,
    val hasThesis: Boolean, val changes: List<ReviewChange>
)

data class ReviewOverview(val items: List<CompanyReview>, val lastCheckedAt: String?)

/** Read stored observations; opening Home never initiates an upstream fetch. */
class ReviewRepository(
    private val personalData: PersonalDataDao,
    private val stockCache: StockCacheDao,
    private val alerts: AlertsDao,
    private val engine: AlertEngine
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun summaries(watchlistId: String? = null): ReviewOverview = withContext(Dispatchers.IO) {
        val lists = personalData.watchlists()
        val list = if (watchlistId == null) lists.firstOrNull { it.isDefault } ?: lists.firstOrNull()
            else lists.firstOrNull { it.id == watchlistId }
        val tickers = list?.let { json.decodeFromString<List<String>>(it.tickersJson) }.orEmpty()
        val companies = buildJsonArray {
            for (ticker in tickers) add(buildJsonObject {
                put("ticker", ticker)
                put("name", stockCache.find(ticker)?.name ?: ticker)
            })
        }
        val personal = Json.parseToJsonElement(PersonalDataStore(personalData).read()).jsonObject
        val input = buildJsonObject {
            put("companies", companies)
            put("theses", personal["theses"] ?: JsonArray(emptyList()))
            put("now", isoNow())
            put("alerts", buildJsonArray {
                for (alert in alerts.history(Int.MAX_VALUE)) add(buildJsonObject {
                    put("ticker", alert.ticker); put("title", alert.title); put("body", alert.body)
                    put("severity", alert.severity); put("at", alert.deliveredAt)
                })
            })
        }
        ReviewOverview(parseCompanyReviews(engine.reviewQueue(input.toString())),
            alerts.snapshots(tickers).maxOfOrNull { it.capturedAt })
    }
}

internal fun parseCompanyReviews(raw: String): List<CompanyReview> =
    Json.parseToJsonElement(raw).jsonArray.map { element ->
        val obj = element.jsonObject
        CompanyReview(
            ticker = obj.text("ticker"), name = obj.text("name"), status = obj.text("status"),
            label = obj.text("label"), reason = obj.text("reason"),
            lastReviewedAt = obj["lastReviewedAt"]?.jsonPrimitive?.contentOrNull,
            assessment = obj["assessment"]?.jsonPrimitive?.contentOrNull,
            changeCount = obj.getValue("changeCount").jsonPrimitive.int,
            hasThesis = obj.getValue("hasThesis").jsonPrimitive.boolean,
            changes = obj.getValue("changes").jsonArray.map { item ->
                val change = item.jsonObject
                ReviewChange(change.text("title"), change.text("body"), change.text("severity"), change.text("at"))
            }
        )
    }

private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
