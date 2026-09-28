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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.CompanyReview
import com.zandaulion.omaha.data.WatchlistRow
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

@Composable
fun ReviewScreen(
    state: ReviewUiState,
    lists: List<WatchlistRow>,
    activeId: String?,
    checking: Boolean,
    notice: String?,
    onSelectList: (String) -> Unit,
    onCheck: () -> Unit,
    onRetry: () -> Unit,
    onAdd: () -> Unit,
    onReview: (String) -> Unit,
    onResearch: (String) -> Unit
) {
    var choosingList by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicText("Your company review", style = OmahaType.title1.toTextStyle())
                BasicText("Understand what changed. Revisit your reasons.",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
                ReviewAction((lists.firstOrNull { it.id == activeId }?.name ?: "Watchlist") + "  ⌄") {
                    choosingList = !choosingList
                }
                if (choosingList) lists.forEach { list ->
                    ReviewAction(list.name) { onSelectList(list.id); choosingList = false }
                }
            }
        }
        when (state) {
            ReviewUiState.Loading -> item { BasicText("Loading your review history…", style = OmahaType.bodySm.toTextStyle()) }
            is ReviewUiState.Failed -> item {
                OmahaCard {
                    BasicText(state.message, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
                    ReviewAction("Try again", primary = true, onClick = onRetry)
                }
            }
            is ReviewUiState.Ready -> {
                val overview = state.overview
                item {
                    OmahaCard {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            val needsReview = overview.items.count { it.status != "reviewed" }
                            BasicText(if (needsReview > 0) "$needsReview companies to revisit" else "Your review overview",
                                style = OmahaType.title2.toTextStyle())
                            BasicText(overview.lastCheckedAt?.let { "Latest recorded financial check: ${reviewDate(it)}" }
                                ?: "No data check recorded yet. Your first check establishes a comparison baseline.",
                                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                            BasicText("Some companies or periods may be missing. No recorded alerts does not mean nothing changed. Your written conditions are checked by you.",
                                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                            ReviewAction(if (checking) "Checking companies…" else "Check for changes", primary = true,
                                enabled = !checking, onClick = onCheck)
                            notice?.let { BasicText(it, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)) }
                        }
                    }
                }
                if (overview.items.isEmpty()) item {
                    OmahaCard {
                        BasicText("Start with a company you follow", style = OmahaType.title2.toTextStyle())
                        BasicText("Add a company, capture your reasons, and return when there is something to review.",
                            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
                        ReviewAction("Add a company", primary = true, onClick = onAdd)
                    }
                }
                items(overview.items, key = { it.ticker }) { company ->
                    CompanyReviewCard(company, { onReview(company.ticker) }, { onResearch(company.ticker) })
                }
            }
        }
    }
}

@Composable
private fun CompanyReviewCard(company: CompanyReview, onReview: () -> Unit, onResearch: () -> Unit) {
    val tint = when (company.status) {
        "changed" -> Omaha.colors.healthModerate
        "reviewed" -> Omaha.colors.healthGood
        else -> Omaha.colors.brandCyan
    }
    OmahaCard {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                BasicText(company.ticker, style = OmahaType.title2.toTextStyle())
                BasicText(company.label, style = OmahaType.caption.toTextStyle(color = tint))
            }
            BasicText(company.name, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
            BasicText(company.reason, style = OmahaType.bodySm.toTextStyle())
            company.changes.take(3).forEach { change ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.bgSurfaceSubtle).padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    BasicText(change.title, style = OmahaType.bodySm.toTextStyle())
                    BasicText(change.body, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                    BasicText(reviewDate(change.at), style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                }
            }
            company.lastReviewedAt?.let {
                BasicText("Last review: ${reviewDate(it)}" + company.assessment?.let { value -> " · ${reviewAssessmentLabel(value)}" }.orEmpty(),
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ReviewAction(if (!company.hasThesis) "Add your reasons" else if (company.lastReviewedAt == null) "First review" else "Review", primary = true, onClick = onReview)
                ReviewAction("Research", onClick = onResearch)
            }
        }
    }
}

internal fun reviewDate(value: String): String = runCatching {
    java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault())
        .format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm"))
}.getOrDefault(value.take(16).replace('T', ' '))

internal fun reviewAssessmentLabel(value: String): String = when (value) {
    "intact" -> "Reasons still hold"
    "watch" -> "Needs watching"
    "changed" -> "Reasons changed"
    else -> value
}

@Composable
internal fun ReviewAction(label: String, primary: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.clip(RoundedCornerShape(OmahaRadius.sm))
        .background(if (primary && enabled) Omaha.colors.brandBlue else Omaha.colors.bgSurfaceSubtle)
        .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
        .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp)) {
        BasicText(label, style = OmahaType.bodySm.toTextStyle(
            color = if (primary && enabled) Color.White else Omaha.colors.textSecondary))
    }
}
