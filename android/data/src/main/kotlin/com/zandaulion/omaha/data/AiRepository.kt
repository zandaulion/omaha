package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * Assembles the one call [RelayRepository] cannot make on its own —
 * `generateAiSummary` needs the engine's raw scored-stock JSON and, per
 * [AppSettings.aiIncludeNotes] (off by default, doc 13 §7), the user's
 * thesis — and owns the on-device cache both [cachedSummary] and [generate]
 * write through to.
 *
 * The relay already caches by ticker (`functions/src/analyze.js`), so this
 * is a second tier rather than the only one: it saves the round trip on a
 * ticker this device has already seen, the way [StockDetailRepository]'s
 * warm cache saves re-fetching a filing. Every other relay call — the
 * balance, the free grant, a purchase redemption — needs no stock context
 * and no local cache, and is called directly against [RelayRepository].
 */
class AiRepository(
    private val details: StockDetailRepository,
    private val theses: ThesisRepository,
    private val settings: AppSettings,
    private val relay: RelayRepository,
    private val cache: AiSummaryDao
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Local cache first, then the relay's own shared-by-ticker cache. `null` for a genuine miss on both. */
    suspend fun cachedSummary(ticker: String): AiSummary? {
        cache.find(ticker)?.let { row ->
            runCatching { parseAiSummaryObject(json.parseToJsonElement(row.summaryJson).jsonObject) }
                .getOrNull()
                ?.let { return it }
            // A row that no longer parses (a field renamed since it was
            // written) is worth re-fetching, not worth crashing over.
        }
        val summary = relay.getCachedSummary(ticker) ?: return null
        store(ticker, summary)
        return summary
    }

    suspend fun generate(ticker: String): RelayRepository.GenerateResult {
        val stockJson = details.rawJson(ticker)
        val thesis = if (settings.aiIncludeNotes()) theses.load(ticker) else null
        val result = relay.generateSummary(ticker, stockJson, thesis)
        store(ticker, result.summary)
        return result
    }

    private suspend fun store(ticker: String, summary: AiSummary) {
        cache.upsert(
            AiSummaryRow(
                ticker = ticker,
                summaryJson = summary.toJsonObject().toString(),
                cachedAt = java.time.Instant.now().toString()
            )
        )
    }
}
