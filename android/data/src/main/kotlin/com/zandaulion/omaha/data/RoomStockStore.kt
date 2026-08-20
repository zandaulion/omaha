package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The storage contract from `core/store.js`, backed by Room.
 *
 * The direct counterpart of `server/store.js`. Four calls, and not one of them
 * decides anything: the median that the sector query feeds is computed in
 * `core/`, because it is a scoring input and a host computing it independently
 * would be a second definition of a number the user is shown.
 *
 * Timestamps are written as ISO-8601, where the PWA writes SQLite's
 * `datetime('now')`. Both are read through `core/time.js`, which is the only
 * reason a thesis cached on the phone and one cached in the browser compare
 * correctly rather than by whichever host wrote them.
 */
class RoomStockStore(
    private val dao: StockCacheDao,
    private val now: () -> String = { java.time.Instant.now().toString() }
) {

    /** `{ticker}` in, the cached row or nothing out. */
    suspend fun read(payloadJson: String): String {
        val ticker = payloadJson.field("ticker") ?: return ""
        val row = dao.find(ticker) ?: return ""

        // The record is returned as stored, with the two timestamps the store
        // owns folded in. core/stock.js reads those to decide whether either
        // cache tier is still valid; they are not part of the record because
        // the record does not know when it was written.
        val record = Json.parseToJsonElement(row.recordJson).jsonObject
        return buildJsonObject {
            for ((key, value) in record) put(key, value)
            put("last_fetched_at", JsonPrimitive(row.lastFetchedAt))
            put(
                "financials_fetched_at",
                row.financialsFetchedAt?.let(::JsonPrimitive) ?: JsonNull
            )
        }.toString()
    }

    /** `{record, hasFundamentals}` in, nothing out. */
    suspend fun save(payloadJson: String): String {
        val payload = Json.parseToJsonElement(payloadJson).jsonObject
        val record = payload["record"]?.jsonObject ?: return ""
        val hasFundamentals =
            payload["hasFundamentals"]?.jsonPrimitive?.contentOrNull == "true"

        val ticker = record.str("ticker") ?: return ""
        val stamp = now()

        // A quote-only refresh must not advance the statement timestamp, or
        // stale filings would look fresh and the 24-hour tier would stop
        // meaning anything. The previous value is kept rather than cleared.
        val previous = dao.find(ticker)
        dao.upsert(
            StockCacheRow(
                ticker = ticker,
                name = record.str("name") ?: ticker,
                sector = record.str("sector"),
                healthScore = record["health_score"]?.jsonPrimitive?.intOrNull,
                recordJson = record.toString(),
                financialsJson = record["financials_json"]?.jsonPrimitive?.contentOrNull,
                lastFetchedAt = stamp,
                financialsFetchedAt =
                    if (hasFundamentals) stamp else previous?.financialsFetchedAt
            )
        )
        return ""
    }

    /** `{query}` in, locally known tickers out. */
    suspend fun searchCached(payloadJson: String): String {
        val query = payloadJson.field("query")?.trim()?.uppercase().orEmpty()
        if (query.isEmpty()) return "[]"

        val rows = dao.search(exact = query, prefix = "$query%", anywhere = "%$query%")
        return buildJsonArray {
            for (row in rows) add(buildJsonObject {
                put("ticker", JsonPrimitive(row.ticker))
                put("name", JsonPrimitive(row.name))
                put("sector", row.sector?.let(::JsonPrimitive) ?: JsonNull)
                put("health_score", row.healthScore?.let(::JsonPrimitive) ?: JsonNull)
            })
        }.toString()
    }

    /** `{sector, excludeTicker}` in, parsed financials for the peers out. */
    suspend fun sectorFinancials(payloadJson: String): String {
        val payload = Json.parseToJsonElement(payloadJson).jsonObject
        val sector = payload.str("sector") ?: return "[]"
        val exclude = payload.str("excludeTicker").orEmpty()

        return buildJsonArray {
            for (text in dao.sectorFinancials(sector, exclude)) {
                // A row that will not parse is not a data point.
                runCatching { Json.parseToJsonElement(text) }.getOrNull()?.let { add(it) }
            }
        }.toString()
    }

    /** The four host functions, named as `core/host/stock.js` expects them. */
    fun hostFunctions(): Map<String, suspend (Array<Any?>) -> String> = mapOf(
        "__storeRead" to { args -> read(args.firstArg()) },
        "__storeSave" to { args -> save(args.firstArg()) },
        "__storeSearch" to { args -> searchCached(args.firstArg()) },
        "__storeSector" to { args -> sectorFinancials(args.firstArg()) }
    )

    private companion object {
        fun Array<Any?>.firstArg(): String = firstOrNull() as? String ?: "{}"

        fun JsonObject.str(key: String): String? =
            this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }

        fun String.field(key: String): String? =
            runCatching { Json.parseToJsonElement(this).jsonObject.str(key) }.getOrNull()
    }
}
