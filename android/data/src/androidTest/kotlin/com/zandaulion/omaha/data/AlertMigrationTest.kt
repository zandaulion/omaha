package com.zandaulion.omaha.data

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `MIGRATION_2_3` against a database shaped like a real device's, not an
 * empty one.
 *
 * Every other Room test in this module builds its database with
 * `inMemoryDatabaseBuilder`, which always creates the **current** schema
 * directly from the entity annotations and never touches a `Migration` at
 * all. That is why the bug this test pins reached a real phone rather than
 * CI: `MIGRATION_2_3`'s raw SQL created an index on `notification_history`
 * that `NotificationRow` never declared, so Room's compile-time schema and
 * the migrated table disagreed, and `onValidateSchema` refused to open the
 * database — on first launch, for every install upgrading from schema
 * version 2.
 *
 * This builds a **version 2** database by hand — the schema before phase 5,
 * captured from Room's own generated `createAllTables` for those four tables
 * so it cannot silently drift from what the entities actually specify — then
 * opens it through `OmahaDatabaseFactory`'s real migration path, the same way
 * `Room.databaseBuilder` does on a device. A DAO call is required, not
 * optional: Room's actual SQLite open (and therefore its schema validation)
 * is lazy, deferred to the first query, so `.build()` alone would pass even
 * with the exact defect this test exists to catch.
 */
class AlertMigrationTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val dbName = "migration-test.db"

    @AfterTest
    fun cleanUp() {
        context.deleteDatabase(dbName)
    }

    /**
     * Schema version 2, exactly as `OmahaDatabase_Impl.createAllTables` emits
     * it for these four tables today. If an entity changes, `:data:compile`
     * regenerates that source and this copy has to be updated to match —
     * which is a feature: a silent divergence here would validate the wrong
     * starting point.
     */
    private fun seedVersion2Database() {
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
            it.version = 2
        }
    }

    @Test
    fun theMigrationOpensOnARealisticVersion2Database() = runTest {
        seedVersion2Database()

        val db = Room.databaseBuilder(context, OmahaDatabase::class.java, dbName)
            .addMigrations(OmahaDatabaseFactory.MIGRATION_1_2, OmahaDatabaseFactory.MIGRATION_2_3)
            .build()

        try {
            // Forces the actual open. Room defers SQLite access — including
            // running migrations and validating the result — to the first
            // query, so `.build()` alone proves nothing here.
            val row = NotificationRow(
                ticker = "NOK", alertType = "RED_FLAG_WARNING", title = "t", body = "b",
                severity = "critical", url = "", deliveredAt = "2026-08-27T00:00:00Z"
            )
            db.alerts().record(row)

            assertEquals(1, db.alerts().history(10).size, "the migrated table is not just present but usable")
        } finally {
            db.close()
        }
    }
}
