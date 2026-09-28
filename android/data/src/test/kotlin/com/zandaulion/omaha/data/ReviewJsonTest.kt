package com.zandaulion.omaha.data

import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails

class ReviewJsonTest {
    @Test fun legacyNotesAndNewReviewMetadataDecodeWithoutGeneratedSerializers() {
        val old = parseJournalEntries("""[{"id":"old","date":"2026-01-01T00:00:00Z","note":"Original note"}]""").single()
        assertEquals("Original note", old.note)
        assertEquals("note", old.kind)
        assertEquals(null, old.assessment)
        val review = JournalEntry("new", "2026-09-27T12:00:00Z", "Investigate churn. ⚠️", "review", "watch")
        val encoded = JsonArray(listOf(old.toJson(), review.toJson())).toString()
        assertEquals(listOf(old, review), parseJournalEntries(encoded))
    }

    @Test fun malformedJournalIsAnErrorRatherThanAnEmptyHistory() {
        assertFails { parseJournalEntries("not JSON") }
    }

    @Test fun reviewQueueResponseRetainsAssessmentNullsAndChanges() {
        val rows = parseCompanyReviews("""[
          {"ticker":"ABC","name":"Example","status":"changed","label":"Recorded changes",
           "reason":"A change","lastReviewedAt":"2026-09-01T00:00:00Z","assessment":"watch",
           "changeCount":1,"hasThesis":true,"changes":[{"title":"Filing","body":"Read it","severity":"info","at":"2026-09-02T00:00:00Z"}]},
          {"ticker":"NEW","name":"New","status":"setup","label":"Add your reasons",
           "reason":"Start here","lastReviewedAt":null,"assessment":null,"changeCount":0,"hasThesis":false,"changes":[]}
        ]""")
        assertEquals("watch", rows[0].assessment)
        assertEquals("Filing", rows[0].changes.single().title)
        assertEquals(null, rows[1].assessment)
        assertEquals(null, rows[1].lastReviewedAt)
        assertEquals(false, rows[1].hasThesis)
    }
}
