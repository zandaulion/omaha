package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * One scored holding, as the watchlist needs it.
 *
 * Deliberately a thin read of the record rather than a mirror of it.
 * `core/model/record.js` owns that shape and has about twenty fields; a Kotlin
 * class restating them would be a second definition that loses the first field
 * added to one side and not the other — the same argument `RoomStockStore`
 * makes for storing the record as JSON and lifting out only what is queried on.
 *
 * Every number is nullable because the engine reports what it could not measure
 * as `null` rather than as zero, and the interface has to say "not reported"
 * rather than draw a bar at the bottom of the chart.
 */
data class Holding(
    val ticker: String,
    val name: String,
    val price: Double?,
    val currency: String,
    val changePct: Double?,
    val healthScore: Int?,
    val healthTier: String,
    val roicPct: Double?,
    val altmanZ: Double?,
    val roe: Double?,
    val peRatio: Double?,
    val isFinancial: Boolean,
    val topCatalyst: String?,
    val topRisk: String?,
    /** Set when this ticker could not be loaded at all; everything else is null. */
    val error: String? = null,
    /** Queued, not yet scored. Distinct from failed, and from scored-as-null. */
    val loading: Boolean = false
)

/** What the hero banner states about the list as a whole. */
data class PortfolioHealth(
    val watchlistName: String,
    val holdingCount: Int,
    val compositeScore: Int?,
    val tier: String,
    val scoredCount: Int
)

data class WatchlistView(
    val id: String,
    val health: PortfolioHealth,
    val holdings: List<Holding>,
    /** How many are still queued. Zero once the list is fully scored. */
    val pending: Int = 0
)

/**
 * Reads watchlists from Room and scores their tickers through the engine.
 *
 * The engine is `core/host/stock.js` in QuickJS, which decides cache tiers,
 * staleness and when a failure must be reported rather than papered over. This
 * class does not repeat any of those judgements; it fans out, collects, and
 * turns the JSON into something a composable can render.
 */
