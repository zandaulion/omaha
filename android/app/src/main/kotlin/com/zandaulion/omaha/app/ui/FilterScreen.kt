package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlin.math.roundToInt

/**
 * Narrows the companies already followed. Matches `#viewFilter`.
 *
 * **Not a screener**, and the screen says so rather than leaving it to be
 * discovered. Doc 15 §2.5 identified the expectation "screener" sets — a search
 * across a market — and renaming the view was only half the fix: the concept
 * sets it too, so the subtitle states the scope on every visit.
 *
 * It filters what the watchlist already loaded rather than fetching. Everything
 * here is in memory and already scored, so the filters apply instantly and no
 * network is touched.
 */
@Composable
fun FilterScreen(state: WatchlistUiState, onRetry: () -> Unit, onSelect: (String) -> Unit) {
    when (state) {
        is WatchlistUiState.Loading -> CentredMessage(
            "Scoring…", "Filters apply to the companies you already follow."
        )
        is WatchlistUiState.Failed -> CentredMessage(
            "Could not load", state.message, actionLabel = "Try again", onAction = onRetry
        )
        is WatchlistUiState.Ready -> Loaded(state.view.holdings, onSelect)
    }
}

private data class Filters(
    val minHealth: Int = 0,
    val minRoic: Int = 0,
    val netCashOnly: Boolean = false
)

@Composable
private fun Loaded(holdings: List<Holding>, onSelect: (String) -> Unit) {
    var filters by remember { mutableStateOf(Filters()) }
    var preset by remember { mutableStateOf("all") }

    // A holding that could not be scored is excluded from a score filter rather
    // than treated as zero — the same rule the composite follows. Filtering
    // "health ≥ 70" should not silently assert that an unmeasurable company
    // failed the test; it did not take it.
    val matches = holdings.filter { h ->
        if (h.error != null) return@filter false
        val health = h.healthScore ?: return@filter filters.minHealth == 0
        if (health < filters.minHealth) return@filter false
        if (filters.minRoic > 0 && (h.roicPct ?: -1.0) < filters.minRoic) return@filter false
        true
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Column {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicText(
                        "🔍 Filter your watchlist",
                        style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                    )
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(OmahaRadius.pill))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        BasicText(
                            "${matches.size} of ${holdings.size}",
                            style = OmahaType.caption
                                .toTextStyle(color = Omaha.colors.textSecondary)
                                .copy(fontFamily = Omaha.fonts.mono)
                        )
                    }
                }
                Box(Modifier.height(4.dp))
                BasicText(
                    "Narrows the companies you already follow. This does not search the " +
                        "wider market — nothing appears here that you have not looked up before.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )
            }
        }

        item {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                for ((key, label, f) in listOf(
                    Triple("all", "All", Filters()),
                    Triple("fortress", "👑 Fortress (≥ 85)", Filters(minHealth = 85)),
                    Triple("roic", "🚀 ROIC ≥ 20%", Filters(minRoic = 20)),
                    Triple("cash", "💎 Net cash", Filters(netCashOnly = true))
                )) {
                    val active = key == preset
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(OmahaRadius.pill))
                            .background(
                                if (active) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle
                            )
                            .clickable { preset = key; filters = f }
                            .padding(horizontal = 12.dp, vertical = 7.dp)
                    ) {
                        BasicText(
                            label,
                            style = OmahaType.caption.toTextStyle(
                                color = if (active) Omaha.colors.bgCanvas
                                else Omaha.colors.textSecondary
                            )
                        )
                    }
                }
            }
        }

        item {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(OmahaRadius.md))
                    .background(Omaha.colors.bgSurface)
                    .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.md))
                    .padding(14.dp)
            ) {
                FilterSlider("Minimum health score", "${filters.minHealth}", filters.minHealth.toFloat(), 0f..95f, 18) {
                    filters = filters.copy(minHealth = it.roundToInt()); preset = ""
                }
                FilterSlider("Minimum ROIC", "${filters.minRoic}%", filters.minRoic.toFloat(), 0f..40f, 39) {
                    filters = filters.copy(minRoic = it.roundToInt()); preset = ""
                }
            }
        }

        if (matches.isEmpty()) {
            item {
                BasicText(
                    "Nothing on your watchlist meets these filters. That is a statement " +
                        "about your holdings, not about the market.",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                )
            }
        }

        items(matches, key = { it.ticker }) { h ->
            FilterRow(h) { onSelect(h.ticker) }
        }
    }
}

@Composable
private fun FilterSlider(
    label: String,
    display: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    onChange: (Float) -> Unit
) {
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(label, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
            BasicText(
                display,
                style = OmahaType.bodySm
                    .toTextStyle(color = Omaha.colors.brandCyan)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
        Slider(
            value = value,
            onValueChange = onChange,
            valueRange = range,
            steps = steps,
            colors = SliderDefaults.colors(
                thumbColor = Omaha.colors.brandCyan,
                activeTrackColor = Omaha.colors.brandCyan,
                inactiveTrackColor = Omaha.colors.bgSurfaceSubtle,
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent
            )
        )
    }
}

@Composable
private fun FilterRow(h: Holding, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.md))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.md))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            BasicText(
                h.ticker,
                style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
            BasicText(
                h.name,
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary),
                maxLines = 1
            )
        }
        BasicText(
            "ROIC ${fmtPercent(h.roicPct)}",
            style = OmahaType.caption
                .toTextStyle(color = Omaha.colors.textTertiary)
                .copy(fontFamily = Omaha.fonts.mono)
        )
        Box(Modifier.padding(start = 10.dp)) {
            BasicText(
                h.healthScore?.let { "$it/100" } ?: "Not scored",
                style = OmahaType.caption
                    .toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
    }
}
