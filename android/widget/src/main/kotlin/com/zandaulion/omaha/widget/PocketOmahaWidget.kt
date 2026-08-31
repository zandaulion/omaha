package com.zandaulion.omaha.widget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.zandaulion.omaha.design.DarkColors
import com.zandaulion.omaha.design.LightColors
import com.zandaulion.omaha.design.OmahaColors

private val SMALL = DpSize(110.dp, 60.dp)
private val MEDIUM = DpSize(180.dp, 180.dp)
private val LARGE = DpSize(250.dp, 380.dp)

/** Every full holding row the largest bucket will draw before it stops — a defensive cap, not a real limit anywhere else in the app. */
private const val MAX_HOLDING_ROWS = 15

/** `com.zandaulion.omaha.app.MainActivity`, referenced by name — `:widget` does not depend on `:app` (see this module's build.gradle.kts header), so the tap target is a component name rather than a class literal. */
private const val MAIN_ACTIVITY = "com.zandaulion.omaha.app.MainActivity"
private const val EXTRA_WATCHLIST_ID = "com.zandaulion.omaha.WATCHLIST_ID"

/**
 * Small: a watchlist's composite health score and its delta since the
 * rolled baseline. Medium: the same, plus the ranked movers behind it.
 * Large: movers, plus the full holding list — the biggest bucket exists
 * specifically because the first version left it empty of anything a
 * generous resize couldn't already show smaller, which is the wrong use of
 * the extra room a person asked the launcher for.
 *
 * Renders only [WidgetKeys] — never touches Room or `OmahaEngine`. See this
 * module's build.gradle.kts for why that split exists.
 */
class PocketOmahaWidget : GlanceAppWidget() {

    override val stateDefinition = PreferencesGlanceStateDefinition
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM, LARGE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        // androidx.glance.unit.ColorProvider at 1.2.0 takes one Color, not a
        // day/night pair — Glance's dynamic day/night ColorProvider lives one
        // level up, in androidx.glance.color, and is meant for a whole theme
        // rather than one token at a time. A Context is available here but
        // not inside the composable below, so night mode is resolved once,
        // per render, rather than per token.
        val night = context.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val colors = if (night) DarkColors else LightColors

        provideContent { WidgetContent(colors) }
    }
}

private enum class Bucket { SMALL, MEDIUM, LARGE }

@Composable
private fun WidgetContent(colors: OmahaColors) {
    val prefs = currentState<Preferences>()
    val watchlistId = prefs[WidgetKeys.watchlistId]
    val name = prefs[WidgetKeys.watchlistName] ?: "Watchlist"
    val score = prefs[WidgetKeys.score]
    val previousScore = prefs[WidgetKeys.previousScore]
    val tier = prefs[WidgetKeys.tier] ?: "risk"
    val movers = parseMoversText(prefs[WidgetKeys.moversText])
    val holdings = parseHoldingsText(prefs[WidgetKeys.holdingsText])

    // SizeMode.Responsive snaps LocalSize.current to whichever declared
    // DpSize is closest, never something in between, so a plain height
    // threshold per bucket is exact rather than approximate.
    val bucket = when {
        LocalSize.current.height >= LARGE.height -> Bucket.LARGE
        LocalSize.current.height >= MEDIUM.height -> Bucket.MEDIUM
        else -> Bucket.SMALL
    }

    val openIntent = Intent().apply {
        setClassName("com.zandaulion.omaha", MAIN_ACTIVITY)
        watchlistId?.let { putExtra(EXTRA_WATCHLIST_ID, it) }
    }

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(colors.bgSurface))
            .clickable(actionStartActivity(openIntent))
            .padding(12.dp),
        // Centered for the small header-only card; top-aligned once there is
        // a list below the header, so it starts at the top and grows down
        // rather than the whole block floating in the middle of a tall box.
        verticalAlignment = if (bucket == Bucket.LARGE) Alignment.Vertical.Top else Alignment.Vertical.CenterVertically
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
            Text(
                name,
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(color = ColorProvider(colors.textSecondary), fontSize = 11.sp),
                maxLines = 1
            )
            // A distinct tap target from the Column's own actionStartActivity
            // below — Glance gives each `.clickable` its own click region in
            // the RemoteViews it produces, so a tap here does not also open
            // the app the way a tap anywhere else on the widget does.
            Text(
                "↻",
                modifier = GlanceModifier.clickable(actionRunCallback<RefreshWidgetAction>()),
                style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 13.sp)
            )
        }
        Text(
            score?.toString() ?: "—",
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold
            )
        )
        DeltaLine(colors, score, previousScore, tier)

        if (bucket != Bucket.SMALL && movers.isNotEmpty()) {
            for ((ticker, delta) in movers.take(3)) {
                MoverRow(colors, ticker, delta)
            }
        }

        if (bucket == Bucket.LARGE && holdings.isNotEmpty()) {
            Text(
                "Holdings",
                modifier = GlanceModifier.padding(top = 8.dp),
                style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 10.sp)
            )
            for (holding in holdings.take(MAX_HOLDING_ROWS)) {
                HoldingRow(colors, holding)
            }
        }
    }
}

@Composable
private fun DeltaLine(colors: OmahaColors, score: Int?, previousScore: Int?, tier: String) {
    val text = if (score != null && previousScore != null) {
        val delta = score - previousScore
        "${if (delta > 0) "+" else ""}$delta since last week"
    } else {
        tierLabel(tier)
    }
    val color = when {
        score == null || previousScore == null -> colors.textTertiary
        score - previousScore > 0 -> colors.healthGood
        score - previousScore < 0 -> colors.healthRisk
        else -> colors.textTertiary
    }
    Text(text, style = TextStyle(color = ColorProvider(color), fontSize = 11.sp), maxLines = 1)
}

@Composable
private fun MoverRow(colors: OmahaColors, ticker: String, delta: Int) {
    val color = if (delta >= 0) colors.healthGood else colors.healthRisk
    Text(
        "$ticker ${if (delta > 0) "+" else ""}$delta",
        style = TextStyle(color = ColorProvider(color), fontSize = 11.sp),
        maxLines = 1
    )
}

@Composable
private fun HoldingRow(colors: OmahaColors, holding: WidgetHoldingEntry) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Text(
            holding.ticker,
            modifier = GlanceModifier.defaultWeight(),
            style = TextStyle(color = ColorProvider(colors.textPrimary), fontSize = 12.sp),
            maxLines = 1
        )
        Text(
            holding.score?.toString() ?: "—",
            style = TextStyle(
                color = ColorProvider(tierColor(colors, holding.tier)),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            )
        )
    }
}

private fun tierColor(colors: OmahaColors, tier: String): Color = when (tier) {
    "pristine" -> colors.healthPristine
    "good" -> colors.healthGood
    "moderate" -> colors.healthModerate
    else -> colors.healthRisk
}

private fun tierLabel(tier: String): String = when (tier) {
    "pristine" -> "Pristine"
    "good" -> "Good"
    "moderate" -> "Moderate"
    else -> "Risk"
}
