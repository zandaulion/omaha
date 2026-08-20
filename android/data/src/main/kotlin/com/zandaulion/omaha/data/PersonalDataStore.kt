package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Translates between Room rows and the interchange shape.
 *
 * The direct counterpart of `server/backup-store.js`. Both sides exist because
 * each host stores differently; neither interprets what a backup *means* —
 * that is `core/backup.js`, and it runs unmodified on both.
 *
 * The interchange shape is defined by that module, not by a Kotlin type. Data
 * classes mirroring it would be a second definition of the format, and the
 * first field added on one side and forgotten on the other would be written
 * and never read.
 */
class PersonalDataStore(private val dao: PersonalDataDao) {

    /** Everything a backup carries, as `core/backup.js` expects it. */
    suspend fun read(): String = buildJsonObject {
        put("theses", buildJsonArray {
            for (t in dao.theses()) add(buildJsonObject {
                put("ticker", JsonPrimitive(t.ticker))
                put("conviction", JsonPrimitive(t.conviction))
                put("targetBuyPrice", t.targetBuyPrice?.let(::JsonPrimitive) ?: JsonNull)
                put("coreRationale", JsonPrimitive(t.coreRationale))
                // Already JSON on disk; re-encoding as a string would nest it.
                put("moatTags", parseArray(t.moatTagsJson))
                put("sellTriggers", parseArray(t.sellTriggersJson))
                put("journalEntries", parseArray(t.journalEntriesJson))
                put("updatedAt", JsonPrimitive(t.updatedAt))
            })
        })
        put("watchlists", buildJsonArray {
            for (w in dao.watchlists()) add(buildJsonObject {
                put("id", JsonPrimitive(w.id))
                put("name", JsonPrimitive(w.name))
                put("tickers", parseArray(w.tickersJson))
                // The PWA's spelling. core/backup.js accepts both and writes
                // this one; matching it keeps the two exports byte-comparable.
                put("is_default", JsonPrimitive(w.isDefault))
                put("updatedAt", JsonPrimitive(w.updatedAt))
            })
        })
    }.toString()

    /**
     * Write a merge result back.
     *
     * @param mergedJson the `{theses, watchlists, report}` object from
     *   `core/backup.js`. The report is ignored here; the caller reports it.
     */
    suspend fun write(mergedJson: String, fallbackTimestamp: String) {
        val merged = Json.parseToJsonElement(mergedJson).jsonObject

        val theses = (merged["theses"] as? JsonArray).orEmpty().map { element ->
            val o = element.jsonObject
            ThesisRow(
                ticker = o.str("ticker") ?: error("a thesis with no ticker"),
                conviction = o.str("conviction") ?: "high",
                targetBuyPrice = o["targetBuyPrice"]?.jsonPrimitive?.doubleOrNull,
                coreRationale = o.str("coreRationale") ?: "",
                moatTagsJson = (o["moatTags"] ?: JsonArray(emptyList())).toString(),
                sellTriggersJson = (o["sellTriggers"] ?: JsonArray(emptyList())).toString(),
                journalEntriesJson = (o["journalEntries"] ?: JsonArray(emptyList())).toString(),
                // The merge already decided which version won; keeping its
                // timestamp is what makes a repeated import a no-op. Stamping
                // "now" would make every import look like the newest edit.
                updatedAt = o.str("updatedAt") ?: fallbackTimestamp
            )
        }

        val watchlists = (merged["watchlists"] as? JsonArray).orEmpty().map { element ->
            val o = element.jsonObject
            WatchlistRow(
                id = o.str("id") ?: error("a watchlist with no id"),
                name = o.str("name") ?: "",
                tickersJson = (o["tickers"] ?: JsonArray(emptyList())).toString(),
                isDefault = o["is_default"]?.jsonPrimitive?.contentOrNull == "true",
                updatedAt = o.str("updatedAt") ?: fallbackTimestamp
            )
        }

        dao.replaceAll(theses, watchlists)
    }

    private companion object {
        fun parseArray(text: String): JsonElement =
            runCatching { Json.parseToJsonElement(text).jsonArray }
                .getOrElse { JsonArray(emptyList()) }

        fun JsonObject.str(key: String): String? =
            this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }

        fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
    }
}
