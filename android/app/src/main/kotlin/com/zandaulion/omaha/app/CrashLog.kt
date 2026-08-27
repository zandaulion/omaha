package com.zandaulion.omaha.app

import android.content.Context
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * The stack trace of the last uncaught crash, written where the next launch
 * can read it back.
 *
 * This app is sideloaded and tested by copying an APK through Syncthing, not
 * by USB debugging — there is no `adb logcat` in the loop. Without this, a
 * crash on a real handset produces nothing more diagnosable than "it
 * crashed," which is exactly what happened the first time phase 5's alert
 * code ran on a device: none of it had ever executed outside a compiler
 * before that point.
 *
 * Written to internal storage (`filesDir`), which needs no permission and is
 * private to this app — a crash trace can carry a ticker or a filing date,
 * and there is no reason to put it anywhere world-readable.
 */
object CrashLog {

    private const val FILE_NAME = "last_crash.txt"

    /**
     * Install a handler that records the trace before letting the platform's
     * own handler run.
     *
     * Delegates to whatever handler was already registered — normally the
     * system's own crash-and-restart machinery — so this changes nothing
     * about how a crash behaves. It only leaves a note behind first.
     */
    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        val appContext = context.applicationContext

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val writer = StringWriter()
                throwable.printStackTrace(PrintWriter(writer))
                File(appContext.filesDir, FILE_NAME).writeText(writer.toString())
            } catch (loggingFailed: Throwable) {
                // The crash itself is the thing that matters. Losing the note
                // about it must never be what actually terminates the process.
                Log.e("OmahaCrash", "could not record crash", loggingFailed)
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    /**
     * The trace from the crash before this launch, if there was one — read
     * once and cleared, so it is shown exactly once rather than on every
     * cold start until manually dismissed.
     */
    fun consumePending(context: Context): String? {
        val file = File(context.applicationContext.filesDir, FILE_NAME)
        if (!file.isFile) return null
        return runCatching { file.readText() }.getOrNull()?.also { file.delete() }
    }
}
