package com.zandaulion.omaha.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * Storage for the alert sweep: what each holding looked like last time, which
 * alerts the user wants, and what has already been sent.
 *
 * ## Why the snapshot is one column and not ten
 *
 * `server/db.js` gives `stock_snapshots` a column per compared field —
 * `altman_z`, `current_ratio`, `pe_percentile` and so on — because SQL is how
 * the server queries them. Nothing here queries them: the snapshot is written
 * by `core/alerts/sweep.js` and read back by the same module as the `prev`
 * argument to `evaluateTriggers`, and no Kotlin code between those two points
 * has any business knowing what is inside it.
 *
 * Mapping it into ten typed columns would put that knowledge here anyway, and
 * the failure mode is bad: `evaluateTriggers` compares with a "are both of
 * these numbers?" guard, so a field this layer dropped or misspelled reads as
 * `undefined`, and the rule goes **quiet** rather than throwing. A trigger that
 * silently stops firing is the one defect a person cannot notice, because the
 * symptom is an absence.
 *
 * So the engine's JSON is stored verbatim and handed back unexamined. Two
 * fields are denormalised out of it as an explicit exception —
 * [SnapshotRow.healthScore] and [SnapshotRow.baselineScore] — because the
 * Sunday digest is a query *across* holdings rather than a round-trip for one,
 * and reading twenty blobs to compare two integers is not a round-trip.
 * Those two are the only fields this layer knows the names of.
 */
@Entity(tableName = "stock_snapshots")
data class SnapshotRow(
    @PrimaryKey val ticker: String,
    /** `snapshotOf(stock)` exactly as the engine emitted it. Never parsed here. */
    val snapshotJson: String,
    /** Denormalised for the digest's week-over-week comparison, and only that. */
    val healthScore: Int?,
    /**
     * The rolled comparison point — `week_ago_score` inside the blob.
     *
     * Not the previous snapshot's score. The sweep overwrites the snapshot
     * from the same fetch that produced the current reading, so comparing
     * against it yields zero every time; `rollBaseline` in
     * `core/alerts/sweep.js` keeps this one deliberately slow-moving.
     */
    val baselineScore: Int?,
    /** ISO-8601 UTC. `core/time.js` reads this form on either host. */
    val capturedAt: String
)

/**
 * The five `notify_*` flags, one row, mirroring the PWA's table.
 *
 * No Kotlin defaults. What is on before anybody has chosen is a product
 * decision that both clients have to share, so it comes from
 * `core/alerts/sweep.js` via the engine's `defaults()` — see
 * [AlertRepository.settings]. Writing the five booleans down again here is
 * exactly how the two clients would come to disagree about whether buyback
 * alerts start on.
 */
@Entity(tableName = "notification_settings")
data class NotificationSettingsRow(
    @PrimaryKey val id: Int,
    val notifyEarningsFilings: Boolean,
    val notifyRedFlags: Boolean,
    val notifyMarginOfSafety: Boolean,
    val notifyCapitalReturns: Boolean,
    val notifySundayDigest: Boolean
) {
    companion object {
        /** There is one row, and this is it. The PWA constrains it in SQL. */
        const val ID = 1
    }
}

/**
 * What has been delivered.
 *
 * Two jobs, and the second is the reason it is a table rather than a log: the
 * cooldown floor in `core/alerts/sweep.js` is enforced against this, so a
 * reinstall or a process restart cannot re-announce a standing condition.
 * The first job is the alert centre in Settings, matching the PWA's.
 *
 * `deliveredAt` is indexed. The cooldown lookup and the alert centre both scan
 * this table by it on every sweep, and — this is the reason the index has to
 * be declared here rather than only in the migration's raw SQL — Room derives
 * its *expected* schema from the annotations on this class alone. The index
 * was originally added only in `OmahaDatabaseFactory.MIGRATION_2_3`, which
 * created it on the real table without Room's compile-time model ever
 * learning it should exist. `onValidateSchema` compares the two and finds a
 * table with an index Room did not ask for — a mismatch it cannot tell apart
 * from actual drift — and refuses to open the database. That refusal was the
 * crash on first launch after phase 5 shipped.
 */
@Entity(tableName = "notification_history", indices = [Index("deliveredAt")])
data class NotificationRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** Empty rather than null for the digest, which is about a list, not a stock. */
    val ticker: String,
    val alertType: String,
    val title: String,
    val body: String,
    val severity: String,
    val url: String,
    val read: Boolean = false,
    val deliveredAt: String
)

@Dao
interface AlertsDao {

    // ------------------------------------------------------------ snapshots

    @Query("SELECT * FROM stock_snapshots WHERE ticker = :ticker")
    suspend fun snapshot(ticker: String): SnapshotRow?

    /** A whole watchlist's worth in one query, for the widget's movers list — the digest reads one ticker at a time because it walks a single default list; a widget may be bound to any list. */
    @Query("SELECT * FROM stock_snapshots WHERE ticker IN (:tickers)")
    suspend fun snapshots(tickers: List<String>): List<SnapshotRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSnapshot(row: SnapshotRow)

    @Query("SELECT MAX(capturedAt) FROM stock_snapshots")
    suspend fun lastSweepAt(): String?

    // ------------------------------------------------------------- settings

    @Query("SELECT * FROM notification_settings WHERE id = :id")
    suspend fun settings(id: Int = NotificationSettingsRow.ID): NotificationSettingsRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSettings(row: NotificationSettingsRow)

    // -------------------------------------------------------------- history

    /**
     * When this alert type last fired for this ticker.
     *
     * The window it is compared against is not here and must not be: cooldowns
     * are `core/alerts/sweep.js`'s table. SQL answers "when", the engine
     * answers "is that too soon".
     */
    @Query(
        "SELECT MAX(deliveredAt) FROM notification_history " +
            "WHERE alertType = :type AND ticker = :ticker"
    )
    suspend fun lastDeliveredAt(type: String, ticker: String): String?

    @Insert
    suspend fun record(row: NotificationRow): Long

    @Query("SELECT * FROM notification_history ORDER BY deliveredAt DESC LIMIT :limit")
    suspend fun history(limit: Int): List<NotificationRow>

    @Query("SELECT COUNT(*) FROM notification_history WHERE read = 0")
    suspend fun unreadCount(): Int

    @Query("UPDATE notification_history SET read = 1 WHERE read = 0")
    suspend fun markAllRead()

    /**
     * Keep the table bounded.
     *
     * Unbounded it would grow forever on a device nobody prunes, and the
     * cooldown queries scan it. The floor is generous relative to the longest
     * window (14 days), so trimming can never resurrect a suppressed alert.
     */
    @Query(
        "DELETE FROM notification_history WHERE id NOT IN " +
            "(SELECT id FROM notification_history ORDER BY deliveredAt DESC LIMIT :keep)"
    )
    suspend fun trimTo(keep: Int)
}
