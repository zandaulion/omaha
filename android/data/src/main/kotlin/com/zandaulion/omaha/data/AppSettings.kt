package com.zandaulion.omaha.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * Application preferences, mirroring `app_settings` in the PWA.
 *
 * Same table name, same key/value shape, same keys — `server/app-settings.js`
 * is the reference. That matters for one reason beyond tidiness: a preference
 * spelled differently on the two clients is a preference that silently reverts
 * to its default when a person moves between them, and the default here is the
 * closed one.
 *
 * The VAPID keypair the PWA keeps in this table has no Android counterpart, so
 * only the preferences are modelled.
 */
@Entity(tableName = "app_settings")
data class AppSettingRow(
    @PrimaryKey val key: String,
    /** '0' or '1', as text, because that is the column the PWA writes. */
    val value: String
)

@Dao
interface AppSettingsDao {
    @Query("SELECT * FROM app_settings WHERE key = :key")
    suspend fun get(key: String): AppSettingRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(row: AppSettingRow)
}

/**
 * The typed accessor. Defaults live here rather than at each call site, so
 * "what happens when nobody has chosen" has one answer.
 */
class AppSettings(private val dao: AppSettingsDao) {

    /**
     * Whether the user's own writing about a company is sent to Gemini.
     *
     * Off until someone turns it on, matching the PWA exactly. The payload
     * carries conviction, target buy price, rationale and — most personally —
     * the pre-committed sell guardrails, which are a record of what would make
     * somebody abandon a position. Doc 13 §1 asked for an explicit, default-off
     * toggle rather than a line in a privacy policy. A default that leaks is
     * not a default.
     */
    suspend fun aiIncludeNotes(): Boolean = readFlag(KEY_AI_INCLUDE_NOTES)

    suspend fun setAiIncludeNotes(enabled: Boolean) = writeFlag(KEY_AI_INCLUDE_NOTES, enabled)

    private suspend fun readFlag(key: String): Boolean =
        dao.get(key)?.value?.let { it == "1" || it.toIntOrNull()?.let { n -> n != 0 } == true } ?: false

    private suspend fun writeFlag(key: String, enabled: Boolean) =
        dao.put(AppSettingRow(key, if (enabled) "1" else "0"))

    companion object {
        const val KEY_AI_INCLUDE_NOTES = "ai_include_notes"
    }
}
