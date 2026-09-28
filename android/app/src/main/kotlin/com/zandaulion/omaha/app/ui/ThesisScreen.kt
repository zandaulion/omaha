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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.JournalEntry
import com.zandaulion.omaha.data.SellTrigger
import com.zandaulion.omaha.data.Thesis
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

private val CONVICTIONS = listOf(
    "fortress" to "Very high",
    "high" to "High",
    "medium" to "Moderate",
    "speculative" to "Speculative"
)

/** Personal reasons are edited in place; dated reviews and notes remain append-only. */
@Composable
fun ThesisSection(
    thesis: Thesis,
    onChange: (Thesis) -> Unit,
    onAddJournal: (String) -> Unit,
    onRecordReview: (String, String) -> Unit,
    reviewSaving: Boolean,
    reviewSave: String?,
    thesisSave: String?
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {

        Field("Why I follow this company", hint = "A few sentences in your own words. These notes save as you edit.") {
            TextBox(
                value = thesis.coreRationale,
                placeholder = "What makes this company worth following?",
                minLines = 4,
                onValueChange = { onChange(thesis.copy(coreRationale = it)) }
            )
        }

        Field("What must remain true") {
            TextBox(
                value = thesis.mustRemainTrue,
                placeholder = "Which business conditions support your reasons?",
                minLines = 3,
                onValueChange = { onChange(thesis.copy(mustRemainTrue = it)) }
            )
        }

        Field(
            "What would make me reconsider",
            hint = "Your manual checklist. Mark a condition when you believe it has occurred; the app does not monitor these written conditions."
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                thesis.sellTriggers.forEach { trigger ->
                    TriggerRow(trigger) { updated ->
                        onChange(
                            thesis.copy(
                                sellTriggers = thesis.sellTriggers.map {
                                    if (it.id == updated.id) updated else it
                                }
                            )
                        )
                    }
                }

                AddTrigger { text ->
                    onChange(
                        thesis.copy(
                            sellTriggers = thesis.sellTriggers +
                                SellTrigger(System.currentTimeMillis().toString(), text)
                        )
                    )
                }
            }
        }

        thesisSave?.let {
            BasicText(it, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
        }

        Field("Record a review", hint = "Your assessment, after considering the financial picture and your own reasons.") {
            RecordReview(thesis.ticker, reviewSaving, reviewSave, onRecordReview)
        }

        var detailsExpanded by remember(thesis.ticker) { mutableStateOf(false) }
        ReviewAction(if (detailsExpanded) "Hide conviction & entry price" else "Conviction & entry price (optional)") {
            detailsExpanded = !detailsExpanded
        }
        if (detailsExpanded) {
        Field("Conviction") {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((key, label) in CONVICTIONS) {
                    val active = thesis.conviction == key
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(OmahaRadius.sm))
                            .background(
                                if (active) Omaha.colors.bgSurfaceSubtle else Omaha.colors.bgSurface
                            )
                            .border(
                                1.dp,
                                if (active) Omaha.colors.brandCyan else Omaha.colors.borderSubtle,
                                RoundedCornerShape(OmahaRadius.sm)
                            )
                            .clickable { onChange(thesis.copy(conviction = key)) }
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

        Field("Target entry buy price") {
            var raw by remember(thesis.ticker) {
                mutableStateOf(thesis.targetBuyPrice?.let { fmtRatio(it, 2) } ?: "")
            }
            TextBox(
                value = raw,
                placeholder = "e.g. 115.00",
                keyboardType = KeyboardType.Decimal,
                onValueChange = {
                    raw = it
                    // A half-typed number is not a cleared one. "1." parses to
                    // null, and writing that back would wipe the stored price
                    // mid-keystroke; only an empty field clears it.
                    val parsed = it.trim().toDoubleOrNull()
                    if (it.isBlank()) onChange(thesis.copy(targetBuyPrice = null))
                    else if (parsed != null) onChange(thesis.copy(targetBuyPrice = parsed))
                }
            )
        }


        }

        Field("Review history & notes") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AddJournal(onAddJournal)

                if (thesis.journalEntries.isEmpty()) {
                    BasicText(
                        "No reviews or notes yet. Record your first assessment above.",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                } else {
                    // Newest first. The list is append-only — nothing here
                    // edits or deletes an entry, which is what lets the backup
                    // merge union them across devices instead of choosing.
                    thesis.journalEntries.sortedByDescending { it.date }.forEach { JournalRow(it) }
                }
            }
        }
    }
}

