package com.zandaulion.omaha.data

import com.zandaulion.omaha.engine.HttpBridge
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WatchlistScopeTest {
    private fun list(id: String, tickers: String, name: String = id) =
        WatchlistRow(id, name, tickers, updatedAt = "2026-01-01T00:00:00Z")

    private val lists = listOf(
        list("first", "[\"AAA\",\"BBB\"]", "Sample list"),
        list("second", "[\"BBB\",\"CCC\"]"),
        list("empty", "[]")
    )

    @Test
    fun `manual checks use selected membership while background checks use the union`() {
        assertEquals(listOf("AAA", "BBB"), watchedTickers(lists, "first"))
        assertEquals(listOf("BBB", "CCC"), watchedTickers(lists, "second"))
        assertEquals(listOf("AAA", "BBB", "CCC"), watchedTickers(lists))
    }

    @Test
    fun `empty or deleted selected lists never fall back to other lists`() {
        assertEquals(emptyList(), watchedTickers(lists, "empty"))
        assertEquals(emptyList(), watchedTickers(lists, "deleted"))
    }

    @Test
    fun `filters exclude cached research and other lists and reflect removals`() = runBlocking {
        val dao = MemoryPersonalData(lists)
        val repository = repository(dao)
        assertEquals(listOf("AAA", "BBB"), repository.filterUniverse("first").map { it.ticker })
        assertEquals(listOf("BBB", "CCC"), repository.filterUniverse("second").map { it.ticker })
        dao.upsertWatchlists(listOf(list("first", "[\"AAA\"]")))
        assertEquals(listOf("AAA"), repository.filterUniverse("first").map { it.ticker })
        assertEquals(emptyList(), repository.filterUniverse("empty"))
        assertEquals(emptyList(), repository.filterUniverse("deleted"))
    }

    @Test
    fun `duplicate names are rejected without changing stored lists`() = runBlocking {
        val dao = MemoryPersonalData(lists)
        val repository = repository(dao)
        assertFailsWith<DuplicateWatchlistNameException> { repository.createWatchlist("  SAMPLE LIST  ") }
        assertEquals(lists, dao.watchlists())
        val id = repository.createWatchlist("New sample")
        assertEquals("New sample", dao.watchlists().first { it.id == id }.name)
    }

    private fun repository(dao: PersonalDataDao): WatchlistRepository {
        val cache = MemoryCache(listOf("AAA", "BBB", "CCC", "DDD"))
        val engine = StockEngine.fromSource("", HttpBridge { error("No network expected") }, RoomStockStore(cache))
        return WatchlistRepository(dao, engine, cache)
    }
}

private class MemoryPersonalData(initial: List<WatchlistRow>) : PersonalDataDao {
    private val lists = initial.toMutableList()
    override suspend fun watchlists() = lists.toList()
    override suspend fun theses() = emptyList<ThesisRow>()
    override suspend fun upsertTheses(rows: List<ThesisRow>) = Unit
    override suspend fun upsertWatchlists(rows: List<WatchlistRow>) {
        rows.forEach { row -> lists.removeAll { it.id == row.id }; lists.add(row) }
    }
    override suspend fun deleteWatchlist(id: String) { lists.removeAll { it.id == id } }
    override suspend fun clearTheses() = Unit
    override suspend fun clearWatchlists() { lists.clear() }
}

private class MemoryCache(tickers: List<String>) : StockCacheDao {
    private val rows = tickers.map {
        StockCacheRow(it, "Sample $it", null, 70, "{}", null, "2026-01-01T00:00:00Z", null)
    }
    override suspend fun find(ticker: String) = rows.firstOrNull { it.ticker == ticker }
    override suspend fun upsert(row: StockCacheRow) = Unit
    override suspend fun search(exact: String, prefix: String, anywhere: String) = emptyList<StockSummaryRow>()
    override suspend fun sectorFinancials(sector: String, excludeTicker: String) = emptyList<String>()
    override suspend fun allScored() = emptyList<StockSummaryRow>()
    override suspend fun allScoredRecords() = rows
    override suspend fun clear() = Unit
}
