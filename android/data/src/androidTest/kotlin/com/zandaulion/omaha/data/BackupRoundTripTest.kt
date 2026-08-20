package com.zandaulion.omaha.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import com.zandaulion.omaha.engine.BackupEngine
import com.zandaulion.omaha.engine.JsBridgeException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * A backup written by the PWA, imported into Android and exported again.
 *
 * This is the exit criterion for step 3 of doc 13, stated in a form that fails
 * if it stops being true. The fixture is not hand-written: it was produced by
 * the PWA's own export path, so what is being read here is what the other
 * client actually emits.
 *
 * Everything about *meaning* — which version wins, which entries merge — comes
 * from `core/backup.js` running in QuickJS. Room and this test only move rows.
 */
class BackupRoundTripTest {

    private lateinit var db: OmahaDatabase
    private lateinit var store: PersonalDataStore

    private val context get() = InstrumentationRegistry.getInstrumentation().context

    private fun engine() = BackupEngine.fromSource(
        context.assets.open("core/${BackupEngine.BUNDLE_PATH}")
            .bufferedReader().use { it.readText() }
    )

    private fun pwaBackup(): String =
        context.assets.open("backup.pwa.json").bufferedReader().use { it.readText() }

    private val now = "2026-08-20T12:00:00.000Z"

    @BeforeTest
    fun open() {
        db = Room.inMemoryDatabaseBuilder(
            InstrumentationRegistry.getInstrumentation().targetContext,
            OmahaDatabase::class.java
        ).build()
        store = PersonalDataStore(db.personalData())
    }

    @AfterTest
    fun close() = db.close()

    /** Import a file into whatever is currently stored. */
    private suspend fun import(file: String) {
        store.write(engine().merge(file, store.read()), now)
    }

    @Test
    fun aBackupFromThePwaImportsAndExportsUnchanged() = runTest {
        val file = pwaBackup()
        import(file)

        val reExported = engine().build(store.read(), now)

        val original = Json.parseToJsonElement(file).jsonObject
        val round = Json.parseToJsonElement(reExported).jsonObject

        assertEquals(
            original["theses"].toString(),
            round["theses"].toString(),
            "every thesis, tag, trigger and journal entry must survive the trip"
        )
        assertEquals(original["watchlists"].toString(), round["watchlists"].toString())
    }

    @Test
    fun emojiInAJournalNoteSurvive() = runTest {
        // The PWA fixture carries a rocket and a warning sign, because that is
        // what people put in notes and because the QuickJS binding truncates a
        // character per surrogate pair unless the bridge stays ASCII.
        import(pwaBackup())

        // Theses export in ticker order, so NOK is not first. Selected by
        // ticker rather than position, which is what the earlier version of
        // this test got wrong the moment the order became canonical.
        val notes = Json.parseToJsonElement(store.read()).jsonObject["theses"]!!
            .jsonArray.first { it.jsonObject["ticker"].toString().contains("NOK") }
            .jsonObject["journalEntries"]!!.jsonArray
            .joinToString { it.jsonObject["note"].toString() }

        assertTrue(notes.contains(String(Character.toChars(0x1F680))), "rocket lost: $notes")
        assertTrue(notes.contains(String(Character.toChars(0x26A0))), "warning sign lost: $notes")
    }

    @Test
    fun importingTheSameFileTwiceChangesNothing() = runTest {
        import(pwaBackup())
        val afterFirst = store.read()

        import(pwaBackup())

        assertEquals(afterFirst, store.read(), "a repeated restore must be a no-op")
    }

    @Test
    fun aNoteWrittenHereSurvivesAnImportThatRewritesTheThesis() = runTest {
        import(pwaBackup())

        // Someone writes a note on this device, later than the file.
        db.personalData().upsertTheses(
            listOf(
                db.personalData().theses().first { it.ticker == "NOK" }.copy(
                    journalEntriesJson = """[{"id":"local-1","date":"2026-09-01T00:00:00.000Z","note":"written on the phone"}]""",
                    updatedAt = "2026-09-01T00:00:00.000Z"
                )
            )
        )

        // Re-importing the older file must not discard it.
        import(pwaBackup())

        val notes = Json.parseToJsonElement(store.read()).jsonObject["theses"]!!
            .jsonArray.first { it.jsonObject["ticker"].toString().contains("NOK") }
            .jsonObject["journalEntries"]!!.jsonArray
            .map { it.jsonObject["note"].toString() }

        assertEquals(3, notes.size, "expected both imported notes and the local one: $notes")
        assertTrue(notes.any { it.contains("written on the phone") }, "the local note was lost")
    }

    @Test
    fun aFileFromANewerSchemaIsRefusedAndNothingIsWritten() = runTest {
        import(pwaBackup())
        val before = store.read()

        assertFailsWith<JsBridgeException> {
            import("""{"schemaVersion":99,"theses":[],"watchlists":[]}""")
        }

        assertEquals(before, store.read(), "the database must be untouched")
    }
}
