package com.zandaulion.omaha.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/** The manifest's entry point — the OS talks to this, this talks to Glance. */
class PocketOmahaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PocketOmahaWidget()
}
