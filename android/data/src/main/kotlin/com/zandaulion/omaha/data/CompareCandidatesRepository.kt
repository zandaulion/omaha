package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One suggestion the comparison picker can offer. */
data class CandidateRow(
    val ticker: String,
    val name: String?,
    val sector: String?,
    val healthScore: Int?
)

/** One section of the picker — a watchlist's name, and the rows under it. */
data class CandidateGroup(val label: String, val rows: List<CandidateRow>)

/** Everything the comparison picker can offer, grouped the way it offers it. */
data class CompareCandidates(
    val peers: List<CandidateRow>,
    val watchlists: List<CandidateGroup>,
    val seen: List<CandidateRow>
)

/**
 * The comparison picker's three candidate tiers, composed from repositories
 * that already exist — `WatchlistRepository` for the watchlists, the
 * bundled `stock.bundle.js`'s `peers()` (via [StockEngine]) for Yahoo's
 * peers, and `stock_cache` for everything this install has ever scored.
 *
 * Same shape as `WidgetRepository`: a small class that combines existing
 * repositories rather than owning storage of its own, mirroring
 * `server/index.js`'s `/api/compare/candidates` — three tiers because they
 * are three different kinds of suggestion, kept separate so the curated
 * watchlists don't get buried in the noise of everything else looked up.
 */
class CompareCandidatesRepository(
    private val watchlists: WatchlistRepository,
    private val stockCache: StockCacheDao,
    private val engine: StockEngine
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun candidates(seedTicker: String?): CompareCandidates {
        val watchlistGroups = watchlists.watchlists().map { row ->
            val tickers = json.parseToJsonElement(row.tickersJson).jsonArray
                .mapNotNull { it.jsonPrimitive.contentOrNull }
            CandidateGroup(row.name, tickers.map { decorate(it) })
        }.filter { it.rows.isNotEmpty() }

        val peerRows = seedTicker?.let { fetchPeers(it) } ?: emptyList()

        val allScored = stockCache.allScored()
            .map { CandidateRow(it.ticker, it.name, it.sector, it.healthScore) }
        val seenRows = seenTier(seedTicker, watchlistGroups.flatMap { it.rows }, peerRows, allScored)

        return CompareCandidates(peers = peerRows, watchlists = watchlistGroups, seen = seenRows)
    }

    private suspend fun fetchPeers(ticker: String): List<CandidateRow> = try {
        val root = json.parseToJsonElement(engine.peers(ticker)).jsonObject
        val tickers = if (root.ok()) {
            (root["tickers"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        } else {
            emptyList()
        }
        tickers.map { decorate(it) }
    } catch (_: Throwable) {
        emptyList()
    }

    /** A cached ticker is offered with its name/sector/score; an uncached one still gets offered, blank. */
    private suspend fun decorate(ticker: String): CandidateRow {
        val row = stockCache.find(ticker)
        return CandidateRow(ticker = ticker, name = row?.name, sector = row?.sector, healthScore = row?.healthScore)
    }

    private fun JsonObject.ok(): Boolean =
        this["ok"]?.jsonPrimitive?.let { it.booleanOrNull ?: (it.contentOrNull == "true") } ?: false
}

/**
 * The "seen" tier: everything scored, minus whatever the other two tiers
 * (and the seed ticker itself) already offer. Pulled out as a pure
 * function — the one piece of this repository that is actual reasoning
 * rather than a straight read from a DAO — so it's testable without a
 * database.
 */
internal fun seenTier(
    seedTicker: String?,
    watchlistRows: List<CandidateRow>,
    peerRows: List<CandidateRow>,
    allScored: List<CandidateRow>
): List<CandidateRow> {
    val alreadyOffered = buildSet {
        seedTicker?.let { add(it) }
        watchlistRows.forEach { add(it.ticker) }
        peerRows.forEach { add(it.ticker) }
    }
    return allScored.filter { it.ticker !in alreadyOffered }
}
