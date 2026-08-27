package com.zandaulion.omaha.app.alerts

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.zandaulion.omaha.app.ui.OmahaEngine
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

/**
 * The background sweep: re-score every watched holding, show what fired.
 *
 * The Android counterpart of `startAlertWorker` in `server/alerts.js`, and the
 * reason phase 5 needs no server. The rules, the cooldowns and the decision to
 * stop early are all `core/`'s; this class supplies a schedule, a place to run
 * and a way to reach the notification shade.
 *
 * ## The cadence is a target, not a guarantee
 *
 * Doze, App Standby buckets and OEM task killers all defer periodic work, and
 * on some vendors' builds — Xiaomi's among the more aggressive — a background
 * worker can be dropped entirely once the app has been unused for a few days.
 * Nothing here can fix that, and pretending otherwise would be worse than
 * saying so: the Settings screen shows when the last sweep actually ran, so a
 * schedule that is not being honoured is visible rather than merely absent.
 *
 * No battery-optimisation exemption is requested. It is a system dialog that
 * asks a person to weaken a protection, for a feature whose worst failure is a
 * quarterly filing noticed six hours late — and asking for it up front, before
 * the app has shown a single useful alert, is how the request gets refused.
 * The Settings card offers the route once there is evidence of a problem.
 */
class AlertSweepWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val handles = OmahaEngine.get(applicationContext)
        val notifier = AlertNotifier(applicationContext)
        notifier.ensureChannels()

        return try {
            val result = handles.alerts.sweep(
                deliver = { alert -> notifier.show(alert) },
                log = { line -> Log.i(TAG, line) }
            )

            Log.i(
                TAG,
                "swept ${result.swept}, evaluated ${result.evaluated}, " +
                    "sent ${result.delivered.size}, suppressed ${result.suppressed.size}" +
                    (result.abandonedAt?.let { ", abandoned at $it" } ?: "")
            )

            // Checked on every sweep rather than scheduled separately: a
            // worker deferred past 09:00 by Doze would otherwise drop that
            // week's digest entirely, and the engine's own six-day cooldown is
            // what stops the later sweeps that Sunday repeating it.
            if (handles.alerts.digestIsDue()) {
                handles.alerts.digest { alert -> notifier.show(alert) }
                    ?.let { Log.i(TAG, "digest sent: ${it.title}") }
            }

            Result.success()
        } catch (err: Throwable) {
            // Retry rather than fail: the commonest cause is no usable network
            // at the moment the window opened, and WorkManager's backoff is a
            // better answer to that than waiting six hours for the next slot.
            Log.w(TAG, "sweep failed: ${err.message}", err)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "OmahaSweep"
        private const val WORK_NAME = "omaha.alert-sweep"

        /**
         * Schedule the sweep, or leave an existing schedule alone.
         *
         * [ExistingPeriodicWorkPolicy.KEEP] rather than UPDATE: this is called
         * from `MainActivity.onCreate`, so REPLACE would restart the period on
         * every launch, and a phone opened twice a day would never reach the
         * end of a six-hour window. KEEP means the schedule survives launches
         * and is only rewritten when the interval itself changes.
         *
         * The interval comes from `core/alerts/sweep.js` through the engine,
         * which costs one QuickJS call at startup. That is the price of the two
         * clients not being able to disagree about how often "four times a day"
         * is; the fallback below applies only if the engine cannot be reached
         * at all, in which case the app has larger problems.
         */
        suspend fun schedule(context: Context) {
            val intervalMs = OmahaEngine.get(context).alerts.sweepIntervalMs()

            val request = PeriodicWorkRequestBuilder<AlertSweepWorker>(
                intervalMs, TimeUnit.MILLISECONDS
            )
                .setConstraints(
                    Constraints.Builder()
                        // Every holding is a network fetch. Running without one
                        // would burn a window producing a sweep that skipped
                        // everything, and `sweepDecision` would correctly
                        // decline to snapshot any of it.
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                // Spread the first run out rather than sweeping the moment the
                // app is installed: the watchlist is usually being loaded in
                // the foreground at exactly that moment, and the engine is
                // serialised process-wide, so the two would queue behind each
                // other for no benefit.
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        /** How long ago the last sweep ran, for the Settings card. */
        fun hoursSince(iso: String?): Long? = runCatching {
            ChronoUnit.HOURS.between(java.time.Instant.parse(iso), java.time.Instant.now())
        }.getOrNull()
    }
}
