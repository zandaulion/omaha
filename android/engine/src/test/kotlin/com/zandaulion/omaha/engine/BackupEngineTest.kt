package com.zandaulion.omaha.engine

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The merge rules, executed through QuickJS from the same `core/backup.js` the
 * PWA runs.
 *
 * These deliberately restate assertions that `core/backup.test.js` already
 * makes. That is the point: if the rules ever behave differently here than in
 * Node, the two clients have started disagreeing about somebody's data, and
 * that has to fail loudly rather than quietly.
 */
class BackupEngineTest {

    private val coreDir = File("../../core").canonicalFile
    private fun engine() = BackupEngine.create(coreDir)

    private fun thesis(ticker: String, updatedAt: String, rationale: String, notes: String) =
        """{"ticker":"$ticker","conviction":"high","targetBuyPrice":4.5,
            "coreRationale":"$rationale","moatTags":[],"sellTriggers":[],
            "journalEntries":[$notes],"updatedAt":"$updatedAt"}"""

    private fun note(id: String, date: String, text: String) =
        """{"id":"$id","date":"$date","note":"$text"}"""

    private fun backup(vararg theses: String) =
        """{"schemaVersion":1,"exportedAt":"2026-08-20T12:00:00.000Z",
            "theses":[${theses.joinToString(",")}],"watchlists":[]}"""

    @Test
    fun `builds an export carrying the schema version`() = runTest {
        val out = engine().build(
            """{"theses":[],"watchlists":[]}""",
            "2026-08-20T12:00:00.000Z"
        )
        assertTrue(out.contains("\"schemaVersion\":1"), "got: $out")
        assertTrue(out.contains("2026-08-20T12:00:00.000Z"), "got: $out")
    }

    @Test
    fun `a journal note survives even when its thesis loses`() = runTest {
        // The rule the whole module exists for, checked on this engine too.
        val local = backup(
            thesis("NOK", "2026-06-01T00:00:00Z", "rewritten here",
                note("1", "2026-05-01T00:00:00Z", "local note"))
        )
        val incoming = backup(
            thesis("NOK", "2026-01-01T00:00:00Z", "older",
                note("2", "2026-01-01T00:00:00Z", "imported note"))
        )

        val merged = engine().merge(incoming, local)

        assertTrue(merged.contains("rewritten here"), "the newer body should win")
        assertTrue(merged.contains("local note"), "local note lost")
        assertTrue(merged.contains("imported note"), "imported note lost")
    }

    @Test
    fun `a repeated import reports nothing added`() = runTest {
        val file = backup(
            thesis("NOK", "2026-03-01T00:00:00Z", "same",
                note("1", "2026-03-01T00:00:00Z", "a note"))
        )
        val merged = engine().merge(file, file)
        assertTrue(
            merged.contains("\"journalEntriesAdded\":0"),
            "expected an idempotent re-import; got: ${merged.take(400)}"
        )
    }

    @Test
    fun `emoji in a note survive the bridge intact`() = runTest {
        // The binding truncates one character per surrogate pair unless the
        // bridge keeps to ASCII, and a journal note is exactly where someone
        // would put an emoji. The bridge therefore hands back escaped JSON:
        // the raw string holds the escape sequences and the characters return
        // when it is parsed, so the parsed value is what to assert on.
        //
        // Built from code points so this file stays pure ASCII and cannot
        // itself be mangled by whatever writes it.
        val rocket = String(Character.toChars(0x1F680))
        val gem = String(Character.toChars(0x1F48E))

        val withEmoji = backup(
            thesis("NOK", "2026-03-01T00:00:00Z", "held",
                note("1", "2026-03-01T00:00:00Z", "up 20% today $rocket$gem"))
        )

        val parsed = canonical(parseJson(engine().merge(withEmoji, backup())))

        assertTrue(
            parsed.contains(rocket) && parsed.contains(gem),
            "emoji did not survive the round trip: ${parsed.take(400)}"
        )
    }

    @Test
    fun `a newer schema version is refused with the message core wrote`() = runTest {
        val fromTheFuture = """{"schemaVersion":99,"theses":[],"watchlists":[]}"""
        val failure = assertFailsWith<JsBridgeException> {
            engine().merge(fromTheFuture, backup())
        }
        assertTrue(
            failure.message!!.contains("version 99"),
            "the original message should reach the caller; got: ${failure.message}"
        )
    }

    @Test
    fun `a file that is not a backup is refused`() = runTest {
        assertFailsWith<JsBridgeException> {
            engine().merge("""{"hello":"world"}""", backup())
        }
    }
}
