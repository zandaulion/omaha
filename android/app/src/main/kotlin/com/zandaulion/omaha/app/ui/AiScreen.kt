package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.AiSummary
import com.zandaulion.omaha.data.Rating
import com.zandaulion.omaha.data.StalenessAssessment
import com.zandaulion.omaha.data.StrengthOrRisk
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaColors
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlinx.coroutines.delay

/**
 * The AI tab's status block: who is signed in, the credit balance, and
 * whichever of generate / buy / claim is the right next action.
 *
 * Content only — [DeepDiveScreen]'s `Card` wraps it, the same split
 * [ThesisSection] uses, since `Card` there is private to that file.
 */
@Composable
fun AiStatusSection(
    state: AiUiState.Ready,
    creditPackPrice: String?,
    onSignIn: () -> Unit,
    onGenerate: () -> Unit,
    onClaimFreeGrant: () -> Unit,
    onPurchase: () -> Unit,
    onDismissError: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.user == null) {
            BasicText(
                "Sign in with Google to generate an AI analysis of this company.",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
        } else {
            BasicText(
                "Signed in as ${state.user.email ?: state.user.displayName ?: "your Google account"}",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
            BasicText(
                when (state.credits) {
                    null -> "Checking your balance…"
                    1 -> "1 credit"
                    else -> "${state.credits} credits"
                },
                style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }

        if (state.error != null) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.healthRiskBg)
                    .border(1.dp, Omaha.colors.healthRiskBorder, RoundedCornerShape(OmahaRadius.sm))
                    .clickable(onClick = onDismissError)
                    .padding(10.dp)
            ) {
                BasicText(state.error, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.healthRisk))
            }
        }

        state.busy?.let { BusyMessage(it) }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                state.user == null -> PillButton("Sign in", enabled = state.busy == null, onClick = onSignIn)
                state.credits == 0 -> {
                    PillButton("Claim free credits", enabled = state.busy == null, onClick = onClaimFreeGrant)
                    PillButton(
                        creditPackPrice?.let { "Buy 10 credits · $it" } ?: "Buy 10 credits",
                        enabled = state.busy == null,
                        onClick = onPurchase
                    )
                }
                else -> PillButton(
                    if (state.summary == null) "Generate analysis" else "Regenerate (1 credit)",
                    enabled = state.busy == null,
                    onClick = onGenerate
                )
            }
        }
    }
}

/**
 * A reassuring line that changes every two seconds while [kind] is in
 * flight — sign-in, the free-grant claim and a Gemini call are each a few
 * real seconds of network time, and a static "Loading…" or an unmoving
 * spinner reads as stuck long before it actually is.
 */
@Composable
private fun BusyMessage(kind: AiBusyKind) {
    val messages = messagesFor(kind)
    var index by remember(kind) { mutableIntStateOf(0) }
    LaunchedEffect(kind) {
        while (true) {
            delay(2000)
            index = (index + 1) % messages.size
        }
    }
    BasicText(messages[index], style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
}

private fun messagesFor(kind: AiBusyKind): List<String> = when (kind) {
    AiBusyKind.SigningIn -> listOf(
        "Opening the Google account picker…",
        "Confirming your identity…",
        "Almost there…"
    )
    AiBusyKind.ClaimingFreeGrant -> listOf(
        "Provisioning your free credits…",
        "Writing to your account…",
        "Almost done…"
    )
    AiBusyKind.Purchasing -> listOf(
        "Opening Google Play…",
        "Waiting for the purchase to complete…",
        "Confirming with Play…"
    )
    AiBusyKind.Generating -> listOf(
        "Sending the filings to Gemini…",
        "Reading the balance sheet…",
        "Weighing the moat…",
        "Checking the DCF assumptions…",
        "Writing the verdict…"
    )
}

/**
 * `.ai-origin-tag`: says the surface is model output at the point where it
 * starts, not only in a footer disclaimer. Play requires the disclosure;
 * `web/app.css`'s own comment states the deeper reason — a reader who has
 * scrolled into the moat reasoning has already begun trusting it.
 */
@Composable
private fun AiOriginTag() {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(Omaha.colors.brandViolet.copy(alpha = 0.12f))
            .border(1.dp, Omaha.colors.brandViolet.copy(alpha = 0.3f), RoundedCornerShape(OmahaRadius.pill))
            .padding(horizontal = 9.dp, vertical = 3.dp)
    ) {
        BasicText("✨ AI-GENERATED", style = OmahaType.caption.toTextStyle(color = Omaha.colors.brandViolet))
    }
}

@Composable
private fun PillButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(if (enabled) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle)
            .let { if (enabled) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        BasicText(
            label,
            style = OmahaType.bodySm.toTextStyle(
                color = if (enabled) Omaha.colors.bgCanvas else Omaha.colors.textTertiary
            )
        )
    }
}

/**
 * `.staleness-notice`: told plainly and near the top, on `assessStaleness`'s
 * own reasoning — a reader who has scrolled into the moat reasoning has
 * already begun trusting it. Never auto-regenerates; only offers to.
 */
