package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.util.UUID

/**
 * What a person wrote about a company.
 *
 * Personal reasoning, manual conditions and review history are not re-fetchable.
 * Preserve them independently of the scored stock cache.
 */
data class SellTrigger(
    val id: String,
    val text: String,
    val triggered: Boolean = false
)

data class JournalEntry(
    val id: String,
    /** ISO-8601. Compared through core/time.js semantics, never Date.parse. */
    val date: String,
    val note: String,
    val kind: String = "note",
    val assessment: String? = null
)

data class Thesis(
    val ticker: String,
    val conviction: String,
    val targetBuyPrice: Double?,
    val coreRationale: String,
    val moatTags: List<String>,
    val sellTriggers: List<SellTrigger>,
    val journalEntries: List<JournalEntry>,
    val updatedAt: String,
    val mustRemainTrue: String = ""
)

/**
 * Reads and writes theses, in the interchange shape both clients use.
 *
 * The JSON column encodings match `server/db.js` exactly — `sellTriggersJson`
 * here is the same text `sell_triggers_json` holds there — because
 * `core/backup.js` reads both. A field spelled differently would be a field
 * that silently fails to import, and the merge rules exist precisely so that a
 * thesis edited on one device and a note written on another do not cost each
 * other.
 */
class ThesisRepository(private val dao: PersonalDataDao) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun load(ticker: String): Thesis = withContext(Dispatchers.IO) {
        val row = dao.theses().firstOrNull { it.ticker.equals(ticker, ignoreCase = true) }
            ?: return@withContext Thesis(
                ticker = ticker.uppercase(),
                conviction = "high",
                targetBuyPrice = null,
                coreRationale = "",
                moatTags = emptyList(),
                sellTriggers = emptyList(),
                journalEntries = emptyList(),
                updatedAt = isoNow()
            )

        Thesis(
            ticker = row.ticker,
            conviction = row.conviction,
            targetBuyPrice = row.targetBuyPrice,
            coreRationale = row.coreRationale,
            mustRemainTrue = row.mustRemainTrue,
            moatTags = decode(row.moatTagsJson),
            sellTriggers = decodeTriggers(row.sellTriggersJson),
            journalEntries = decodeEntries(row.journalEntriesJson),
            updatedAt = row.updatedAt
        )
    }

    /**
     * Writes the whole thesis, stamping `updatedAt`.
     *
     * The timestamp is the merge key: `core/backup.js` takes the newer version
     * of a thesis whole, so a write that failed to advance it would lose the
     * edit on the next restore rather than at the time — the worst moment to
     * find out.
     */
    suspend fun save(thesis: Thesis): Thesis = withContext(Dispatchers.IO) {
        val stamped = thesis.copy(updatedAt = isoNow())
        dao.saveThesisPreservingJournal(
                ThesisRow(
                    ticker = stamped.ticker.uppercase(),
                    conviction = stamped.conviction,
                    targetBuyPrice = stamped.targetBuyPrice,
                    coreRationale = stamped.coreRationale,
                    mustRemainTrue = stamped.mustRemainTrue,
                    moatTagsJson = json.encodeToString(stamped.moatTags),
                    sellTriggersJson = JsonArray(stamped.sellTriggers.map { it.toJson() }).toString(),
                    journalEntriesJson = JsonArray(stamped.journalEntries.map { it.toJson() }).toString(),
                    updatedAt = stamped.updatedAt
                )
        )
        load(stamped.ticker)
    }

    /**
     * Journal entries are append-only and are never edited or deleted.
     *
     * That is what lets `core/backup.js` union them across devices instead of
     * picking a winner. An edit would make two copies genuinely different and
     * the merge would have to choose, which is how somebody's note goes missing.
     */
    suspend fun addJournalEntry(ticker: String, note: String): Thesis {
        val entry = JournalEntry(
            id = UUID.randomUUID().toString(),
            date = isoNow(),
            note = note.trim()
        )
        withContext(Dispatchers.IO) {
            dao.appendThesisEntry(ticker.uppercase(), entry.toJson().toString(), entry.date)
        }
        return load(ticker)
    }

    suspend fun recordReview(ticker: String, assessment: String, note: String): Thesis {
        require(assessment in setOf("intact", "watch", "changed")) { "Invalid review assessment" }
        val entry = JournalEntry(UUID.randomUUID().toString(), isoNow(), note.trim(), "review", assessment)
        withContext(Dispatchers.IO) {
            dao.appendThesisEntry(ticker.uppercase(), entry.toJson().toString(), entry.date)
        }
        return load(ticker)
    }

    private fun decode(raw: String): List<String> =
        runCatching { json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())

    private fun decodeTriggers(raw: String): List<SellTrigger> =
        Json.parseToJsonElement(raw).jsonArray.map { element ->
            val obj = element.jsonObject
            SellTrigger(obj.string("id"), obj.string("text"), obj["triggered"]?.jsonPrimitive?.booleanOrNull ?: false)
        }

    private fun decodeEntries(raw: String): List<JournalEntry> =
        parseJournalEntries(raw)
}

// The data module intentionally uses JsonElement and has no serialization
// compiler plugin. Explicit mapping also stops a missing serializer from
// silently turning a person's saved journal into an empty list.
internal fun parseJournalEntries(raw: String): List<JournalEntry> =
    Json.parseToJsonElement(raw).jsonArray.map { element ->
        val obj = element.jsonObject
        JournalEntry(obj.string("id"), obj.string("date"), obj.string("note"),
            obj["kind"]?.jsonPrimitive?.contentOrNull ?: "note",
            obj["assessment"]?.jsonPrimitive?.contentOrNull)
    }

internal fun JournalEntry.toJson(): JsonObject = buildJsonObject {
    put("id", id); put("date", date); put("note", note); put("kind", kind)
    put("assessment", assessment?.let(::JsonPrimitive) ?: JsonNull)
}

private fun SellTrigger.toJson(): JsonObject = buildJsonObject {
    put("id", id); put("text", text); put("triggered", triggered)
}

private fun JsonObject.string(key: String): String = this[key]?.jsonPrimitive?.contentOrNull ?: ""
