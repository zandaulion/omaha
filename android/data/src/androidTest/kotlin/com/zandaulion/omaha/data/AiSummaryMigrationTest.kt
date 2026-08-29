package com.zandaulion.omaha.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `MIGRATION_3_4` against a database shaped like a real device's, on the
 * same reasoning [AlertMigrationTest] documents: `inMemoryDatabaseBuilder`
 * always builds the *current* schema straight from the entities and never
 * runs a `Migration` at all, which is exactly why `MIGRATION_2_3`'s defect
 * reached a real phone before it reached a test.
 */
class AiSummaryMigrationTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val dbName = "ai-summary-migration-test.db"

    @AfterTest
    fun cleanUp() {
        context.deleteDatabase(dbName)
    }

    /** Schema version 3 — every table through the alert sweep, seeded the same way [AlertMigrationTest] seeds version 2. */
    private fun seedVersion3Database() {
        val db = context.openOrCreateDatabase(dbName, 0, null)
        db.use {
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `theses` (`ticker` TEXT NOT NULL, " +
                    "`conviction` TEXT NOT NULL, `targetBuyPrice` REAL, " +
                    "`coreRationale` TEXT NOT NULL, `moatTagsJson` TEXT NOT NULL, " +
                    "`sellTriggersJson` TEXT NOT NULL, `journalEntriesJson` TEXT NOT NULL, " +
                    "`updatedAt` TEXT NOT NULL, PRIMARY KEY(`ticker`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `watchlists` (`id` TEXT NOT NULL, " +
                    "`name` TEXT NOT NULL, `tickersJson` TEXT NOT NULL, " +
                    "`isDefault` INTEGER NOT NULL, `updatedAt` TEXT NOT NULL, " +
                    "PRIMARY KEY(`id`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `stock_cache` (`ticker` TEXT NOT NULL, " +
                    "`name` TEXT NOT NULL, `sector` TEXT, `health_score` INTEGER, " +
                    "`record_json` TEXT NOT NULL, `financials_json` TEXT, " +
                    "`last_fetched_at` TEXT NOT NULL, `financials_fetched_at` TEXT, " +
                    "PRIMARY KEY(`ticker`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `app_settings` (`key` TEXT NOT NULL, " +
                    "`value` TEXT NOT NULL, PRIMARY KEY(`key`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `stock_snapshots` (" +
                    "`ticker` TEXT NOT NULL, `snapshotJson` TEXT NOT NULL, " +
                    "`healthScore` INTEGER, `baselineScore` INTEGER, " +
                    "`capturedAt` TEXT NOT NULL, PRIMARY KEY(`ticker`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `notification_settings` (" +
                    "`id` INTEGER NOT NULL, " +
                    "`notifyEarningsFilings` INTEGER NOT NULL, " +
                    "`notifyRedFlags` INTEGER NOT NULL, " +
                    "`notifyMarginOfSafety` INTEGER NOT NULL, " +
                    "`notifyCapitalReturns` INTEGER NOT NULL, " +
                    "`notifySundayDigest` INTEGER NOT NULL, " +
                    "PRIMARY KEY(`id`))"
            )
            it.execSQL(
                "CREATE TABLE IF NOT EXISTS `notification_history` (" +
                    "`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, " +
                    "`ticker` TEXT NOT NULL, `alertType` TEXT NOT NULL, " +
                    "`title` TEXT NOT NULL, `body` TEXT NOT NULL, " +
                    "`severity` TEXT NOT NULL, `url` TEXT NOT NULL, " +
                    "`read` INTEGER NOT NULL, `deliveredAt` TEXT NOT NULL)"
            )
            it.execSQL(
                "CREATE INDEX IF NOT EXISTS `index_notification_history_deliveredAt` " +
                    "ON `notification_history` (`deliveredAt`)"
            )
            it.version = 3
        }
    }

    @Test
    fun theMigrationOpensOnARealisticVersion3Database() = runTest {
        seedVersion3Database()

        val db = Room.databaseBuilder(context, OmahaDatabase::class.java, dbName)
            .addMigrations(
                OmahaDatabaseFactory.MIGRATION_1_2,
                OmahaDatabaseFactory.MIGRATION_2_3,
                OmahaDatabaseFactory.MIGRATION_3_4
            )
            .build()

        try {
            db.aiSummaries().upsert(AiSummaryRow("AAPL", "{}", "2026-08-29T00:00:00Z"))
            assertEquals("AAPL", db.aiSummaries().find("AAPL")?.ticker, "the migrated table is not just present but usable")
        } finally {
            db.close()
        }
    }
}
