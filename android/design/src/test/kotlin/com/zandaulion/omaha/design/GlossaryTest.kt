package com.zandaulion.omaha.design

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Lighter than core/glossary.test.js on purpose: that file's job — catching
 * an entry describing a metric the app no longer computes, or a scored item
 * with no entry — is already enforced once, in JS, by `npm test`. This only
 * has to confirm the generated data survived the trip and explain()'s
 * two-step lookup behaves.
 */
class GlossaryTest {

    @Test
    fun `a real key resolves`() {
        val entry = Glossary.explain("health-score")
        assertNotNull(entry)
        assertEquals("Health score", entry.title)
    }

    @Test
    fun `an alias resolves to the same entry as its target key`() {
        val viaAlias = Glossary.explain("ROIC")
        val viaKey = Glossary.explain("Return on invested capital")
        assertNotNull(viaAlias)
        assertEquals(viaKey, viaAlias)
    }

    @Test
    fun `an unknown key returns null rather than throwing`() {
        assertNull(Glossary.explain("no-such-metric"))
        assertNull(Glossary.explain(null))
    }
}
