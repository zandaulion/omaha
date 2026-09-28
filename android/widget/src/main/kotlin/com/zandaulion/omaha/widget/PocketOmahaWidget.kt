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
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.zandaulion.omaha.design.DarkColors
import com.zandaulion.omaha.design.LightColors
import com.zandaulion.omaha.design.OmahaColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val SMALL = DpSize(110.dp, 60.dp)
// Samsung's two-column outer-screen slot is about 168 dp wide. Keeping this
// bucket at 140 dp lets a 2x2 widget use the extra height instead of selecting
// SMALL solely because the old 180 dp width did not fit.
private val MEDIUM = DpSize(140.dp, 180.dp)
private val LARGE = DpSize(250.dp, 380.dp)

private const val MAX_ATTENTION_ROWS = 6
private const val MAIN_ACTIVITY = "com.zandaulion.omaha.app.MainActivity"
private const val EXTRA_WATCHLIST_ID = "com.zandaulion.omaha.WATCHLIST_ID"
private const val EXTRA_TICKER = "com.zandaulion.omaha.TICKER"

/**
 * A watchlist health card rather than a miniature copy of the Watchlist screen.
 *
 * The smallest size answers one question: "How healthy is this list?" Medium
 * adds the score changes behind the headline. Large uses its remaining room
 * for the companies that deserve attention first. The stored presentation
 * model remains the only input; this module never touches Room or the engine.
 */
class PocketOmahaWidget : GlanceAppWidget() {

    override val stateDefinition = PreferencesGlanceStateDefinition
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM, LARGE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
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
    val updatedLabel = formatUpdatedAt(prefs[WidgetKeys.updatedAt])

    val bucket = when {
        LocalSize.current.height >= LARGE.height -> Bucket.LARGE
        LocalSize.current.height >= MEDIUM.height -> Bucket.MEDIUM
        else -> Bucket.SMALL
    }

    val openWatchlist = launchIntent(watchlistId = watchlistId)
    val padding = if (bucket == Bucket.SMALL) 10.dp else 14.dp

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(colors.bgSurface))
            .cornerRadius(18.dp)
            .clickable(actionStartActivity(openWatchlist))
            .padding(padding),
        verticalAlignment = if (bucket == Bucket.SMALL) {
            Alignment.Vertical.CenterVertically
        } else {
            Alignment.Vertical.Top
        }
    ) {
        WidgetHeader(colors, name)
        if (bucket == Bucket.SMALL) {
            CompactScore(colors, score, previousScore, tier)
            return@Column
        }

        Spacer(8)
        ScoreSummary(colors, score, previousScore, tier)
        Spacer(7)
        LinearProgressIndicator(
            progress = (score ?: 0).coerceIn(0, 100) / 100f,
            modifier = GlanceModifier.fillMaxWidth().height(5.dp),
            color = ColorProvider(tierColor(colors, tier)),
            backgroundColor = ColorProvider(colors.bgSurfaceSubtle)
        )
        Spacer(7)
        MetaLine(colors, holdings.size, updatedLabel)

        Spacer(10)
        SectionLabel(colors, "SCORE CHANGES")
        if (movers.isEmpty()) {
            Text(
                "No material changes",
                modifier = GlanceModifier.padding(top = 5.dp),
                style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 11.sp),
                maxLines = 1
            )
        } else {
            for ((ticker, delta) in movers.take(if (bucket == Bucket.LARGE) 3 else 2)) {
                MoverRow(colors, ticker, delta, watchlistId)
            }
        }

        if (bucket == Bucket.LARGE && holdings.isNotEmpty()) {
            Spacer(12)
            SectionLabel(colors, "NEEDS ATTENTION")
            for (holding in attentionFirst(holdings).take(MAX_ATTENTION_ROWS)) {
                HoldingRow(colors, holding, watchlistId)
            }
        }
    }
}

