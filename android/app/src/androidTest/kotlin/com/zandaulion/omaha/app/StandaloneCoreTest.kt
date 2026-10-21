package com.zandaulion.omaha.app

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.zandaulion.omaha.app.ui.OmahaEngine
import com.zandaulion.omaha.data.SignInOutcome
import com.zandaulion.omaha.data.StockCacheRow
import com.zandaulion.omaha.data.WatchlistRow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.Instant

/** Run only on a separately installed validation app, with synthetic records. */
class StandaloneCoreTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val device by lazy { UiDevice.getInstance(instrumentation) }

    @Before
    fun requireIsolatedEdition() {
        check(!BuildConfig.CLOUD_AI_ENABLED && BuildConfig.DEBUG)
        check(context.packageName.endsWith(".standalone.releasecheck")) {
            "Refusing to seed records into a regular application installation."
        }
    }

    @Test
    fun cloudServicesAreAbsentAndCannotSignInOrSellCredits() = runBlocking {
        for (name in listOf(
            "com.google.firebase.FirebaseApp",
            "com.android.billingclient.api.BillingClient",
            "androidx.credentials.CredentialManager"
        )) {
            assertThrows(ClassNotFoundException::class.java) { Class.forName(name) }
        }
        val handles = OmahaEngine.get(context)
        assertNull(handles.auth.currentUser())
        assertTrue(handles.auth.signIn() is SignInOutcome.Failed)
        assertNull(handles.billing.product())
        assertTrue(handles.billing.unsettledPurchases().isEmpty())
        assertNull(handles.relay.getCachedSummary("AAPL"))
    }

    @Test
    fun deniedNotificationsRemainAnInAppFeature() {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 33)
        val notifier = com.zandaulion.omaha.app.alerts.AlertNotifier(context)
        check(!notifier.permitted()) { "Use a validation installation without notification permission." }
        notifier.ensureChannels()
        notifier.show(com.zandaulion.omaha.data.Alert(
            type = "HEALTH_SHIFT", ticker = "TEST", title = "Synthetic test alert",
            body = "Synthetic validation only.", severity = "info", url = "/stock/TEST"
        ))
        assertTrue(context.getSystemService(android.app.NotificationManager::class.java)
            .activeNotifications.isEmpty())
    }

    @Test
    fun localResearchAndBackupWorkWithoutCloudControls() {
        runBlocking {
            val handles = OmahaEngine.get(context)
            handles.store.personalData.upsertWatchlists(listOf(WatchlistRow(
                id = "standalone-smoke", name = "Synthetic test watchlist",
                tickersJson = "[\"AAPL\"]", isDefault = true,
                updatedAt = Instant.now().toString()
            )))
            handles.store.stockCache.upsert(cachedApple())
            handles.theses.save(handles.theses.load("AAPL").copy(
                coreRationale = "Synthetic validation note: revisit the recorded evidence."
            ))
            val backup = handles.backup.export()
            assertTrue(backup.contains("Synthetic validation note"))
            assertTrue(handles.backup.import(backup).theses >= 1)
            assertTrue(handles.theses.load("AAPL").coreRationale.startsWith("Synthetic validation"))
        }
        ActivityScenario.launch(MainActivity::class.java).use {
            waitText("Synthetic test watchlist")
            tapText("AAPL")
            waitText("← Back")
            tapText("Research section")
            check(device.wait(Until.hasObject(By.textEndsWith("Historical trends")), 10_000)) {
                "Research section menu did not open"
            }
            assertFalse(device.hasObject(By.textContains("AI analysis")))
            val checklist = device.wait(Until.findObject(By.textEndsWith("12-point checklist")), 10_000)
                ?: error("Checklist destination missing")
            checklist.click()
            waitText("Research section")
            val settings = device.wait(Until.findObject(By.desc("Settings")), 10_000)
                ?: error("Settings action missing")
            settings.click()
            waitText("Pocket Omaha Core")
            assertFalse(device.hasObject(By.text("🔒 AI analysis & your notes")))
            assertFalse(device.hasObject(By.textContains("Sign in")))
            assertFalse(device.hasObject(By.textContains("Buy credits")))
        }
    }

    private fun waitText(text: String) {
        check(device.wait(Until.hasObject(By.text(text)), 15_000)) { "Missing UI text: $text" }
    }

    private fun tapText(text: String) {
        device.waitForIdle(1_000)
        val node = device.wait(Until.findObject(By.text(text)), 15_000)
            ?: error("Missing action: $text")
        node.click()
    }

    private fun cachedApple(): StockCacheRow {
        val model = instrumentation.context.assets.open("AAPL.model.json")
            .bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonObject }
        val financials = model.getValue("financials").toString()
        val record = buildJsonObject {
            listOf("ticker", "name", "sector", "industry", "price", "change_pct", "currency",
                "market_cap", "health_score", "altman_z", "piotroski_score", "roic_pct",
                "fcf_conversion_pct", "net_cash_b").forEach { key -> model[key]?.let { put(key, it) } }
            put("financials_json", JsonPrimitive(financials))
            for (key in listOf("checklist", "catalysts", "risks", "pillars", "summary")) {
                put("${key}_json", JsonPrimitive(model.getValue(key).toString()))
            }
            put("statements_json", JsonPrimitive("{}"))
        }
        val fresh = Instant.now().toString()
        return StockCacheRow(
            ticker = "AAPL", name = model.getValue("name").jsonPrimitive.content,
            sector = "Technology", healthScore = 64, recordJson = record.toString(),
            financialsJson = financials, lastFetchedAt = fresh, financialsFetchedAt = fresh
        )
    }
}
