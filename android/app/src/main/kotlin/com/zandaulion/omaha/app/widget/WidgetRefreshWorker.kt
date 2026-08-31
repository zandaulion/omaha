package com.zandaulion.omaha.app.widget

import android.content.Context
import android.util.Log
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.zandaulion.omaha.app.ui.OmahaEngine
import com.zandaulion.omaha.data.WidgetSnapshot
import com.zandaulion.omaha.widget.PocketOmahaWidget
import com.zandaulion.omaha.widget.WidgetKeys
import java.util.concurrent.TimeUnit

/**
 * Refreshes every placed [PocketOmahaWidget] instance.
 *
 * A dedicated worker rather than piggybacked on `AlertSweepWorker`, on
 * purpose: the sweep does real per-ticker network I/O and can legitimately
 * run long or abandon partway through, and tying widget freshness to that
 * would mean a widget goes stale specifically when the sweep is struggling,
 * for a reason a widget has no business caring about. Health scores also
 * don't move intraday, so an hourly cadence is already generous — cheaper
 * than the sweep's four-times-daily one, and it means someone who disables
 * every alert still gets a working widget.
 */
class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val handles = OmahaEngine.get(applicationContext)
        val manager = GlanceAppWidgetManager(applicationContext)
        val ids = manager.getGlanceIds(PocketOmahaWidget::class.java)

        for (id in ids) {
            refreshOne(id, handles.widget::snapshot)
        }

        return Result.success()
    }

    private suspend fun refreshOne(id: GlanceId, snapshotFor: suspend (String) -> WidgetSnapshot) {
        val watchlistId = currentWatchlistId(id) ?: return

        val snapshot = try {
            snapshotFor(watchlistId)
        } catch (err: Throwable) {
            Log.w(TAG, "widget refresh failed for $watchlistId: ${err.message}", err)
            return
        }

        updateAppWidgetState(applicationContext, id) { prefs ->
            prefs[WidgetKeys.watchlistId] = watchlistId
            prefs[WidgetKeys.watchlistName] = snapshot.watchlistName
            snapshot.compositeScore?.let { prefs[WidgetKeys.score] = it } ?: prefs.remove(WidgetKeys.score)
            snapshot.previousCompositeScore?.let { prefs[WidgetKeys.previousScore] = it }
                ?: prefs.remove(WidgetKeys.previousScore)
            prefs[WidgetKeys.tier] = snapshot.tier
            prefs[WidgetKeys.moversText] = snapshot.movers.joinToString(";") { "${it.ticker}|${it.delta}" }
            prefs[WidgetKeys.holdingsText] = snapshot.holdings.joinToString(";") {
                "${it.ticker}|${it.score ?: ""}|${it.tier}"
            }
        }
        PocketOmahaWidget().update(applicationContext, id)
    }

    private suspend fun currentWatchlistId(id: GlanceId): String? =
        getAppWidgetState(applicationContext, PreferencesGlanceStateDefinition, id)[WidgetKeys.watchlistId]

    companion object {
        private const val TAG = "OmahaWidgetRefresh"
        private const val WORK_NAME = "omaha.widget-refresh"

        /**
         * Schedule the refresh, or leave an existing schedule alone —
         * [ExistingPeriodicWorkPolicy.KEEP] for the same reason
         * `AlertSweepWorker.schedule` uses it: called from
         * `MainActivity.onCreate`, so REPLACE would restart the hour on every
         * launch. A no-op if nothing is placed yet — no widget, no work.
         */
        suspend fun schedule(context: Context) {
            val hasWidgets = GlanceAppWidgetManager(context)
                .getGlanceIds(PocketOmahaWidget::class.java)
                .isNotEmpty()
            if (!hasWidgets) return

            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        /** One-off, immediate — for the configuration activity, so a newly placed widget need not wait for the first hourly tick. */
        fun refreshNow(context: Context) {
            WorkManager.getInstance(context).enqueue(
                androidx.work.OneTimeWorkRequestBuilder<WidgetRefreshWorker>().build()
            )
        }
    }
}
