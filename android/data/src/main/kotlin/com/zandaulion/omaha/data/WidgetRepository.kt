package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

data class WidgetMover(val ticker: String, val delta: Int)

data class WidgetHolding(val ticker: String, val score: Int?, val tier: String)

data class WidgetSnapshot(
    val watchlistName: String,
    val compositeScore: Int?,
    val previousCompositeScore: Int?,
    val tier: String,
    val movers: List<WidgetMover>,
    /** Every holding, in watchlist order — the widget's largest size shows this instead of only the ranked movers. */
    val holdings: List<WidgetHolding>
)

/**
 * One call: a watchlist id in, a widget's worth of state out.
 *
 * The composite score reuses [WatchlistRepository.load] and [meanScore] —
 * the exact function the Watchlist tab's own hero banner uses — so a
 * widget can never show a different number for the same list than opening
 * the app would. Movers go through [AlertEngine.movers], the same
 * `core/alerts/sweep.js` logic the Sunday digest embeds as prose, for the
 * same reason: a native reimplementation could silently drift from the
 * digest's own list for the same holdings on the same day, and calling
 * through cannot.
 */
class WidgetRepository(
    private val watchlists: WatchlistRepository,
    private val alertsDao: AlertsDao,
    private val alertEngine: AlertEngine
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun snapshot(watchlistId: String): WidgetSnapshot = withContext(Dispatchers.IO) {
        val view = watchlists.load(watchlistId).last()
        val snapshots = alertsDao.snapshots(view.holdings.map { it.ticker }).associateBy { it.ticker }

        val (previousComposite, _) = meanScore(view.holdings.map { snapshots[it.ticker]?.baselineScore })

        val holdingsPayload = buildJsonArray {
            for (h in view.holdings) {
                val score = h.healthScore ?: continue
                add(
                    buildJsonObject {
                        put("ticker", h.ticker)
                        put("healthScore", score)
                        val previous = snapshots[h.ticker]?.baselineScore
                        put("previousScore", previous?.let { JsonPrimitive(it) } ?: JsonNull)
                    }
                )
            }
        }

        val movers = runCatching {
            json.parseToJsonElement(alertEngine.movers(holdingsPayload.toString())).jsonArray
        }.getOrNull().orEmpty().mapNotNull { el ->
            val m = el.jsonObject
            val ticker = (m["ticker"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val delta = (m["delta"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
            WidgetMover(ticker, delta)
        }

        WidgetSnapshot(
            watchlistName = view.health.watchlistName,
            compositeScore = view.health.compositeScore,
            previousCompositeScore = previousComposite,
            tier = view.health.tier,
            movers = movers,
            holdings = view.holdings.map { WidgetHolding(it.ticker, it.healthScore, it.healthTier) }
        )
    }
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