@Composable
private fun WidgetHeader(colors: OmahaColors, name: String) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Box(
            modifier = GlanceModifier
                .width(4.dp)
                .height(16.dp)
                .background(ColorProvider(colors.brandCyan))
                .cornerRadius(4.dp)
        ) {}
        Text(
            name,
            modifier = GlanceModifier.defaultWeight().padding(start = 7.dp),
            style = TextStyle(
                color = ColorProvider(colors.textSecondary),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            ),
            maxLines = 1
        )
        Text(
            "↻",
            modifier = GlanceModifier
                .clickable(actionRunCallback<RefreshWidgetAction>())
                .padding(start = 8.dp, top = 2.dp, bottom = 2.dp),
            style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 15.sp)
        )
    }
}

@Composable
private fun CompactScore(colors: OmahaColors, score: Int?, previousScore: Int?, tier: String) {
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(top = 3.dp),
        verticalAlignment = Alignment.Vertical.Bottom
    ) {
        Text(
            score?.toString() ?: "—",
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 27.sp,
                fontWeight = FontWeight.Bold
            )
        )
        Text(
            "/100",
            modifier = GlanceModifier.padding(start = 2.dp, bottom = 3.dp),
            style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 10.sp)
        )
        Box(modifier = GlanceModifier.defaultWeight()) {}
        StatusPill(colors, tier)
        if (score != null && previousScore != null && score != previousScore) {
            CompositeDelta(colors, score, previousScore, compact = true)
        }
    }
}

@Composable
private fun ScoreSummary(colors: OmahaColors, score: Int?, previousScore: Int?, tier: String) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Text(
            score?.toString() ?: "—",
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold
            )
        )
        Text(
            "/100",
            modifier = GlanceModifier.padding(start = 2.dp, top = 10.dp),
            style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 11.sp)
        )
        Box(modifier = GlanceModifier.defaultWeight()) {}
        Column(horizontalAlignment = Alignment.Horizontal.End) {
            StatusPill(colors, tier)
            CompositeDelta(colors, score, previousScore, compact = false)
        }
    }
}

@Composable
private fun StatusPill(colors: OmahaColors, tier: String) {
    Text(
        tierLabel(tier).uppercase(),
        modifier = GlanceModifier
            .background(ColorProvider(tierBackground(colors, tier)))
            .cornerRadius(99.dp)
            .padding(horizontal = 7.dp, vertical = 3.dp),
        style = TextStyle(
            color = ColorProvider(tierColor(colors, tier)),
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold
        ),
        maxLines = 1
    )
}

@Composable
private fun CompositeDelta(
    colors: OmahaColors,
    score: Int?,
    previousScore: Int?,
    compact: Boolean
) {
    if (score == null || previousScore == null) return
    val delta = score - previousScore
    val color = when {
        delta > 0 -> colors.healthGood
        delta < 0 -> colors.healthRisk
        else -> colors.textTertiary
    }
    val sign = if (delta > 0) "+" else ""
    Text(
        when {
            compact -> "$sign$delta"
            delta == 0 -> "No change · 1 wk"
            else -> "$sign$delta pts · 1 wk"
        },
        modifier = GlanceModifier.padding(start = if (compact) 5.dp else 0.dp, top = if (compact) 0.dp else 3.dp),
        style = TextStyle(color = ColorProvider(color), fontSize = 10.sp),
        maxLines = 1
    )
}

@Composable
private fun MetaLine(colors: OmahaColors, companyCount: Int, updatedLabel: String?) {
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(
            "$companyCount ${if (companyCount == 1) "company" else "companies"}",
            modifier = GlanceModifier.defaultWeight(),
            style = TextStyle(color = ColorProvider(colors.textSecondary), fontSize = 10.sp),
            maxLines = 1
        )
        if (updatedLabel != null) {
            Text(
                updatedLabel,
                style = TextStyle(color = ColorProvider(colors.textTertiary), fontSize = 10.sp),
                maxLines = 1
            )
        }
    }
}

@Composable
private fun SectionLabel(colors: OmahaColors, text: String) {
    Text(
        text,
        style = TextStyle(
            color = ColorProvider(colors.textTertiary),
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold
        ),
        maxLines = 1
    )
}