@Composable
fun AiStalenessCard(assessment: StalenessAssessment, onReanalyze: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        BasicText(
            if (assessment.scope == "all") "📄" else "📉",
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.healthModerate)
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            BasicText(
                assessment.headline ?: "",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.healthModerate)
            )
            BasicText(
                assessment.detail ?: "",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
            )
            Box(Modifier.height(2.dp))
            Row {
                PillButton("🔄 Re-analyze", enabled = true, onClick = onReanalyze)
            }
        }
    }
}

/** `.ai-verdict-card`: the one-line moat verdict, its grade, and the executive summary. */
@Composable
fun AiVerdictCard(summary: AiSummary) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val (fg, bg, border) = gradeColors(summary.verdictGrade, Omaha.colors)
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(bg)
                    .border(1.dp, border, RoundedCornerShape(OmahaRadius.pill))
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            ) {
                BasicText(
                    summary.verdictBadge.ifBlank { summary.verdictGrade },
                    style = OmahaType.caption.toTextStyle(color = fg)
                )
            }
            AiOriginTag()
        }
        BasicText(
            "“${summary.verdict}”",
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
        )
        BasicText(
            summary.executiveSummary,
            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
        )
        BasicText(
            summary.buffettPrinciple,
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textAccent)
        )
    }
}

/** The three structured ratings — moat, solvency, valuation — each in the model's own words. */
@Composable
fun AiRatingsCard(summary: AiSummary) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        RatingRow("Moat & profitability", summary.moatAndProfitability)
        RatingRow("Solvency & safety", summary.solvencyAndSafety)
        RatingRow("Valuation & DCF", summary.valuationAndDCF)
    }
}

@Composable
private fun RatingRow(title: String, rating: Rating) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BasicText(title, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
            BasicText(
                rating.ratingLabel,
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textAccent)
            )
        }
        BasicText(rating.explanation, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
    }
}

/** Strengths and risks, as the model saw them — not a checklist result, so no pass/fail iconography. */
@Composable
fun AiStrengthsRisksCard(summary: AiSummary) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (summary.keyStrengths.isNotEmpty()) {
            StrengthsOrRisksList("Key strengths", summary.keyStrengths, Omaha.colors.healthGood)
        }
        if (summary.keyRisks.isNotEmpty()) {
            StrengthsOrRisksList("Key risks", summary.keyRisks, Omaha.colors.healthRisk)
        }
    }
}

@Composable
private fun StrengthsOrRisksList(title: String, items: List<StrengthOrRisk>, tint: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicText(title, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
        for (item in items) {
            Column {
                BasicText(item.title, style = OmahaType.bodySm.toTextStyle(color = tint))
                BasicText(item.detail, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
            }
        }
    }
}

/** The buy zone the model derived from the DCF, and the conclusion. */
@Composable
fun AiBuyZoneCard(summary: AiSummary) {
    val zone = summary.buyZone
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BasicText("Buy zone", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
        BasicText(
            "Up to ${fmt(zone.maxPrice)} ${zone.currency}" +
                (zone.impliedDiscountToFairValuePct?.let { " · ${fmt(it)}% below fair value" } ?: ""),
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                .copy(fontFamily = Omaha.fonts.mono)
        )
        if (zone.alreadyInZone) {
            BasicText(
                "The current price is already inside this zone.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.healthGood)
            )
        }
        BasicText(zone.perspective, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
        Box(Modifier.height(2.dp))
        BasicText(summary.conclusion, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
    }
}

/**
 * What the model knew beyond the filings, what to watch next, and the
 * provenance footer — same discipline `web/app.js`'s `notesProvenance`
 * comment describes: a saved analysis says what it actually was built from,
 * not what the setting says today.
 */
@Composable
fun AiCaveatsCard(summary: AiSummary) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val ctx = summary.modelContext
        if (ctx.hasContext && ctx.points.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicText(
                    "Beyond the filings",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                )
                ctx.asOfCaveat?.let {
                    BasicText(it, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                }
                for (point in ctx.points) {
                    BasicText(
                        "${point.claim} (${point.confidence.lowercase()} confidence)",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                    )
                }
            }
        }

        if (summary.whatToWatch.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicText("What to watch", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
                for (item in summary.whatToWatch) {
                    BasicText("· $item", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                }
            }
        }

        if (summary.dataLimitations.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicText(
                    "Data limitations",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                )
                for (item in summary.dataLimitations) {
                    BasicText("· $item", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                }
            }
        }

        BasicText(
            (if (summary.includedNotes) "Includes your thesis and journal. " else "Financial data only. ") +
                "Not investment advice.",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )
    }
}

private fun gradeColors(grade: String, c: OmahaColors): Triple<Color, Color, Color> = when (grade) {
    "PRISTINE_MOAT" -> Triple(c.healthPristine, c.healthPristineBg, c.healthPristineBorder)
    "SOLID_COMPOUNDER" -> Triple(c.healthGood, c.healthGoodBg, c.healthGoodBorder)
    "VALUATION_WATCH" -> Triple(c.healthModerate, c.healthModerateBg, c.healthModerateBorder)
    else -> Triple(c.healthRisk, c.healthRiskBg, c.healthRiskBorder)
}

private fun fmt(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else "%.2f".format(v)
