package com.zandaulion.omaha.app.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.lifecycle.lifecycleScope
import com.zandaulion.omaha.app.ui.OmahaEngine
import com.zandaulion.omaha.data.WatchlistRow
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import com.zandaulion.omaha.widget.WidgetKeys
import kotlinx.coroutines.launch

/**
 * Shown once, when a widget is placed — `android:configure` in
 * `android/widget/src/main/res/xml/widget_info.xml`.
 *
 * There is no default to fall back to, unlike a price widget that could
 * reasonably show "whatever's first": this widget's whole point is that a
 * person chose which watchlist it tracks, so configuration is mandatory,
 * never optional. [RESULT_CANCELED] (the default, never overridden unless a
 * watchlist is actually chosen) tells the launcher to abandon the placement
 * if this activity is backed out of.
 */
class WidgetConfigActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        setResult(RESULT_CANCELED)
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        setContent {
            ConfigScreen(
                onChosen = { list -> choose(appWidgetId, list) }
            )
        }
    }

    private fun choose(appWidgetId: Int, list: WatchlistRow) {
        lifecycleScope.launch {
            val glanceId = GlanceAppWidgetManager(this@WidgetConfigActivity)
                .getGlanceIdBy(appWidgetId)

            updateAppWidgetState(this@WidgetConfigActivity, glanceId) { prefs ->
                prefs[WidgetKeys.watchlistId] = list.id
                prefs[WidgetKeys.watchlistName] = list.name
            }

            // Not awaited — a widget can render "Watchlist" with no score for
            // the few seconds until this finishes rather than block the
            // configuration flow on a network read.
            WidgetRefreshWorker.refreshNow(this@WidgetConfigActivity)

            setResult(
                RESULT_OK,
                Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            )
            finish()
        }
    }
}

@Composable
private fun ConfigScreen(onChosen: (WatchlistRow) -> Unit) {
    val context = LocalContext.current
    var lists by remember { mutableStateOf<List<WatchlistRow>?>(null) }

    LaunchedEffect(Unit) {
        lists = OmahaEngine.get(context).watchlists.watchlists()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Omaha.colors.bgCanvas)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        BasicText(
            "Which watchlist?",
            style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
        )
        BasicText(
            "This widget will show its health score and how it has moved.",
            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
        )

        val current = lists
        if (current == null) {
            BasicText(
                "Loading…",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(current, key = { it.id }) { list ->
                    BasicText(
                        list.name,
                        modifier = Modifier
                            .clickable { onChosen(list) }
                            .padding(vertical = 14.dp),
                        style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary)
                    )
                }
            }
        }
    }
}