@Composable
private fun RecordReview(ticker: String, saving: Boolean, notice: String?, onSave: (String, String) -> Unit) {
    var assessment by rememberSaveable(ticker) { mutableStateOf<String?>(null) }
    var note by rememberSaveable(ticker) { mutableStateOf("") }
    var awaitingSave by rememberSaveable(ticker) { mutableStateOf(false) }
    LaunchedEffect(notice) {
        if (awaitingSave && notice == "Review saved") {
            note = ""; assessment = null; awaitingSave = false
        } else if (notice != null) awaitingSave = false
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("intact", "watch", "changed").forEach { value ->
            ReviewAction((if (assessment == value) "✓ " else "") + reviewAssessmentLabel(value),
                primary = assessment == value, enabled = !saving) { assessment = value }
        }
        TextBox(note, "What did you check or learn? (optional)", minLines = 3, enabled = !saving, onValueChange = { note = it })
        SmallButton(if (saving) "Saving…" else "Save review", enabled = assessment != null && !saving) {
            assessment?.let { awaitingSave = true; onSave(it, note.trim()) }
        }
        notice?.let {
            BasicText(it, style = OmahaType.bodySm.toTextStyle(
                color = if (it == "Review saved") Omaha.colors.healthGood else Omaha.colors.healthRisk))
        }
    }
}

@Composable
private fun TriggerRow(trigger: SellTrigger, onChange: (SellTrigger) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .clickable { onChange(trigger.copy(triggered = !trigger.triggered)) }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(18.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(
                    if (trigger.triggered) Omaha.colors.healthRisk else Omaha.colors.bgSurface
                )
                .border(
                    1.dp,
                    if (trigger.triggered) Omaha.colors.healthRisk else Omaha.colors.borderProminent,
                    RoundedCornerShape(4.dp)
                ),
            contentAlignment = Alignment.Center
        ) {
            if (trigger.triggered) {
                BasicText("✓", style = OmahaType.caption.toTextStyle(color = Omaha.colors.bgCanvas))
            }
        }
        Box(Modifier.padding(start = 10.dp)) {
            BasicText(
                trigger.text,
                style = OmahaType.bodySm.toTextStyle(
                    // A fired trigger is emphasised rather than struck through.
                    // Struck-through text reads as "done, ignore"; this is the
                    // one line on the screen that most wants reading.
                    color = if (trigger.triggered) Omaha.colors.healthRisk
                    else Omaha.colors.textSecondary
                )
            )
        }
    }
}

@Composable
private fun AddTrigger(onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            TextBox(
                value = text,
                placeholder = "Add a condition to reconsider…",
                onValueChange = { text = it }
            )
        }
        Box(Modifier.padding(start = 8.dp)) {
            SmallButton("Add", enabled = text.isNotBlank()) {
                onAdd(text.trim()); text = ""
            }
        }
    }
}

@Composable
private fun AddJournal(onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextBox(
            value = text,
            placeholder = "What happened, and what you thought about it.",
            minLines = 3,
            onValueChange = { text = it }
        )
        SmallButton("Add entry", enabled = text.isNotBlank()) {
            onAdd(text.trim()); text = ""
        }
    }
}

@Composable
private fun JournalRow(entry: JournalEntry) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .padding(10.dp)
    ) {
        BasicText(
            reviewDate(entry.date),
            style = OmahaType.caption
                .toTextStyle(color = Omaha.colors.textTertiary)
                .copy(fontFamily = Omaha.fonts.mono)
        )
        Box(Modifier.height(4.dp))
        if (entry.kind == "review") entry.assessment?.let { assessment ->
            BasicText(reviewAssessmentLabel(assessment), style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.brandCyan))
        }
        if (entry.note.isNotBlank()) BasicText(entry.note, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary))
    }
}

@Composable
private fun Field(label: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicText(label, style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        if (hint != null) {
            BasicText(hint, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
        }
        content()
    }
}

/**
 * A text field on foundation.
 *
 * `BasicTextField` rather than Material's `TextField` for the same reason the
 * rest of this app avoids Material: the decorated version brings its own
 * colours, shapes and label behaviour, and matching the PWA's inputs would mean
 * overriding all three.
 */
@Composable
private fun TextBox(
    value: String,
    placeholder: String,
    minLines: Int = 1,
    keyboardType: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true,
    onValueChange: (String) -> Unit
) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) {
            BasicText(
                placeholder,
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary),
            cursorBrush = SolidColor(Omaha.colors.brandCyan),
            minLines = minLines,
            enabled = enabled,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun SmallButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(
                if (enabled) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp)
    ) {
        BasicText(
            label,
            style = OmahaType.caption.toTextStyle(
                color = if (enabled) Omaha.colors.bgCanvas else Omaha.colors.textTertiary
            )
        )
    }
}
