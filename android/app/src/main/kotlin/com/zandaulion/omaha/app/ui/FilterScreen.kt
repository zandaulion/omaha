package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlin.math.roundToInt

@Composable
fun FilterScreen(holdings: List<Holding>, onSelect: (String) -> Unit) {
    var filters by remember { mutableStateOf(Filters()) }
    var sectorOpen by remember { mutableStateOf(false) }
    val matches = holdings.filter(filters::matches)

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    BasicText("Filter watchlist", style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary).copy(fontWeight = FontWeight.Bold))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        BasicText(
                            "${matches.size} of ${holdings.size}",
                            modifier = Modifier.background(Color(0xFFECFDF5), RoundedCornerShape(9.dp))
                                .border(1.dp, Color(0xFFA7E8D4), RoundedCornerShape(9.dp))
                                .padding(horizontal = 8.dp, vertical = 5.dp),
                            style = OmahaType.caption.toTextStyle(color = Color(0xFF059669)).copy(fontWeight = FontWeight.Bold)
                        )
                        BasicText(
                            "Reset",
                            modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                .clickable { filters = Filters() }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.brandCyan)
                        )
                    }
                }
                BasicText(
                    "Narrows the companies you already follow. This does not search the wider market — nothing appears here that you have not looked up before.",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
        }
        item {
            val presets = listOf(
                "All companies" to Filters(),
                "Strong fundamentals" to Filters(85, 7, 15, 5f, fcfPositive = true),
                "High ROIC (20%+)" to Filters(70, 6, 20, 5f),
                "Net cash only" to Filters(netCashOnly = true)
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                presets.chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { (label, value) ->
                            BasicText(
                                label,
                                modifier = Modifier.weight(1f)
                                    .background(Omaha.colors.bgSurfaceSubtle, RoundedCornerShape(8.dp))
                                    .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(8.dp))
                                    .clickable { filters = value }.padding(horizontal = 10.dp, vertical = 10.dp),
                                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                            )
                        }
                    }
                }
            }
        }
        item {
            OmahaCard(contentPadding = 18.dp) {
                FilterSlider("Min fundamental score", "${filters.minHealth}", filters.minHealth.toFloat(), 0f..95f, 18) {
                    filters = filters.copy(minHealth = it.roundToInt())
                }
                FilterSlider("Min Piotroski F-Score", "${filters.minPiotroski}/9", filters.minPiotroski.toFloat(), 0f..9f, 8) {
                    filters = filters.copy(minPiotroski = it.roundToInt())
                }
                FilterSlider("Min ROIC %", "${filters.minRoic}%", filters.minRoic.toFloat(), 0f..40f, 19) {
                    filters = filters.copy(minRoic = it.roundToInt())
                }
                FilterSlider(
                    "Max debt / equity",
                    if (filters.maxDebtToEquity >= 5f) "any" else fmtRatio(filters.maxDebtToEquity.toDouble(), 2, "x"),
                    filters.maxDebtToEquity, 0f..5f, 19
                ) { filters = filters.copy(maxDebtToEquity = (it * 4).roundToInt() / 4f) }
                FilterCheck("Net cash only", filters.netCashOnly) { filters = filters.copy(netCashOnly = it) }
                FilterCheck("Positive free cash flow", filters.fcfPositive) { filters = filters.copy(fcfPositive = it) }
                BasicText("Sector", modifier = Modifier.padding(top = 10.dp, bottom = 7.dp),
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary).copy(fontWeight = FontWeight.Bold))
                Row(
                    Modifier.fillMaxWidth().background(Omaha.colors.bgSurfaceSubtle, RoundedCornerShape(8.dp))
                        .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(8.dp))
                        .clickable { sectorOpen = true }.padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    BasicText(filters.sector ?: "All Sectors", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
                    BasicText("⌄", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
                }
            }
        }
        item { FilterTable(matches, onSelect) }
    }

    if (sectorOpen) {
        AlertDialog(
            onDismissRequest = { sectorOpen = false },
            title = { BasicText("Sector", style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)) },
            text = {
                Column {
                    (listOf("All Sectors") + holdings.mapNotNull { it.sector }.distinct().sorted()).forEach { name ->
                        BasicText(name, modifier = Modifier.fillMaxWidth().clickable {
                            filters = filters.copy(sector = name.takeUnless { it == "All Sectors" })
                            sectorOpen = false
                        }.padding(vertical = 9.dp), style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
                    }
                }
            },
            confirmButton = { TextButton(onClick = { sectorOpen = false }) { BasicText("Close") } }
        )
    }
}

