package com.zandaulion.omaha.data

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * The scored-stock cache.
 *
 * The scored record is stored **as JSON, verbatim**, and Kotlin does not parse
 * it. Only the handful of fields something actually queries on are lifted into
 * columns. That is deliberate: the record's shape is decided by
 * `core/model/record.js`, and a Kotlin mirror of its twenty-odd fields would be
 * a second definition that silently loses a field the first time one is added.
 *
 * The PWA stores the same thing across twenty-odd SQLite columns, which is
 * fine there because the same file writes and reads them. Here the writer is
 * JavaScript and the reader is JavaScript; Kotlin is only the filing cabinet.
 */
@Entity(tableName = "stock_cache")
data class StockCacheRow(
    @PrimaryKey val ticker: String,
    val name: String,
    val sector: String?,
    @ColumnInfo(name = "health_score") val healthScore: Int?,
    /** The record as `core/` produced it. Opaque here. */
    @ColumnInfo(name = "record_json") val recordJson: String,
    /** Lifted out only so the sector-median query does not parse every record. */
    @ColumnInfo(name = "financials_json") val financialsJson: String?,
    /** ISO-8601. Read by `core/time.js`, which is why it is not SQLite's format. */
    @ColumnInfo(name = "last_fetched_at") val lastFetchedAt: String,
    @ColumnInfo(name = "financials_fetched_at") val financialsFetchedAt: String?
)

/** A cheap projection, for the parts of the app that only list things. */
data class StockSummaryRow(
    val ticker: String,
    val name: String,
    val sector: String?,
    @ColumnInfo(name = "health_score") val healthScore: Int?
)

@Dao
interface StockCacheDao {
    @Query("SELECT * FROM stock_cache WHERE ticker = :ticker")
    suspend fun find(ticker: String): StockCacheRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: StockCacheRow)

    /**
     * Exact symbol first, then prefix, then anything containing it — the same
     * ordering the PWA's query uses, so the two clients rank a search the same
     * way.
     */
    @Query(
        """
        SELECT ticker, name, sector, health_score FROM stock_cache
        WHERE ticker LIKE :prefix OR UPPER(name) LIKE :anywhere
        ORDER BY CASE WHEN ticker = :exact THEN 0 WHEN ticker LIKE :prefix THEN 1 ELSE 2 END,
                 health_score DESC
        LIMIT 10
        """
    )
    suspend fun search(exact: String, prefix: String, anywhere: String): List<StockSummaryRow>

    @Query(
        "SELECT financials_json FROM stock_cache " +
            "WHERE sector = :sector AND ticker != :excludeTicker AND financials_json IS NOT NULL"
    )
    suspend fun sectorFinancials(sector: String, excludeTicker: String): List<String>

    @Query("DELETE FROM stock_cache")
    suspend fun clear()
}
