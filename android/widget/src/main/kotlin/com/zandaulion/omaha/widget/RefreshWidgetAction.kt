package com.zandaulion.omaha.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import androidx.work.ListenableWorker
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager

/**
 * The manual-refresh tap. Enqueues `:app`'s `WidgetRefreshWorker` by class
 * name rather than by reference — this module deliberately does not depend
 * on `:app` (see build.gradle.kts), so a `Class.forName` lookup is the way
 * to reach a worker this module cannot import. WorkManager only ever needed
 * the class object to instantiate the worker; where that `Class` came from
 * was never part of the contract.
 *
 * Refreshes every placed widget, the same one-off job
 * `WidgetConfigActivity` already triggers on first configuration, rather
 * than only this instance — [WidgetRefreshWorker] already loops every
 * `GlanceId` it finds, and a second, narrower code path would be a second
 * definition of "how to refresh one widget."
 */
class RefreshWidgetAction : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters
    ) {
        @Suppress("UNCHECKED_CAST")
        val workerClass = Class.forName(WORKER_CLASS_NAME) as Class<out ListenableWorker>
        WorkManager.getInstance(context).enqueue(OneTimeWorkRequest.Builder(workerClass).build())
    }

    private companion object {
        const val WORKER_CLASS_NAME = "com.zandaulion.omaha.app.widget.WidgetRefreshWorker"
    }
}
