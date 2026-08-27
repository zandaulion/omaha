package com.zandaulion.omaha.data

import com.zandaulion.omaha.engine.BackupEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Backup export and import, through the shared merge rules.
 *
 * `core/backup.js` decides which version of a thesis wins and which journal
 * entries survive — in QuickJS, from the same source the PWA server runs. Doc
 * 13 §22 is explicit that nothing about meaning is written in Kotlin here:
 * `PersonalDataStore` moves rows between Room and the interchange shape and
 * nothing else, exactly as `server/backup-store.js` does for SQLite.
 *
 * That matters more than it looks. A merge implemented twice is a merge that
 * eventually loses somebody's note, and the note it loses is the one written on
 * the device that was not the one being restored onto.
 */
class BackupIo(
    private val engine: BackupEngine,
    private val store: PersonalDataStore
) {
    /** The interchange JSON, ready to write to a file the user chose. */
    suspend fun export(): String = withContext(Dispatchers.IO) {
        engine.build(store.read(), isoNow())
    }

    /**
     * Merge a file in, and report what happened rather than only that it did.
     *
     * A restore that silently succeeded would leave someone unable to say what
     * they now have. The counts come back from the merged data, and a file from
     * a newer schema is refused whole rather than partially read — dropping
     * fields it does not understand would lose data while reporting success.
     */
    suspend fun import(fileContents: String): ImportResult = withContext(Dispatchers.IO) {
        val merged = engine.merge(fileContents, store.read())
        store.write(merged, isoNow())
        val after = store.read()
        ImportResult(
            theses = countOf(after, "theses"),
            watchlists = countOf(after, "watchlists")
        )
    }

    private fun countOf(json: String, key: String): Int = runCatching {
        val obj = kotlinx.serialization.json.Json
            .parseToJsonElement(json) as kotlinx.serialization.json.JsonObject
        (obj[key] as? kotlinx.serialization.json.JsonArray)?.size ?: 0
    }.getOrDefault(0)

    data class ImportResult(val theses: Int, val watchlists: Int)
}