class WatchlistRepository(
    private val dao: PersonalDataDao,
    private val engine: StockEngine
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * The starter lists the PWA seeds in `server/db.js`.
     *
     * Duplicated rather than shared because they are seed data rather than
     * logic — there is nothing for `core/` to decide here — but they are kept
     * identical so a person who installs both clients sees the same first
     * screen rather than wondering which one is wrong.
     */
    private val starters = listOf(
        Triple("compounders", "The Compounders", listOf("AAPL", "MSFT", "GOOGL", "BRK-B", "NVDA")),
        Triple("ai-semis", "AI & Semiconductors", listOf("NVDA", "MSFT", "GOOGL", "TSLA", "AAPL")),
        Triple("aristocrats", "Defensive Aristocrats", listOf("BRK-B", "MSFT", "AAPL", "GOOGL"))
    )

    suspend fun watchlists(): List<WatchlistRow> {
        val existing = dao.watchlists()
        if (existing.isNotEmpty()) return existing

        val now = isoNow()
        dao.upsertWatchlists(
            starters.mapIndexed { index, (id, name, tickers) ->
                WatchlistRow(
                    id = id,
                    name = name,
                    tickersJson = json.encodeToString(tickers),
                    isDefault = index == 0,
                    updatedAt = now
                )
            }
        )
        return dao.watchlists()
    }

    /**
     * Score every ticker on a list, emitting after each one.
     *
     * **Serial, and that is not an optimisation choice.** The first version
     * fanned out with `async` across every ticker at once, which looked right —
     * doc 13 §23 measures ingestion at about 1,800 ms against 5.5 ms for
     * scoring, so the network dominates and concurrency should have been free.
     *
     * It is not free, because the network happens *inside* the QuickJS call
     * through the fetch shim, and `quickjs-kt` alpha13 cannot survive two live
     * interpreters. On a handset that produced one scored company and four
     * `JsBridgeException`s out of five. `JsBridge` now serialises through a
     * process-wide mutex, so this is serial whether or not it asks to be.
     *
     * Hence the [Flow]: a cold five-holding list is additive, and a person
     * should watch it fill rather than face a blank screen for nine seconds.
     * Each emission carries the holdings resolved so far plus the ones still
     * pending, so nothing appears and then re-orders.
     *
     * A ticker that fails becomes a [Holding] carrying its error rather than
     * vanishing. A holding silently missing from a portfolio view is worse than
     * one that says it could not be loaded: the composite would quietly be an
     * average over a different set than the one on screen.
     */
    fun load(watchlistId: String): Flow<WatchlistView> = flow {
        val lists = watchlists()
        val list = lists.firstOrNull { it.id == watchlistId }
            ?: lists.firstOrNull { it.isDefault }
            ?: lists.first()

        val tickers = runCatching {
            json.parseToJsonElement(list.tickersJson).jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
        }.getOrDefault(emptyList())

        val done = mutableListOf<Holding>()

        // Emit the skeleton first, so the list has its final length and its
        // rows do not shuffle as each one resolves.
        emit(view(list, done, tickers.drop(done.size)))

        for (ticker in tickers) {
            done += loadOne(ticker)
            emit(view(list, done.toList(), tickers.drop(done.size)))
        }
    }.flowOn(Dispatchers.IO)

    private fun view(list: WatchlistRow, done: List<Holding>, pending: List<String>) =
        WatchlistView(
            id = list.id,
            health = composite(list.name, done),
            holdings = done + pending.map { pendingHolding(it) },
            pending = pending.size
        )

    /** A row that is queued but not yet scored. */
    private fun pendingHolding(ticker: String) = Holding(
        ticker = ticker, name = "", price = null, currency = "",
        changePct = null, healthScore = null, healthTier = "moderate",
        roicPct = null, altmanZ = null, roe = null, peRatio = null,
        isFinancial = false, topCatalyst = null, topRisk = null,
        error = null, loading = true
    )

    /**
     * Add a ticker to a list, or report why not.
     *
     * The symbol is checked against the engine before it is stored. An
     * unresolvable ticker is a real answer — `core/host/stock.js` returns
     * `not_found` rather than inventing a company — and storing it unchecked
     * would put a permanent error row on the watchlist that only a removal
     * could clear.
     */
    suspend fun addTicker(watchlistId: String, rawTicker: String): AddResult =
        withContext(Dispatchers.IO) {
            val ticker = rawTicker.trim().uppercase()
            if (ticker.isEmpty()) return@withContext AddResult.Invalid("Enter a ticker symbol.")

            val list = watchlists().firstOrNull { it.id == watchlistId }
                ?: return@withContext AddResult.Invalid("That watchlist no longer exists.")

            val existing = tickersOf(list)
            if (ticker in existing) return@withContext AddResult.Duplicate(ticker)

            val probe = loadOne(ticker)
            if (probe.error != null) {
                return@withContext AddResult.Invalid(
                    when (probe.error) {
                        "not_found" -> "No listing found for $ticker."
                        "rate_limited" -> "The data provider is rate limiting. Try again shortly."
                        "network" -> "No connection to the data provider."
                        else -> "Could not load $ticker."
                    }
                )
            }

            dao.upsertWatchlists(
                listOf(list.copy(tickersJson = json.encodeToString(existing + ticker), updatedAt = isoNow()))
            )
            AddResult.Added(ticker, probe.name)
        }

    suspend fun removeTicker(watchlistId: String, ticker: String) = withContext(Dispatchers.IO) {
        val list = watchlists().firstOrNull { it.id == watchlistId } ?: return@withContext
        dao.upsertWatchlists(
            listOf(
                list.copy(
                    tickersJson = json.encodeToString(tickersOf(list) - ticker.uppercase()),
                    updatedAt = isoNow()
                )
            )
        )
    }

    /**
     * A new, empty list.
     *
     * The id is derived from the name rather than random, matching the PWA's
     * `compounders` / `ai-semis` scheme, so a list created on one client and
     * one created on the other with the same name merge instead of doubling.
     */
    suspend fun createWatchlist(name: String): String = withContext(Dispatchers.IO) {
        val clean = name.trim().ifEmpty { "New watchlist" }
        val base = clean.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "list" }
        val taken = watchlists().map { it.id }.toSet()
        val id = generateSequence(0) { it + 1 }
            .map { if (it == 0) base else "$base-$it" }
            .first { it !in taken }

        dao.upsertWatchlists(
            listOf(WatchlistRow(id = id, name = clean, tickersJson = "[]", isDefault = false, updatedAt = isoNow()))
        )
        id
    }

    private fun tickersOf(list: WatchlistRow): List<String> = runCatching {
        json.parseToJsonElement(list.tickersJson).jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
    }.getOrDefault(emptyList())

    sealed interface AddResult {
        data class Added(val ticker: String, val name: String) : AddResult
        data class Duplicate(val ticker: String) : AddResult
        data class Invalid(val message: String) : AddResult
    }

    private suspend fun loadOne(ticker: String): Holding = try {
        val root = json.parseToJsonElement(engine.stock(ticker)).jsonObject
        if (root["ok"]?.jsonPrimitive?.contentOrNull == "true" ||
            root["ok"]?.jsonPrimitive?.booleanOrNull() == true
        ) {
            parse(ticker, root["data"]!!.jsonObject)
        } else {
            val err = root["error"]?.jsonObject
            Holding(
                ticker = ticker, name = ticker, price = null, currency = "",
                changePct = null, healthScore = null, healthTier = "risk",
                roicPct = null, altmanZ = null, roe = null, peRatio = null,
                isFinancial = false, topCatalyst = null, topRisk = null,
                error = err?.get("kind")?.jsonPrimitive?.contentOrNull ?: "unavailable"
            )
        }
    } catch (err: Throwable) {
        Holding(
            ticker = ticker, name = ticker, price = null, currency = "",
            changePct = null, healthScore = null, healthTier = "risk",
            roicPct = null, altmanZ = null, roe = null, peRatio = null,
            isFinancial = false, topCatalyst = null, topRisk = null,
            error = err.javaClass.simpleName
        )
    }

    private fun parse(ticker: String, data: JsonObject): Holding {
        val summary = data["summary"]?.jsonObject
        val metrics = summary?.get("metrics")?.jsonObject
        val ratios = summary?.get("ratios")?.jsonObject

        fun firstTitle(key: String): String? =
            (data[key] as? JsonArray)?.firstOrNull()?.jsonObject
                ?.get("title")?.jsonPrimitive?.contentOrNull

        return Holding(
            ticker = data.str("ticker") ?: ticker,
            name = data.str("name") ?: ticker,
            price = data.num("price"),
            currency = data.str("currency") ?: "USD",
            changePct = data.num("change_pct"),
            healthScore = data["health_score"]?.jsonPrimitive?.intOrNull,
            healthTier = summary?.str("healthTier") ?: "good",
            roicPct = data.num("roic_pct"),
            altmanZ = data.num("altman_z"),
            roe = metrics?.num("roe"),
            peRatio = ratios?.num("pe"),
            isFinancial = metrics?.get("isFinancial")?.jsonPrimitive?.booleanOrNull() ?: false,
            topCatalyst = firstTitle("catalysts"),
            topRisk = firstTitle("risks")
        )
    }

    /**
     * The composite, over the holdings that could be scored.
     *
     * Unscored holdings are excluded rather than counted as zero — the engine
     * reports `null` when too few line items were filed, and averaging a zero
     * in would turn "we could not measure this" into "this company is bad".
     * The count of what was actually scored travels with the number so the
     * banner can say what it is an average of.
     */
    private fun composite(name: String, holdings: List<Holding>): PortfolioHealth {
        val scores = holdings.mapNotNull { it.healthScore }
        val average = if (scores.isEmpty()) null else scores.sum() / scores.size

        return PortfolioHealth(
            watchlistName = name,
            holdingCount = holdings.size,
            compositeScore = average,
            tier = when {
                average == null -> "risk"
                average >= 85 -> "pristine"
                average >= 70 -> "good"
                average >= 50 -> "moderate"
                else -> "risk"
            },
            scoredCount = scores.size
        )
    }
}

private fun JsonPrimitive.booleanOrNull(): Boolean? =
    when (contentOrNull) { "true" -> true; "false" -> false; else -> null }

private fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.takeUnless { it == "null" }

private fun JsonObject.num(key: String): Double? =
    (this[key] as? JsonPrimitive)?.doubleOrNull

internal fun isoNow(): String =
    java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now())
