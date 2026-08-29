package com.zandaulion.omaha.data

/**
 * Assembles the one call [RelayRepository] cannot make on its own:
 * `generateAiSummary` needs the engine's raw scored-stock JSON and, per
 * [AppSettings.aiIncludeNotes] (off by default, doc 13 §7), the user's
 * thesis. Every other relay call — the cached read, the balance, the free
 * grant, a purchase redemption — needs no stock context and is called
 * directly against [RelayRepository] rather than through here.
 */
class AiRepository(
    private val details: StockDetailRepository,
    private val theses: ThesisRepository,
    private val settings: AppSettings,
    private val relay: RelayRepository
) {
    suspend fun generate(ticker: String): RelayRepository.GenerateResult {
        val stockJson = details.rawJson(ticker)
        val thesis = if (settings.aiIncludeNotes()) theses.load(ticker) else null
        return relay.generateSummary(ticker, stockJson, thesis)
    }
}
