package com.zandaulion.omaha.app

import android.app.Application

/**
 * Installs [CrashLog] before anything else in the process runs.
 *
 * Has to be an `Application`, not something done in `MainActivity.onCreate` —
 * a crash in a background sweep, a `ContentProvider`, or anywhere else that
 * runs before the first activity would otherwise go unrecorded.
 */
class OmahaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
    }
}
