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
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
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
private val LARGE = DpSize(180.dp, 180.dp)

/** `com.zandaulion.omaha.app.MainActivity`, referenced by name — `:widget` does not depend on `:app` (see this module's build.gradle.kts header), so the tap target is a component name rather than a class literal. */
private const val MAIN_ACTIVITY = "com.zandaulion.omaha.app.MainActivity"
private const val EXTRA_WATCHLIST_ID = "com.zandaulion.omaha.WATCHLIST_ID"

/**
 * Small: a watchlist's composite health score and its delta since the
 * rolled baseline. Large: the same, plus the ranked movers behind it.
 *
 * Renders only [WidgetKeys] — never touches Room or `OmahaEngine`. See this
 * module's build.gradle.kts for why that split exists.
 */
class PocketOmahaWidget : GlanceAppWidget() {

    override val stateDefinition = PreferencesGlanceStateDefinition
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, LARGE))

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

@Composable
private fun WidgetContent(colors: OmahaColors) {
    val prefs = currentState<Preferences>()
    val watchlistId = prefs[WidgetKeys.watchlistId]
    val name = prefs[WidgetKeys.watchlistName] ?: "Watchlist"
    val score = prefs[WidgetKeys.score]
    val previousScore = prefs[WidgetKeys.previousScore]
    val tier = prefs[WidgetKeys.tier] ?: "risk"
    val movers = parseMoversText(prefs[WidgetKeys.moversText])

    val large = LocalSize.current.height >= LARGE.height

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
        verticalAlignment = Alignment.Vertical.CenterVertically
    ) {
        Text(
            name,
            style = TextStyle(color = ColorProvider(colors.textSecondary), fontSize = 11.sp),
            maxLines = 1
        )
        Text(
            score?.toString() ?: "—",
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold
            )
        )
        DeltaLine(colors, score, previousScore, tier)

        if (large && movers.isNotEmpty()) {
            for ((ticker, delta) in movers.take(3)) {
                MoverRow(colors, ticker, delta)
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

private fun tierLabel(tier: String): String = when (tier) {
    "pristine" -> "Pristine"
    "good" -> "Good"
    "moderate" -> "Moderate"
    else -> "Risk"
}
