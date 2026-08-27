package com.zandaulion.omaha.app.alerts

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.zandaulion.omaha.app.MainActivity
import com.zandaulion.omaha.app.R
import com.zandaulion.omaha.data.Alert

/**
 * Puts an [Alert] on the phone.
 *
 * The whole Android half of delivery. Nothing here decides what to say — the
 * title, the body and the severity all arrive composed by
 * `core/alerts/triggers.js`, so a person who gets the web push and then opens
 * the phone reads the same sentence rather than two accounts of one event.
 *
 * ## One channel per alert type
 *
 * The five channels are the five `notify_*` settings, deliberately. Android
 * gives every channel its own switch, importance and sound in system settings,
 * and a person who silences "Buybacks and dividends" there means exactly what
 * they would mean by unticking it in ours. Collapsing these into one channel
 * would make the OS control all-or-nothing, and the in-app toggles would then
 * be the only way to say "warnings yes, entry points no" — a worse answer than
 * the platform's own.
 *
 * Importance is set from what the alert is *for*. A distress signal is the only
 * one worth interrupting for; a weekly summary is not, and giving it the same
 * weight is how the distress signal stops being noticed.
 */
class AlertNotifier(private val context: Context) {

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return

        for (channel in Channel.entries) {
            manager.createNotificationChannel(
                NotificationChannel(channel.id, channel.title, channel.importance).apply {
                    description = channel.description
                }
            )
        }
    }

    /** True when Android will actually show what we post. */
    fun permitted(): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Post one alert.
     *
     * Silently a no-op without permission, and that is the right shape: the
     * sweep still runs, still records history and still updates snapshots, so
     * the alert centre in Settings shows everything that fired. Refusing
     * notification permission turns the feature into an in-app one rather than
     * turning it off — and, importantly, does not desynchronise the cooldowns.
     */
    fun show(alert: Alert) {
        if (!permitted()) return

        val channel = Channel.forType(alert.type)
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            // The PWA's `url` carries the same destination as a query string.
            // Android navigates by ticker instead of parsing a web route: the
            // two clients agree on what a deep link means but not on how to
            // spell it, and only the meaning has to be shared.
            if (alert.ticker.isNotEmpty()) putExtra(MainActivity.EXTRA_TICKER, alert.ticker)
        }

        val notification = NotificationCompat.Builder(context, channel.id)
            .setSmallIcon(R.drawable.ic_stat_omaha)
            .setContentTitle(alert.title)
            .setContentText(alert.body)
            // The bodies run to two or three sentences — "Health down 4 points
            // to 62/100. Gross margin: pass to watch." — and a collapsed
            // notification cuts that at the first clause, which is the half
            // that says what happened but not why.
            .setStyle(NotificationCompat.BigTextStyle().bigText(alert.body))
            .setPriority(channel.compatPriority)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setAutoCancel(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    context,
                    alert.tag().hashCode(),
                    open,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

        // One bubble per ticker per alert type, matching `server/alerts.js`'s
        // push tag. A second health change for the same company replaces the
        // first rather than stacking, because the newer one is the true state.
        NotificationManagerCompat.from(context).notify(alert.tag(), NOTIFICATION_ID, notification)
    }

    private fun Alert.tag(): String =
        if (ticker.isNotEmpty()) "$type:$ticker" else type

    /**
     * The five channels, one per `notify_*` setting.
     *
     * Ids are stable strings and must stay that way: Android remembers a
     * channel's importance and sound against its id, and renaming one silently
     * resets whatever the user chose for it.
     */
    enum class Channel(
        val id: String,
        val title: String,
        val description: String,
        val importance: Int,
        val compatPriority: Int
    ) {
        RedFlags(
            "omaha.red_flags",
            "Warning signs",
            "Distress signals: Altman Z, liquidity, margin collapse.",
            NotificationManager.IMPORTANCE_HIGH,
            NotificationCompat.PRIORITY_HIGH
        ),
        HealthShift(
            "omaha.health_shift",
            "Health changes",
            "A health score moves 3 points, or a check changes state.",
            NotificationManager.IMPORTANCE_DEFAULT,
            NotificationCompat.PRIORITY_DEFAULT
        ),
        MarginOfSafety(
            "omaha.margin_of_safety",
            "Entry points",
            "A strong company reaches an attractive price.",
            NotificationManager.IMPORTANCE_DEFAULT,
            NotificationCompat.PRIORITY_DEFAULT
        ),
        CapitalReturns(
            "omaha.capital_returns",
            "Buybacks and dividends",
            "Capital allocation changes.",
            NotificationManager.IMPORTANCE_LOW,
            NotificationCompat.PRIORITY_LOW
        ),
        Digest(
            "omaha.digest",
            "Sunday summary",
            "A weekly summary of your default watchlist.",
            NotificationManager.IMPORTANCE_LOW,
            NotificationCompat.PRIORITY_LOW
        );

        companion object {
            /**
             * An unrecognised type lands on [HealthShift] rather than being
             * dropped. A new trigger added to `core/` should reach a phone that
             * has not been rebuilt for it — in the wrong drawer, rather than
             * not at all.
             */
            fun forType(type: String): Channel = when (type) {
                "RED_FLAG_WARNING" -> RedFlags
                "MARGIN_OF_SAFETY" -> MarginOfSafety
                "CAPITAL_RETURN" -> CapitalReturns
                "WEEKLY_DIGEST" -> Digest
                else -> HealthShift
            }
        }
    }

    private companion object {
        /**
         * Constant, because the *tag* is what separates one bubble from
         * another. Android keys a notification on the pair.
         */
        const val NOTIFICATION_ID = 1
    }
}
