package com.zandaulion.omaha.data

import com.zandaulion.omaha.engine.JsBridgeException
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BackupRestoreMessageTest {
    @Test
    fun `invalid backups explain the required format without engine or parser details`() {
        for (detail in listOf("Expected a JSON object.", "Expected \"theses\" or \"watchlists\".", "unexpected token")) {
            val message = backupRestoreMessage(JsBridgeException("mergeBackup: $detail"))
            assertTrue(message.contains("Pocket Omaha JSON backup"))
            assertFalse(message.contains("mergeBackup"))
            assertFalse(message.contains(detail))
        }
    }

    @Test
    fun `newer backups retain actionable update guidance`() {
        val message = backupRestoreMessage(JsBridgeException(
            "mergeBackup: This backup is version 99; this build understands up to 2."
        ))
        assertTrue(message.contains("Update the app"))
        assertFalse(message.contains("mergeBackup"))
    }

    @Test
    fun `file access and unexpected failures never expose exception details`() {
        assertTrue(backupRestoreMessage(IOException("internal path")).contains("Could not read"))
        assertTrue(backupRestoreMessage(SecurityException("internal path")).contains("Could not read"))
        assertFalse(backupRestoreMessage(IllegalStateException("internal detail")).contains("internal detail"))
    }
}
