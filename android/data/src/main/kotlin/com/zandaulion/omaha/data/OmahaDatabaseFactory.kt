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

    fun open(context: Context, name: String = NAME): OmahaStore =
        OmahaStore(
            Room.databaseBuilder(context.applicationContext, OmahaDatabase::class.java, name)
                .addMigrations(MIGRATION_1_2)
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

    fun close() = db.close()
}
