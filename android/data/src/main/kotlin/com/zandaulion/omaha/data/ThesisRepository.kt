package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What a person wrote about a company.
 *
 * Doc 15 §3.1 checked the pre-committed sell triggers against all ten platforms
 * in the market survey and found nothing comparable: every competitor optimises
 * the buy decision, and none addresses the exit. This is the differentiator, so
 * the storage is deliberately conservative — nothing here is derived, cached or
 * re-fetchable, and losing it loses the only copy.
 */
@Serializable
data class SellTrigger(
    val id: String,
    val text: String,
    val triggered: Boolean = false
)

@Serializable
data class JournalEntry(
    val id: String,
    /** ISO-8601. Compared through core/time.js semantics, never Date.parse. */
    val date: String,
    val note: String
)

data class Thesis(
    val ticker: String,
    val conviction: String,
    val targetBuyPrice: Double?,
    val coreRationale: String,
    val moatTags: List<String>,
    val sellTriggers: List<SellTrigger>,
    val journalEntries: List<JournalEntry>,
    val updatedAt: String
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

    /**
     * The three triggers the PWA seeds an empty thesis with.
     *
     * Prompts rather than defaults: the point of a pre-committed exit rule is
     * that it is written while calm, and a blank box asks a question most
     * people answer with nothing. These are examples to edit, and they are
     * identical to the web client's so the two do not disagree on first open.
     */
    private fun starterTriggers() = listOf(
        SellTrigger("1", "Gross margin drops below 55% for 2 quarters"),
        SellTrigger("2", "Total debt exceeds 2.5x annual EBITDA"),
        SellTrigger("3", "Share dilution exceeds 3% from SBC")
    )

    suspend fun load(ticker: String): Thesis = withContext(Dispatchers.IO) {
        val row = dao.theses().firstOrNull { it.ticker.equals(ticker, ignoreCase = true) }
            ?: return@withContext Thesis(
                ticker = ticker.uppercase(),
                conviction = "high",
                targetBuyPrice = null,
                coreRationale = "",
                moatTags = emptyList(),
                sellTriggers = starterTriggers(),
                journalEntries = emptyList(),
                updatedAt = isoNow()
            )

        Thesis(
            ticker = row.ticker,
            conviction = row.conviction,
            targetBuyPrice = row.targetBuyPrice,
            coreRationale = row.coreRationale,
            moatTags = decode(row.moatTagsJson),
            sellTriggers = decodeTriggers(row.sellTriggersJson).ifEmpty { starterTriggers() },
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
        dao.upsertTheses(
            listOf(
                ThesisRow(
                    ticker = stamped.ticker.uppercase(),
                    conviction = stamped.conviction,
                    targetBuyPrice = stamped.targetBuyPrice,
                    coreRationale = stamped.coreRationale,
                    moatTagsJson = json.encodeToString(stamped.moatTags),
                    sellTriggersJson = json.encodeToString(stamped.sellTriggers),
                    journalEntriesJson = json.encodeToString(stamped.journalEntries),
                    updatedAt = stamped.updatedAt
                )
            )
        )
        stamped
    }

    /**
     * Journal entries are append-only and are never edited or deleted.
     *
     * That is what lets `core/backup.js` union them across devices instead of
     * picking a winner. An edit would make two copies genuinely different and
     * the merge would have to choose, which is how somebody's note goes missing.
     */
    suspend fun addJournalEntry(ticker: String, note: String): Thesis {
        val thesis = load(ticker)
        val entry = JournalEntry(
            // Matches the PWA's scheme, which is Date.now(). Unique on one
            // device and not across two — core/backup.js handles the collision
            // by keeping both and disambiguating, rather than dropping one.
            id = System.currentTimeMillis().toString(),
            date = isoNow(),
            note = note.trim()
        )
        return save(thesis.copy(journalEntries = thesis.journalEntries + entry))
    }

    private fun decode(raw: String): List<String> =
        runCatching { json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())

    private fun decodeTriggers(raw: String): List<SellTrigger> =
        runCatching { json.decodeFromString<List<SellTrigger>>(raw) }.getOrDefault(emptyList())

    private fun decodeEntries(raw: String): List<JournalEntry> =
        runCatching { json.decodeFromString<List<JournalEntry>>(raw) }.getOrDefault(emptyList())
}
