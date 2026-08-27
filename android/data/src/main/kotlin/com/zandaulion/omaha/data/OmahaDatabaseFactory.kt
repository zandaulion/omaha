package com.zandaulion.omaha.data

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The one place the database is opened, so migrations cannot be forgotten at a
 * call site.
 *
 * There is no `fallbackToDestructiveMigration` here, and there must never be.
 * Two of these tables hold things a person wrote — theses, sell triggers,
 * journal entries — and there is no server copy to restore from. A destructive
 * rebuild would silently discard the only copy of the material this app exists
 * to protect. A failed migration should crash loudly instead; that is
 * recoverable, and losing someone's notes is not.
 */
object OmahaDatabaseFactory {

    const val NAME = "omaha.db"

    /**
     * 1 → 2: add `app_settings`.
     *
     * Additive, so nothing existing is touched. Written by hand rather than
     * left to Room because the alternative is a destructive fallback, and the
     * schema matches `server/db.js` exactly — same table name, same two TEXT
     * columns — since `core/backup.js` and the Settings view read both clients.
     */
    val MIGRATION_1_2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `app_settings` (" +
                    "`key` TEXT NOT NULL, `value` TEXT NOT NULL, PRIMARY KEY(`key`))"
            )
        }
    }

    /**
     * 2 → 3: the alert sweep's three tables.
     *
     * Additive again, so nothing existing is read or rewritten. Column names
     * are Room's camelCase rather than the PWA's snake_case, which is a
     * deliberate departure: none of these rows crosses between the clients.
     * `core/backup.js` carries theses and watchlists only, and alert history is
     * a record of what *this* device showed *this* person — restoring it onto
     * another device would claim notifications that were never delivered
     * there, and would carry its cooldowns along with them.
     *
     * `notification_settings` gets no SQL defaults on purpose. What is on
     * before anybody has chosen comes from `core/alerts/sweep.js`, so that both
     * clients answer it the same way; a DEFAULT clause here would be a second,
     * silent answer that only appears when a row is inserted without one.
     */
    val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `stock_snapshots` (" +
                    "`ticker` TEXT NOT NULL, `snapshotJson` TEXT NOT NULL, " +
                    "`healthScore` INTEGER, `baselineScore` INTEGER, " +
                    "`capturedAt` TEXT NOT NULL, " +
                    "PRIMARY KEY(`ticker`))"
            )
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `notification_settings` (" +
                    "`id` INTEGER NOT NULL, " +
                    "`notifyEarningsFilings` INTEGER NOT NULL, " +
                    "`notifyRedFlags` INTEGER NOT NULL, " +
                    "`notifyMarginOfSafety` INTEGER NOT NULL, " +
                    "`notifyCapitalReturns` INTEGER NOT NULL, " +
                    "`notifySundayDigest` INTEGER NOT NULL, " +
                    "PRIMARY KEY(`id`))"
            )
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS `notification_history` (" +
                    "`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`ticker` TEXT NOT NULL, `alertType` TEXT NOT NULL, " +
                    "`title` TEXT NOT NULL, `body` TEXT NOT NULL, " +
                    "`severity` TEXT NOT NULL, `url` TEXT NOT NULL, " +
                    "`read` INTEGER NOT NULL, `deliveredAt` TEXT NOT NULL)"
            )
            // The cooldown lookup filters on both, and the alert centre orders
            // by time. Without this every sweep table-scans the history once
            // per fired alert.
            db.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_notification_history_deliveredAt` " +
                    "ON `notification_history` (`deliveredAt`)"
            )
        }
    }

    fun open(context: Context, name: String = NAME): OmahaStore =
        OmahaStore(
            Room.databaseBuilder(context.applicationContext, OmahaDatabase::class.java, name)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
        )
}

/**
 * What a caller outside this module gets: the DAOs, and a way to close.
 *
 * `OmahaDatabase` extends `RoomDatabase`, so returning it directly would put
 * Room on the compile classpath of every consumer — and this module states in
 * its own header that what it exposes is a store, not a particular way of
 * storing. Room stays an implementation detail; a future move off it would not
 * touch a single call site above this line.
 */
class OmahaStore internal constructor(private val db: OmahaDatabase) {
    val personalData: PersonalDataDao get() = db.personalData()
    val stockCache: StockCacheDao get() = db.stockCache()
    val appSettings: AppSettingsDao get() = db.appSettings()
    val alerts: AlertsDao get() = db.alerts()

    fun close() = db.close()
}
