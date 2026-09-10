package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.CandidateRow
import com.zandaulion.omaha.data.CompareCandidates
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The comparison picker, matching `web/app.js`'s `renderComparePicker` and
 * `#comparePickerModal`: a full-screen overlay (same hand-built family as
 * phase 1's `OmahaExplainSheet` — no `ModalBottomSheet`, this codebase
 * keeps Material3 to the one DCF slider), a filter field, then one section
 * per candidate group.
 *
 * Each group is a single horizontally-scrolling row rather than the PWA's
 * wrapping `flex-wrap` grid — matching the ticker-chip row `CompareScreen`
 * already scrolls horizontally, rather than introducing Compose's
 * (still-experimental) `FlowRow` for this one screen.
 *
 * No freeform "not in your lists, press Enter" fallback: that PWA
 * affordance exists because its filter field doubles as free-text entry.
 * This picker is chips-only, so there is no text-entry path to fall back
 * to — a symbol nobody has looked up yet simply isn't offered here.
 */
@Composable
fun ComparePicker(
    seedTicker: String?,
    candidates: CompareCandidates?,
    picked: List<String>,
    maxPicked: Int,
    onPick: (String) -> Unit,
    onClose: () -> Unit
) {
    var filter by remember { mutableStateOf("") }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClose
            ),
        contentAlignment = Alignment.BottomCenter
    ) {
        Column(
            Modifier
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}
                )
                .fillMaxWidth()
                .fillMaxHeight(0.85f)
                .clip(RoundedCornerShape(topStart = OmahaRadius.lg, topEnd = OmahaRadius.lg))
                .background(Omaha.colors.bgSurfaceElevated)
                .padding(20.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                BasicText("Compare", style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
                BasicText(
                    "✕",
                    modifier = Modifier
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onClose
                        )
                        .padding(start = 12.dp),
                    style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textTertiary)
                )
            }

            Box(Modifier.height(12.dp))
            PickerFilterField(filter) { filter = it }
            Box(Modifier.height(8.dp))
            BasicText(
                "${picked.size} of $maxPicked picked",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
            Box(Modifier.height(14.dp))

            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                when {
                    candidates == null -> BasicText(
                        "Could not load your lists.",
                        style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                    else -> {
                        val needle = filter.trim().uppercase()
                        fun matches(c: CandidateRow) =
                            needle.isEmpty() || c.ticker.contains(needle) ||
                                (c.name?.uppercase()?.contains(needle) == true)

                        var shownAny = false
                        if (candidates.peers.isNotEmpty()) {
                            val shown = candidates.peers.filter(::matches)
                            if (shown.isNotEmpty()) {
                                shownAny = true
                                PickerSection("Peers of ${seedTicker.orEmpty()}", shown, picked, maxPicked, onPick)
                            }
                        }
                        for (group in candidates.watchlists) {
                            val shown = group.rows.filter(::matches)
                            if (shown.isNotEmpty()) {
                                shownAny = true
                                PickerSection(group.label, shown, picked, maxPicked, onPick)
                            }
                        }
                        if (candidates.seen.isNotEmpty()) {
                            val shown = candidates.seen.filter(::matches)
                            if (shown.isNotEmpty()) {
                                shownAny = true
                                PickerSection("Looked up before", shown, picked, maxPicked, onPick)
                            }
                        }
                        if (!shownAny) {
                            BasicText(
                                "Nothing matches.",
                                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerSection(
    label: String,
    rows: List<CandidateRow>,
    picked: List<String>,
    maxPicked: Int,
    onPick: (String) -> Unit
) {
    Column(Modifier.padding(bottom = 16.dp)) {
        BasicText(label, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
        Box(Modifier.height(8.dp))
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (row in rows) {
                val on = row.ticker in picked
                val full = picked.size >= maxPicked && !on
                CandidateChip(row, on, full) { onPick(row.ticker) }
            }
        }
    }
}

@Composable
private fun CandidateChip(row: CandidateRow, on: Boolean, full: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(if (on) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle)
            .clickable(enabled = !full, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        BasicText(
            row.ticker,
            style = OmahaType.caption
                .toTextStyle(
                    color = when {
                        on -> Omaha.colors.bgCanvas
                        full -> Omaha.colors.textTertiary
                        else -> Omaha.colors.textSecondary
                    }
                )
                .copy(fontFamily = Omaha.fonts.mono)
        )
        row.healthScore?.let { score ->
            val colors = Omaha.colors
            Box(Modifier.padding(start = 6.dp)) {
                BasicText(
                    "$score",
                    style = OmahaType.caption
                        .toTextStyle(color = if (on) colors.bgCanvas else scoreColor(colors, score))
                        .copy(fontFamily = Omaha.fonts.mono)
                )
            }
        }
    }
}

private fun scoreColor(colors: com.zandaulion.omaha.design.OmahaColors, score: Int): Color = when {
    score >= 85 -> colors.healthPristine
    score >= 70 -> colors.healthGood
    score >= 50 -> colors.healthModerate
    else -> colors.healthRisk
}

@Composable
private fun PickerFilterField(value: String, onChange: (String) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurface)
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) {
            BasicText(
                "Filter by ticker or name",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary),
            cursorBrush = SolidColor(Omaha.colors.brandCyan),
            modifier = Modifier.fillMaxWidth()
        )
    }
}
