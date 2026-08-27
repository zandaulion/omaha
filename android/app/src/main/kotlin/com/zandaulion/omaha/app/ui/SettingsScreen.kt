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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
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
    onIncludeNotesChange: (Boolean) -> Unit,
    onThemeChange: (ThemeChoice) -> Unit,
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