@Composable
private fun MoverRow(colors: OmahaColors, ticker: String, delta: Int, watchlistId: String?) {
    val color = if (delta >= 0) colors.healthGood else colors.healthRisk
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .clickable(actionStartActivity(launchIntent(watchlistId, ticker)))
            .padding(top = 5.dp, bottom = 2.dp),
        verticalAlignment = Alignment.Vertical.CenterVertically
    ) {
        Text(
            ticker,
            modifier = GlanceModifier.defaultWeight(),
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            ),
            maxLines = 1
        )
        Text(
            "${if (delta > 0) "+" else ""}$delta pts",
            style = TextStyle(color = ColorProvider(color), fontSize = 11.sp, fontWeight = FontWeight.Medium),
            maxLines = 1
        )
    }
}

@Composable
private fun HoldingRow(
    colors: OmahaColors,
    holding: WidgetHoldingEntry,
    watchlistId: String?
) {
    val color = tierColor(colors, holding.tier)
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .clickable(actionStartActivity(launchIntent(watchlistId, holding.ticker)))
            .padding(top = 6.dp, bottom = 2.dp),
        verticalAlignment = Alignment.Vertical.CenterVertically
    ) {
        Text("●", style = TextStyle(color = ColorProvider(color), fontSize = 7.sp))
        Text(
            holding.ticker,
            modifier = GlanceModifier.defaultWeight().padding(start = 7.dp),
            style = TextStyle(
                color = ColorProvider(colors.textPrimary),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            ),
            maxLines = 1
        )
        Text(
            tierLabel(holding.tier),
            modifier = GlanceModifier.padding(end = 8.dp),
            style = TextStyle(color = ColorProvider(colors.textSecondary), fontSize = 10.sp),
            maxLines = 1
        )
        Text(
            holding.score?.toString() ?: "—",
            style = TextStyle(color = ColorProvider(color), fontSize = 12.sp, fontWeight = FontWeight.Bold),
            maxLines = 1
        )
    }
}

@Composable
private fun Spacer(height: Int) {
    Box(modifier = GlanceModifier.height(height.dp)) {}
}

private fun launchIntent(watchlistId: String?, ticker: String? = null) = Intent().apply {
    setClassName("com.zandaulion.omaha", MAIN_ACTIVITY)
    watchlistId?.let { putExtra(EXTRA_WATCHLIST_ID, it) }
    ticker?.let { putExtra(EXTRA_TICKER, it) }
}

internal fun attentionFirst(holdings: List<WidgetHoldingEntry>): List<WidgetHoldingEntry> =
    holdings.sortedWith(
        compareBy<WidgetHoldingEntry> { tierRank(it.tier) }
            .thenBy { it.score ?: -1 }
            .thenBy { it.ticker }
    )

private fun tierRank(tier: String): Int = when (tier) {
    "risk" -> 0
    "moderate" -> 1
    "good" -> 2
    "pristine" -> 3
    else -> 0
}

internal fun formatUpdatedAt(value: String?): String? {
    if (value.isNullOrBlank()) return null
    return runCatching {
        val localTime = Instant.parse(value).atZone(ZoneId.systemDefault())
        "Updated ${DateTimeFormatter.ofPattern("HH:mm").format(localTime)}"
    }.getOrNull()
}

private fun tierColor(colors: OmahaColors, tier: String): Color = when (tier) {
    "pristine" -> colors.healthPristine
    "good" -> colors.healthGood
    "moderate" -> colors.healthModerate
    else -> colors.healthRisk
}

private fun tierBackground(colors: OmahaColors, tier: String): Color = when (tier) {
    "pristine" -> colors.healthPristineBg
    "good" -> colors.healthGoodBg
    "moderate" -> colors.healthModerateBg
    else -> colors.healthRiskBg
}

private fun tierLabel(tier: String): String = when (tier) {
    "pristine" -> "Strong"
    "good" -> "Good"
    "moderate" -> "Mixed"
    else -> "Weak"
}
