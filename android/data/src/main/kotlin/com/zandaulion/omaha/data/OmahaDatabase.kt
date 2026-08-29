package com.zandaulion.omaha.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction

/**
 * On-device storage for the things a person wrote.
 *
 * Deliberately narrow. The PWA's schema has ten tables; this has two, because
 * the rest are either a cache that will be re-fetched or the multi-device
 * apparatus — devices, invites, push subscriptions — that exists only because
 * the PWA is served over a network. An app with no account needs none of it.
 *
 * Column names and JSON encodings match `server/db.js` exactly. That is not
 * tidiness: the same `core/backup.js` reads both, so a field spelled
 * differently here would be a field that silently fails to import.
 */
@Entity(tableName = "theses")
data class ThesisRow(
    @PrimaryKey val ticker: String,
    val conviction: String = "high",
    val targetBuyPrice: Double? = null,
    val coreRationale: String = "",
    /** JSON arrays, stored as text exactly as the PWA stores them. */
    val moatTagsJson: String = "[]",
    val sellTriggersJson: String = "[]",
    val journalEntriesJson: String = "[]",
    /** ISO-8601. Room has no `datetime('now')`, and ISO is what core/time.js prefers. */
    val updatedAt: String
)

@Entity(tableName = "watchlists")
data class WatchlistRow(
    @PrimaryKey val id: String,
    val name: String,
    val tickersJson: String = "[]",
    val isDefault: Boolean = false,
    val updatedAt: String
)

@Dao
interface PersonalDataDao {
    @Query("SELECT * FROM theses ORDER BY ticker")
    suspend fun theses(): List<ThesisRow>

    @Query("SELECT * FROM watchlists ORDER BY id")
    suspend fun watchlists(): List<WatchlistRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTheses(rows: List<ThesisRow>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertWatchlists(rows: List<WatchlistRow>)

    @Query("DELETE FROM theses")
    suspend fun clearTheses()

    @Query("DELETE FROM watchlists")
    suspend fun clearWatchlists()

    /**
     * Apply a merge result in one transaction.
     *
     * All or nothing: a restore that half-applied would leave someone unable to
     * say what they now have, which is worse than one that plainly failed.
     */
    @Transaction
    suspend fun replaceAll(theses: List<ThesisRow>, watchlists: List<WatchlistRow>) {
        upsertTheses(theses)
        upsertWatchlists(watchlists)
    }
}

/**
 * A generated AI analysis, cached on-device so opening the AI tab does not
 * always cost a network round trip to the relay's own cache.
 *
 * [summaryJson] is [AiSummary.toJsonObject]'s output, stored as text — the
 * same shape [parseAiSummaryObject] reads, so there is one parse path rather
 * than a second one that only runs against this table. Keyed by ticker like
 * [StockCacheRow]: a fetch-again cache, not a backup, so it is not carried by
 * `core/backup.js` and a device with two Google accounts simply shows
 * whichever account last generated or fetched each ticker.
 */
@Entity(tableName = "ai_summaries")
data class AiSummaryRow(
    @PrimaryKey val ticker: String,
    val summaryJson: String,
    val cachedAt: String
)

@Dao
interface AiSummaryDao {
    @Query("SELECT * FROM ai_summaries WHERE ticker = :ticker")
    suspend fun find(ticker: String): AiSummaryRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: AiSummaryRow)
}

@Database(
    entities = [
        ThesisRow::class, WatchlistRow::class, StockCacheRow::class, AppSettingRow::class,
        SnapshotRow::class, NotificationSettingsRow::class, NotificationRow::class,
        AiSummaryRow::class
    ],
    // 2: app_settings, for the Settings view. Room has no data to preserve
    // that a re-fetch cannot replace, but theses and watchlists are not
    // re-fetchable, so this must be a migration and never a destructive
    // rebuild. Adding a table is additive; Room generates it automatically.
    //
    // 3: the three alert tables. `notification_history` is the one with real
    // weight — the cooldown floor is enforced against it, so losing it would
    // let every standing condition re-announce itself on the next sweep.
    //
    // 4: ai_summaries. Additive, and re-fetchable like stock_cache — losing it
    // costs a relay round trip, never material a person wrote.
    version = 4,
    exportSchema = false
)
abstract class OmahaDatabase : RoomDatabase() {
    abstract fun personalData(): PersonalDataDao

    /**
     * Kept apart from [personalData] because the two are different in kind: one
     * holds what a person wrote and must never be lost, the other holds what
     * can be fetched again. Only the first belongs in a backup.
     */
    abstract fun stockCache(): StockCacheDao

    abstract fun appSettings(): AppSettingsDao

    abstract fun alerts(): AlertsDao

    abstract fun aiSummaries(): AiSummaryDao
}
