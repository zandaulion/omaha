package com.zandaulion.omaha.engine

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import java.io.File

/**
 * Reads, writes and merges backups using `core/backup.js` — the same rules the
 * PWA applies.
 *
 * Reimplementing the merge in Kotlin is the one thing that must not happen
 * here. The rules are subtle in ways that matter: a thesis takes the newer
 * version whole while its journal entries are unioned, a watchlist takes the
 * newer version including removals, ties go to what is already on the device.
 * Two implementations of that would agree in testing and disagree on somebody's
 * actual data, and the failure mode is a note silently vanishing.
 */
class BackupEngine private constructor(private val bridge: JsBridge) {

    /**
     * Build an export from this device's data.
     *
     * @param dataJson `{ theses: [...], watchlists: [...] }`
     * @param exportedAt ISO-8601
     */
    suspend fun build(dataJson: String, exportedAt: String): String =
        bridge.call("buildBackup", dataJson, quote(exportedAt))

    /**
     * Merge an imported file against what is already here.
     *
     * @return `{ theses, watchlists, report }`
     * @throws JsBridgeException if the file is malformed or from a newer
     *   schema version — the message is the one `core/backup.js` wrote.
     */
    suspend fun merge(incomingJson: String, currentJson: String): String =
        bridge.call("mergeBackup", incomingJson, currentJson)

    companion object {
        const val BUNDLE_PATH = "dist/backup.bundle.js"

        fun fromSource(
            bundleSource: String,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): BackupEngine = BackupEngine(JsBridge(bundleSource, dispatcher))

        fun create(
            coreDir: File,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): BackupEngine {
            val bundle = File(coreDir, BUNDLE_PATH)
            require(bundle.isFile) {
                "${bundle.absolutePath} not found. Run `npm run bundle:core`."
            }
            return fromSource(bundle.readText(), dispatcher)
        }

        /**
         * The one bare string this bridge passes is an ISO-8601 timestamp,
         * which by construction contains nothing JSON needs escaped. Checked
         * rather than assumed, and checked rather than escaped: a hand-rolled
         * JSON escaper is a liability out of all proportion to one timestamp.
         */
        private fun quote(value: String): String {
            require(value.none { it == '"' || it == '\\' || it < ' ' }) {
                "Expected a plain timestamp with no JSON metacharacters, got: $value"
            }
            return "\"" + value + "\""
        }
    }
}