internal data class Filters(
    val minHealth: Int = 0,
    val minPiotroski: Int = 0,
    val minRoic: Int = 0,
    val maxDebtToEquity: Float = 5f,
    val netCashOnly: Boolean = false,
    val fcfPositive: Boolean = false,
    val sector: String? = null
) {
    fun matches(h: Holding): Boolean {
        if ((h.healthScore ?: return false) < minHealth) return false
        if (minPiotroski > 0 && (h.piotroskiScore ?: -1) < minPiotroski) return false
        if (minRoic > 0 && (h.roicPct ?: -1.0) < minRoic) return false
        if (sector != null && h.sector != sector && h.industry != sector) return false
        if (netCashOnly && (h.netCashBillions ?: 0.0) <= 0.0) return false
        if (fcfPositive && (h.freeCashFlow ?: 0.0) <= 0.0) return false
        if (maxDebtToEquity < 5f && (h.netCashBillions ?: 0.0) <= 0.0 &&
            (h.debtToEquity ?: Double.POSITIVE_INFINITY) > maxDebtToEquity) return false
        return true
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun FilterSlider(label: String, display: String, value: Float,
    range: ClosedFloatingPointRange<Float>, steps: Int, onChange: (Float) -> Unit
) {
    Column(Modifier.padding(bottom = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(label, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
            BasicText(display, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.brandCyan).copy(fontWeight = FontWeight.Bold))
        }
        Slider(value = value, onValueChange = onChange, valueRange = range, steps = steps,
            thumb = { androidx.compose.foundation.layout.Box(
                Modifier.size(20.dp).background(Omaha.colors.brandCyan, CircleShape)
            ) },
            colors = SliderDefaults.colors(thumbColor = Omaha.colors.brandCyan,
                activeTrackColor = Omaha.colors.brandCyan,
                inactiveTrackColor = Omaha.colors.borderProminent,
                activeTickColor = Color.Transparent, inactiveTickColor = Color.Transparent))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(range.start.toInt().toString(), style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
            BasicText(range.endInclusive.toInt().toString(), style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
        }
    }
}

@Composable
private fun FilterCheck(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        BasicText(label, modifier = Modifier.clickable { onChange(!checked) },
            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
    }
}

@Composable
private fun FilterTable(matches: List<Holding>, onSelect: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BasicText("Results", style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        if (matches.isEmpty()) {
            OmahaCard {
                BasicText("No companies match these filters.", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
            }
        }
        matches.forEach { h ->
            OmahaCard(onClick = { onSelect(h.ticker) }, contentPadding = 14.dp) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        BasicText(h.ticker, style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary).copy(fontWeight = FontWeight.Bold, fontFamily = Omaha.fonts.mono))
                        BasicText(h.name, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary), maxLines = 1)
                        h.sector?.let { BasicText(it, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary), maxLines = 1) }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        BasicText(h.healthScore?.let { "$it/100" } ?: EM_DASH,
                            style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.brandCyan).copy(fontWeight = FontWeight.Bold, fontFamily = Omaha.fonts.mono))
                        BasicText(fmtPrice(h.price, h.currency), style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary).copy(fontFamily = Omaha.fonts.mono))
                    }
                }
                Box(Modifier.height(10.dp))
                BasicText(
                    "Piotroski ${h.piotroskiScore?.let { "$it/9" } ?: EM_DASH}  ·  ROIC ${fmtPercent(h.roicPct)}  ·  Net cash ${fmtBillions(h.netCashBillions, h.reportingCurrency ?: h.currency)}",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary).copy(fontFamily = Omaha.fonts.mono)
                )
            }
        }
    }
}
