package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
 * Candidate sources are deduplicated into one searchable vertical list. This
 * avoids repeated companies and clipped horizontal chip rows on phones.
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
    onDrop: (String) -> Unit,
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
            if (picked.isNotEmpty()) {
                Box(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    picked.forEach { ticker ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                                .background(Omaha.colors.brandGlow)
                                .clickable { onDrop(ticker) }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            BasicText(ticker, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.brandCyan).copy(fontFamily = Omaha.fonts.mono))
                            BasicText("Remove ×", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                        }
                    }
                }
            }
            Box(Modifier.height(14.dp))

            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                when {
                    candidates == null -> BasicText(
                        "Loading suggestions…",
                        style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                    else -> {
                        val needle = filter.trim().uppercase()
                        fun matches(c: CandidateRow) =
                            needle.isEmpty() || c.ticker.contains(needle) ||
                                (c.name?.uppercase()?.contains(needle) == true)
                        val all = mutableListOf<CandidateRow>().apply {
                            addAll(candidates.peers)
                            candidates.watchlists.forEach { addAll(it.rows) }
                            addAll(candidates.seen)
                        }.distinctBy { it.ticker }.filter(::matches)
                        if (all.isEmpty()) {
                            BasicText(
                                "Nothing matches.",
                                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                            )
                        } else {
                            BasicText(
                                if (seedTicker.isNullOrBlank()) "Available companies" else "Peers and companies you follow",
                                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                            )
                            Box(Modifier.height(6.dp))
                            all.forEach { row ->
                                val on = row.ticker in picked
                                val full = picked.size >= maxPicked && !on
                                CandidateRowItem(row, on, full) { if (on) onDrop(row.ticker) else onPick(row.ticker) }
                                Box(Modifier.height(6.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CandidateRowItem(row: CandidateRow, on: Boolean, full: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(if (on) Omaha.colors.brandGlow else Omaha.colors.bgSurfaceSubtle)
            .clickable(enabled = !full, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(Modifier.weight(1f)) {
            BasicText(row.ticker, style = OmahaType.bodySm.toTextStyle(color = if (full) Omaha.colors.textTertiary else Omaha.colors.textPrimary).copy(fontFamily = Omaha.fonts.mono))
            row.name?.let {
                BasicText(it, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary), maxLines = 1)
            }
        }
        row.healthScore?.let { score ->
            BasicText("$score", style = OmahaType.caption.toTextStyle(color = scoreColor(Omaha.colors, score)).copy(fontFamily = Omaha.fonts.mono))
        }
        Box(Modifier.padding(start = 12.dp)) {
            BasicText(if (on) "✓" else "+", style = OmahaType.bodyMd.toTextStyle(color = if (full) Omaha.colors.textTertiary else Omaha.colors.brandCyan))
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
