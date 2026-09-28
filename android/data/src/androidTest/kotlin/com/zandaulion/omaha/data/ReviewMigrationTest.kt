package com.zandaulion.omaha.data

import androidx.test.platform.app.InstrumentationRegistry
import com.zandaulion.omaha.engine.ReplayHttpBridge
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReviewMigrationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "review-migration-test.db"

    @AfterTest fun cleanUp() { context.deleteDatabase(name) }

    @Test fun migrationPreservesReasonsAndHistoryAndStaleEditsPreserveReviews() = runTest {
        // All tables except theses are unchanged in v5. Build them normally,
        // then replace the personal table with the exact v4 schema and a note.
        OmahaDatabaseFactory.open(context, name).let { store ->
            store.personalData.watchlists()
            store.close()
        }
        context.openOrCreateDatabase(name, 0, null).use { db ->
            db.execSQL("DROP TABLE theses")
            db.execSQL("CREATE TABLE theses (ticker TEXT NOT NULL PRIMARY KEY, conviction TEXT NOT NULL, " +
                "targetBuyPrice REAL, coreRationale TEXT NOT NULL, moatTagsJson TEXT NOT NULL, " +
                "sellTriggersJson TEXT NOT NULL, journalEntriesJson TEXT NOT NULL, updatedAt TEXT NOT NULL)")
            db.execSQL("INSERT INTO theses VALUES (?, ?, ?, ?, ?, ?, ?, ?)", arrayOf(
                "ABC", "high", null, "My original reason", "[]", "[]",
                """[{"id":"old","date":"2026-01-01T00:00:00Z","note":"Original note"}]""", "2026-01-01T00:00:00Z"))
            db.execSQL("DROP TABLE room_master_table")
            db.version = 4
        }
        val store = OmahaDatabaseFactory.open(context, name)
        try {
            val repo = ThesisRepository(store.personalData)
            val legacy = repo.load("ABC")
            assertEquals("My original reason", legacy.coreRationale)
            assertEquals("", legacy.mustRemainTrue)
            assertEquals("Original note", legacy.journalEntries.single().note)
            assertTrue(repo.load("NEW").sellTriggers.isEmpty())
            store.personalData.upsertWatchlists(listOf(WatchlistRow("review", "Review", "[\"ABC\"]", true, isoNow())))
            val http = ReplayHttpBridge("{}")
            val alertEngine = AlertEngine.fromSource(
                InstrumentationRegistry.getInstrumentation().context.assets.open("core/${AlertEngine.BUNDLE_PATH}")
                    .bufferedReader().use { it.readText() },
                http, RoomStockStore(store.stockCache), RoomAlertStore(store.alerts)
            )
            val reviews = ReviewRepository(store.personalData, store.stockCache, store.alerts, alertEngine)
            val first = reviews.summaries("review")
            assertEquals("unreviewed", first.items.single().status, "an ordinary legacy note is not a completed review")
            assertEquals(null, first.lastCheckedAt)
            val form = repo.save(legacy.copy(mustRemainTrue = "Customers renew.",
                sellTriggers = listOf(SellTrigger("retention", "Customers leave", true))))
            repo.recordReview("ABC", "watch", "Investigate churn.")
            val updated = repo.save(form.copy(coreRationale = "My revised reason"))
            assertEquals(2, updated.journalEntries.size, "a legacy note must not duplicate when its default metadata is encoded")
            assertEquals("watch", updated.journalEntries.single { it.kind == "review" }.assessment)
            assertEquals("Customers renew.", updated.mustRemainTrue)
            assertEquals(true, updated.sellTriggers.single().triggered)
            val after = reviews.summaries("review").items.single()
            assertEquals("reviewed", after.status)
            assertEquals("watch", after.assessment)
            assertTrue(after.reason.contains("manually flagged"))
            assertEquals(emptyList(), http.requested, "loading reviews must not fetch upstream data")
            val exported = PersonalDataStore(store.personalData).read()
            assertTrue(exported.contains("Customers renew."))
            assertTrue(exported.contains("Investigate churn."))
        } finally { store.close() }
    }
}
