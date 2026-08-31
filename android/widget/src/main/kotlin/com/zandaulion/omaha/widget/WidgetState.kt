package com.zandaulion.omaha.widget

import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey

/**
 * The one vocabulary [PocketOmahaWidgetConfig], the refresh worker, and
 * [PocketOmahaWidget]'s own `provideGlance` all read and write, through
 * Glance's `PreferencesGlanceStateDefinition` — keyed automatically per
 * `GlanceId`, which is what "each widget instance tracks its own watchlist"
 * needs without a hand-rolled `appWidgetId → watchlistId` table.
 *
 * `moversText` carries `ticker|delta` pairs joined by `;` (e.g. `"AAPL|8;NVDA|-3"`)
 * rather than JSON — this state is per-instance UI cache with exactly one
 * producer ([:app]'s refresh worker) and one consumer ([PocketOmahaWidget]),
 * so a delimited string avoids pulling a JSON parser into this module for a
 * format nothing else ever reads.
 */
object WidgetKeys {
    val watchlistId = stringPreferencesKey("watchlistId")
    val watchlistName = stringPreferencesKey("watchlistName")
    val score = intPreferencesKey("score")
    val previousScore = intPreferencesKey("previousScore")
    val tier = stringPreferencesKey("tier")
    val moversText = stringPreferencesKey("moversText")
    val updatedAt = stringPreferencesKey("updatedAt")
}

/** `"AAPL|8;NVDA|-3"` → `[("AAPL", 8), ("NVDA", -3)]`. The inverse of how `:app`'s refresh worker joins `WidgetMover` into this same format. */
fun parseMoversText(text: String?): List<Pair<String, Int>> =
    text?.split(';')?.filter { it.isNotBlank() }?.mapNotNull { entry ->
        val parts = entry.split('|')
        val ticker = parts.getOrNull(0) ?: return@mapNotNull null
        val delta = parts.getOrNull(1)?.toIntOrNull() ?: return@mapNotNull null
        ticker to delta
    } ?: emptyList()
