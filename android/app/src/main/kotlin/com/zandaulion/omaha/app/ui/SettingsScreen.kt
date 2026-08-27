package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.AlertSettings
import com.zandaulion.omaha.data.NotificationRow
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.ThemeChoice
import com.zandaulion.omaha.design.toTextStyle

/**
 * Settings, matching the PWA's modal.
 *
 * Carries the two things doc 14 §1 requires in the interface — the notes
 * opt-in and the canonical "what this app is" statement — plus backup, which
 * closes doc 13 §11 step 3's outstanding SAF item.
 */
@Composable
fun SettingsScreen(
    includeNotes: Boolean,
    theme: ThemeChoice,
    backupStatus: String?,
    alerts: AlertsUi?,
    onIncludeNotesChange: (Boolean) -> Unit,
    onThemeChange: (ThemeChoice) -> Unit,
    onAlertsChange: (AlertSettings) -> Unit,
    onRequestPermission: () -> Unit,
    onTestNotification: () -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        BasicText("Settings", style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary))

        SettingsCard("🔒 AI analysis & your notes") {
            BasicText(
                "Gemini always receives the company's filed financials, computed ratios " +
                    "and the 12-point checklist. It never receives your journal entries.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
            )
            Box(Modifier.height(10.dp))
            CheckRow(
                checked = includeNotes,
                label = "Also send my notes for the company being analysed",
                onToggle = onIncludeNotesChange
            )
            Box(Modifier.height(10.dp))
            BasicText(
                "That means your conviction rating, target buy price, core rationale and " +
                    "sell guardrails — so the analysis can argue with your reasoning instead " +
                    "of ignoring it. Off by default.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }

        if (alerts != null) {
            AlertPreferencesCard(alerts, onAlertsChange, onRequestPermission, onTestNotification)
            AlertHistoryCard(alerts.history)
        }

        SettingsCard("🎨 Appearance") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                // Three states, matching the PWA's cycle exactly, so the
                // setting means the same thing on both clients.
                for (choice in ThemeChoice.entries) {
                    val label = when (choice) {
                        ThemeChoice.System -> "Follow the system"
                        ThemeChoice.Dark -> "Dark"
                        ThemeChoice.Light -> "Light"
                    }
                    val active = choice == theme
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(OmahaRadius.sm))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .border(
                                1.dp,
                                if (active) Omaha.colors.brandCyan else Omaha.colors.borderSubtle,
                                RoundedCornerShape(OmahaRadius.sm)
                            )
                            .clickable { onThemeChange(choice) }
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                    ) {
                        BasicText(
                            label,
                            style = OmahaType.bodySm.toTextStyle(
                                color = if (active) Omaha.colors.textPrimary
                                else Omaha.colors.textSecondary
                            )
                        )
                    }
                }
            }
        }

        SettingsCard("💾 Backup & restore") {
            BasicText(
                "Your theses, sell guardrails and journal notes. Restoring merges rather " +
                    "than replaces: the newer version of each thesis wins, and journal notes " +
                    "from both sides are kept.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
            )
            Box(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Action("📥 Export", onExport)
                Action("📤 Restore", onImport)
            }
            if (backupStatus != null) {
                Box(Modifier.height(10.dp))
                BasicText(
                    backupStatus,
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
            Box(Modifier.height(10.dp))
            BasicText(
                "The file is the same format the web app reads and writes, so a backup " +
                    "moves between them in either direction.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }

        // The canonical statement doc 14 §1 asks for, leading with what the app
        // is rather than only what it disclaims. Same wording as the PWA's.
        SettingsCard("📋 What this app is") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                BasicText(
                    "Every score here is arithmetic run over filed company statements. The " +
                        "same company produces the same 0–100 score for everyone using the " +
                        "app — nothing is tailored to you, your finances or your goals. Where " +
                        "the filings do not contain a number, the app reports it as not " +
                        "measured rather than estimating one.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
                BasicText(
                    "Your thesis, target price and sell guardrails are your own writing, kept " +
                        "on your device. The app records them and reminds you of them. It does " +
                        "not endorse them.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
                BasicText(
                    "This is not investment advice, and nothing in it is a recommendation to " +
                        "buy or sell. A DCF fair value is the output of assumptions you choose " +
                        "— move a slider and the \"fair value\" moves with it. AI analysis is " +
                        "generated text and can be wrong, confidently and in detail. Your " +
                        "investment decisions remain yours.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
        }

        SettingsCard("🔐 What leaves this device") {
            BasicText(
                "Market data requests: the ticker you are looking at, to SEC EDGAR and " +
                    "Yahoo. Nothing else. No account, no telemetry, no sync — your " +
                    "watchlists, theses, journal entries and settings are never transmitted.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
            )
        }
    }
}

/**
 * Which alerts to send, matching the PWA's card of the same name.
 *
 * Same five checkboxes, same order, same sentences. They are the same five
 * `notify_*` flags underneath and are read by the same trigger rules, so
 * wording them differently would be describing one behaviour two ways.
 */
@Composable
private fun AlertPreferencesCard(
    alerts: AlertsUi,
    onChange: (AlertSettings) -> Unit,
    onRequestPermission: () -> Unit,
    onTest: () -> Unit
) {
    val s = alerts.settings

    SettingsCard("🔔 Which alerts to send") {
        BasicText(
            "Watchlist holdings are re-checked four times a day, on this device. " +
                "Nothing is sent anywhere to make an alert happen.",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
        )
        Box(Modifier.height(12.dp))

        CheckRow(s.earningsAndFilings, "Health score moves 3 points or a check changes state") {
            onChange(s.copy(earningsAndFilings = it))
        }
        Box(Modifier.height(8.dp))
        CheckRow(s.redFlags, "Distress signals: Altman Z, liquidity, margin collapse") {
            onChange(s.copy(redFlags = it))
        }
        Box(Modifier.height(8.dp))
        CheckRow(s.marginOfSafety, "Strong company reaches an attractive price") {
            onChange(s.copy(marginOfSafety = it))
        }
        Box(Modifier.height(8.dp))
        CheckRow(s.capitalReturns, "Buyback and dividend changes") {
            onChange(s.copy(capitalReturns = it))
        }
        Box(Modifier.height(8.dp))
        CheckRow(s.sundayDigest, "Sunday morning portfolio summary") {
            onChange(s.copy(sundayDigest = it))
        }

        if (!alerts.permitted) {
            // Not a modal on first launch. Asking before the app has produced a
            // single alert is asking someone to agree to something they have no
            // way to judge, and a refusal here is remembered by the system.
            // The checks above keep working either way — the sweep still runs
            // and still records — so this offers the last step rather than
            // gating the feature behind it.
            Box(Modifier.height(14.dp))
            BasicText(
                "Android is not showing these yet. They are still recorded below, " +
                    "but nothing will reach your lock screen until you allow it.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.healthModerate)
            )
            Box(Modifier.height(10.dp))
            Action("Allow notifications", onRequestPermission)
        } else {
            Box(Modifier.height(14.dp))
            Action("Send a test notification", onTest)
        }

        // Doze and OEM task killers make the cadence approximate, so the honest
        // thing is to show when it last actually happened rather than to state
        // a schedule the system may not be honouring.
        Box(Modifier.height(12.dp))
        BasicText(
            lastCheckedLine(alerts.lastSweepAt),
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )
    }
}

/**
 * The alert centre — the PWA's `#notificationHistory`, on a phone.
 *
 * Worth having even though these arrive as notifications: a notification that
 * was dismissed on the lock screen is gone, and the reason a holding was
 * flagged three days ago is exactly the sort of thing someone goes looking for
 * afterwards.
 */
@Composable
private fun AlertHistoryCard(history: List<NotificationRow>) {
    SettingsCard("📜 Recent alerts") {
        if (history.isEmpty()) {
            BasicText(
                "No alerts yet. Holdings are checked four times a day.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
            return@SettingsCard
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (row in history) {
                // `.notification-row` in web/app.css: a subtle surface, small
                // radius, 9x11 padding and a 3px severity rail down the left.
                Row(
                    Modifier
                        .fillMaxWidth()
                        // Intrinsic min height so the rail can match the text
                        // block beside it. `fillMaxHeight` in a wrap-content
                        // Row measures against an unbounded constraint and
                        // collapses; this is the same trap the trend charts'
                        // missing-year column fell into in phase 4.
                        .height(IntrinsicSize.Min)
                        .clip(RoundedCornerShape(OmahaRadius.sm))
                        .background(Omaha.colors.bgSurfaceSubtle)
                ) {
                    Box(
                        Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .background(severityColour(row.severity))
                    )
                    Column(Modifier.padding(horizontal = 11.dp, vertical = 9.dp)) {
                        BasicText(
                            row.title,
                            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                        )
                        Box(Modifier.height(2.dp))
                        BasicText(
                            row.body,
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                        )
                        Box(Modifier.height(4.dp))
                        BasicText(
                            relativeTime(row.deliveredAt),
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                        )
                    }
                }
            }
        }
    }
}

/**
 * The severity rail's colour, matching `.notification-row.is-*`.
 *
 * `positive` is health-pristine rather than health-good, which is what the CSS
 * uses — the two greens are close enough that picking the wrong one looks
 * right on a phone and wrong beside the web client.
 */
@Composable
private fun severityColour(severity: String) = when (severity) {
    "critical" -> Omaha.colors.healthRisk
    "warning" -> Omaha.colors.healthModerate
    "positive" -> Omaha.colors.healthPristine
    else -> Omaha.colors.brandCyan
}

/**
 * "4 h ago" from an ISO-8601 stamp — the same ladder as `formatRelativeTime`
 * in `web/app.js`, so the two clients describe the same age the same way.
 */
private fun relativeTime(iso: String): String {
    val then = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return ""
    val minutes = java.time.Duration.between(then, java.time.Instant.now()).toMinutes()
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 1440 -> "${minutes / 60} h ago"
        minutes < 2880 -> "yesterday"
        else -> "${minutes / 1440} days ago"
    }
}

private fun lastCheckedLine(iso: String?): String =
    if (iso == null) {
        "No check has completed yet. The first runs about fifteen minutes after install."
    } else {
        "Last checked ${relativeTime(iso)}. Battery optimisation can delay this; " +
            "if it falls badly behind, exempt Pocket Omaha in Android's battery settings."
    }

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.md))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.md))
            .padding(14.dp)
    ) {
        BasicText(title, style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        Box(Modifier.height(8.dp))
        content()
    }
}

@Composable
private fun CheckRow(checked: Boolean, label: String, onToggle: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onToggle(!checked) },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(18.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(if (checked) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle)
                .border(
                    1.dp,
                    if (checked) Omaha.colors.brandCyan else Omaha.colors.borderProminent,
                    RoundedCornerShape(4.dp)
                ),
            contentAlignment = Alignment.Center
        ) {
            if (checked) {
                BasicText("✓", style = OmahaType.caption.toTextStyle(color = Omaha.colors.bgCanvas))
            }
        }
        Box(Modifier.padding(start = 10.dp)) {
            BasicText(
                label,
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
            )
        }
    }
}

@Composable
private fun Action(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.pill))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp)
    ) {
        BasicText(label, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
    }
}
