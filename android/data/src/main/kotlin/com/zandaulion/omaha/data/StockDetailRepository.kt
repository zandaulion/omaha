package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Raised when the engine answered, but with a failure rather than a company. */
class StockUnavailable(val kind: String, message: String) : Exception(message)

/**
 * One ticker, scored, for the deep dive.
 *
 * Shares the engine with [WatchlistRepository] rather than starting a second
 * one: `core/host/stock.js` checks the cache first, so a ticker opened from the
 * watchlist is already warm and returns in about 21 ms rather than 1,800.
 */
class StockDetailRepository(private val engine: StockEngine) {

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun detail(ticker: String, forceRefresh: Boolean = false): StockDetail =
        withContext(Dispatchers.IO) {
            val root = json.parseToJsonElement(engine.stock(ticker, forceRefresh)).jsonObject

            val ok = root["ok"]?.jsonPrimitive?.contentOrNull.let { it == "true" }
            if (!ok) {
                val err = root["error"]?.jsonObject
                throw StockUnavailable(
                    kind = err?.text("kind") ?: "unavailable",
                    message = err?.text("message") ?: "Could not load $ticker."
                )
            }

            parse(root["data"]!!.jsonObject)
        }

    private fun parse(d: JsonObject): StockDetail {
        val summary = d["summary"]?.jsonObject
        val metrics = summary?.get("metrics")?.jsonObject

        return StockDetail(
            ticker = d.text("ticker") ?: "",
            name = d.text("name") ?: "",
            sector = d.text("sector") ?: "Equities",
            industry = d.text("industry") ?: "Core Business",
            price = d.dbl("price"),
            currency = d.text("currency") ?: "USD",
            changePct = d.dbl("change_pct"),
            healthScore = d["health_score"]?.jsonPrimitive?.intOrNull,
            healthTier = summary?.text("healthTier") ?: "moderate",
            healthLabel = summary?.text("healthLabel")
                ?: "Not enough filed data to score",
            fiscalPeriodEnd = metrics?.text("fiscalPeriodEnd"),
            coverage = summary?.get("coverage")?.jsonObject?.let {
                Coverage(
                    measured = it.int("measured") ?: 0,
                    total = it.int("total") ?: 0,
                    pct = it.int("pct") ?: 0,
                    sufficient = it.bool("sufficient") ?: true
                )
            },
            fx = d["financials"]?.jsonObject?.get("fx")?.jsonObject?.let {
                FxNote(
                    needed = it.bool("needed") ?: false,
                    available = it.bool("available") ?: false,
                    from = it.text("from") ?: "",
                    to = it.text("to") ?: "",
                    rate = it.dbl("rate") ?: 1.0
                )
            },
            pillars = (d["pillars"] as? JsonArray).orEmpty().map { el ->
                val p = el.jsonObject
                Pillar(
                    name = p.text("name") ?: "",
                    score = p.int("score") ?: 0,
                    max = p.int("max") ?: 20,
                    pct = p.int("pct") ?: 0,
                    measured = p.int("measured") ?: 0,
                    of = p.int("of") ?: 0
                )
            },
            checklist = (d["checklist"] as? JsonArray).orEmpty().map { el ->
                val c = el.jsonObject
                Check(
                    id = c.int("id") ?: 0,
                    name = c.text("name") ?: "",
                    category = c.text("category") ?: "",
                    status = c.text("status") ?: "na",
                    value = c.text("value"),
                    benchmark = c.text("benchmark"),
                    explanation = c.text("explanation") ?: ""
                )
            },
            history = (d["financials"]?.jsonObject?.get("historical")?.jsonObject).let { h ->
                History(
                    years = h.ints("years"),
                    revenue = h.dbls("revenue"),
                    freeCashFlow = h.dbls("freeCashFlow"),
                    grossMarginPct = h.dbls("grossMarginPct"),
                    operatingMarginPct = h.dbls("operatingMarginPct"),
                    sharesOutstanding = h.dbls("sharesOutstanding"),
                    cagrYears = h?.int("cagrYears"),
                    revenueCagr = h?.dbl("revenueCAGR"),
                    shareChangeYoY = h?.dbl("shareChangeYoY")
                )
            },
            balanceSheet = BalanceSheet(
                cash = metrics?.dbl("cash"),
                totalDebt = metrics?.dbl("totalDebt"),
                netCash = metrics?.dbl("netCash"),
                grossMarginChangeBps = metrics?.int("grossMarginChangeBps"),
                operatingMarginChangeBps = metrics?.int("operatingMarginChangeBps"),
                fcfConversionPct = d.dbl("fcf_conversion_pct"),
                reportingCurrency = metrics?.text("reportingCurrency") ?: d.text("currency") ?: "USD"
            ),
            checklistSummary = summary?.get("checklistSummary")?.jsonObject.let {
                ChecklistSummary(
                    pass = it?.int("passCount") ?: 0,
                    watch = it?.int("watchCount") ?: 0,
                    fail = it?.int("failCount") ?: 0,
                    na = it?.int("naCount") ?: 0
                )
            }
        )
    }
}

/**
 * A numeric series, preserving JSON nulls as Kotlin nulls.
 *
 * `mapNotNull` would be the reflex here and would silently shorten the list,
 * sliding every later year one position left against `years`. The gaps are the
 * information.
 */
private fun JsonObject?.dbls(key: String): List<Double?> =
    (this?.get(key) as? JsonArray)?.map { (it as? JsonPrimitive)?.doubleOrNull } ?: emptyList()

private fun JsonObject?.ints(key: String): List<Int?> =
    (this?.get(key) as? JsonArray)?.map { (it as? JsonPrimitive)?.intOrNull } ?: emptyList()

private fun JsonArray?.orEmpty(): List<kotlinx.serialization.json.JsonElement> = this ?: emptyList()

/**
 * `null` and the JSON string "null" are the same answer here.
 *
 * `core/` writes an unmeasurable value as JSON null, but a few fields arrive
 * already stringified. Treating "null" as text would print the word on screen,
 * which is the one thing worse than an em dash.
 */
private fun JsonObject.text(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.takeUnless { it == "null" || it.isEmpty() }

private fun JsonObject.dbl(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
private fun JsonObject.bool(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.let { it == "true" }
