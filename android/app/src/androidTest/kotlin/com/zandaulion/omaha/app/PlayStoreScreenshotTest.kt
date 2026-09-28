package com.zandaulion.omaha.app

import android.content.Context
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import com.zandaulion.omaha.data.AppSettingRow
import com.zandaulion.omaha.data.AppSettings
import com.zandaulion.omaha.data.NotificationRow
import com.zandaulion.omaha.data.OmahaDatabaseFactory
import com.zandaulion.omaha.data.SnapshotRow
import com.zandaulion.omaha.data.StockCacheRow
import com.zandaulion.omaha.data.ThesisRow
import com.zandaulion.omaha.data.WatchlistRow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant

/**
 * Produces the six Play Store tablet screenshots from fixed, real scoring fixtures.
 *
 * The target device never reaches Yahoo, SEC EDGAR, Gemini, or the Omaha server.
 * Data is inserted before the activity starts, and fresh cache timestamps keep
 * the production repository on its normal cache-hit path. Screenshots go into
 * the app's scoped external-files directory, which the Test Lab command pulls
 * into the run artifacts even on modern Android storage implementations.
 */
@RunWith(AndroidJUnit4::class)
class PlayStoreScreenshotTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val targetContext: Context get() = instrumentation.targetContext
    private val device: UiDevice by lazy { UiDevice.getInstance(instrumentation) }
    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before
    fun seedAndLaunch() {
        targetContext.deleteDatabase(OmahaDatabaseFactory.NAME)
        runBlocking { seedScreenshotData() }
        device.setOrientationPortrait()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        // Android 16 may warn debuggable APKs when a packaged native library is
        // not 16 KB page aligned. It is system UI, so dismiss it if a future
        // dependency regresses and keep it out of the captured app screens.
        if (device.wait(Until.hasObject(By.text("Android App Compatibility")), 5_000)) {
            tapText("Don't Show Again")
        }
        waitForText("The Compounders")
        waitForText("Apple Inc.")
    }

    @After
    fun close() {
        if (::scenario.isInitialized) scenario.close()
        device.unfreezeRotation()
    }

    @Test
    fun capturePlayStoreTabletScreens() {
        capture("01-watchlist")

        tapDescription("Review")
        waitForText("Your company review")
        waitForText("Recorded changes")
        capture("02-review")

        tapDescription("Watchlist")
        // Apple Inc. is present on both Review and Watchlist. Waiting for the
        // watchlist-only heading prevents a fast device from tapping the old
        // Review card while Compose is replacing the screen.
        waitForText("Current watchlist")
        tapText("AAPL")
        waitForText("Financial strengths")
        capture("03-research-overview")

        tapText("12-Pt Checklist")
        waitForText("Altman Z-Score")
        capture("04-checklist")

        tapText("DCF Sandbox")
        waitForText("Estimated fair value")
        capture("05-dcf")

        tapDescription("Compare")
        waitForText("Side-by-Side Peer Comparison", substring = true)
        // Tablet navigation also has a visible "Compare" label. Pick the
        // rightmost match so this taps the in-page action instead of the rail.
        tapRightmostText("Compare")
        waitForText("Fundamental score")
        capture("06-compare")
    }

    private fun waitForText(text: String, substring: Boolean = false) {
        val selector = if (substring) By.textContains(text) else By.text(text)
        check(device.wait(Until.hasObject(selector), 30_000)) { "Timed out waiting for '$text'" }
        device.waitForIdle(1_000)
    }

    private fun tapText(text: String) {
        val selector = UiSelector().text(text)
        val node = device.findObject(selector)
        check(node.waitForExists(30_000)) { "Timed out waiting to tap '$text'" }
        val bounds = node.bounds
        check(device.click(bounds.centerX(), bounds.centerY())) { "Could not tap '$text'" }
        device.waitForIdle(1_000)
    }

    private fun tapRightmostText(text: String) {
        check(device.wait(Until.hasObject(By.text(text)), 30_000)) {
            "Timed out waiting to tap '$text'"
        }
        val node = device.findObjects(By.text(text)).maxByOrNull { it.visibleBounds.centerX() }
            ?: error("Could not find '$text'")
        val bounds = node.visibleBounds
        check(device.click(bounds.centerX(), bounds.centerY())) { "Could not tap '$text'" }
        device.waitForIdle(1_000)
    }

    private fun tapDescription(description: String) {
        val selector = UiSelector().description(description)
        val node = device.findObject(selector)
        check(node.waitForExists(30_000)) { "Timed out waiting to tap '$description'" }
        val bounds = node.bounds
        check(device.click(bounds.centerX(), bounds.centerY())) { "Could not tap '$description'" }
        device.waitForIdle(1_000)
    }

    private fun capture(name: String) {
        device.waitForIdle(1_000)
        val directory = File(targetContext.getExternalFilesDir(null), "screenshots")
        check(directory.exists() || directory.mkdirs()) { "Could not create $directory" }
        check(device.takeScreenshot(File(directory, "$name.png"))) {
            "Could not capture $name"
        }
    }

    private suspend fun seedScreenshotData() {
        val store = OmahaDatabaseFactory.open(targetContext)
        val now = Instant.parse("2026-09-28T08:00:00Z")
        val fresh = Instant.now().toString()

        store.personalData.upsertWatchlists(
            listOf(
                WatchlistRow(
                    id = "compounders",
                    name = "The Compounders",
                    tickersJson = "[\"AAPL\",\"JPM\",\"NOK\"]",
                    isDefault = true,
                    updatedAt = now.toString()
                )
            )
        )
        store.personalData.upsertTheses(
            listOf(
                thesis(
                    "AAPL",
                    "Exceptional capital efficiency and a durable installed base.",
                    "Services growth and customer retention must remain strong.",
                    "2026-06-01T09:00:00Z",
                    "intact"
                ),
                thesis(
                    "JPM",
                    "Scale, deposits, and disciplined underwriting support returns.",
                    "Credit quality must remain within the through-cycle range.",
                    "2025-11-10T09:00:00Z",
                    "watch"
                )
            )
        )
        store.appSettings.put(AppSettingRow(AppSettings.KEY_THEME, "dark"))
        store.appSettings.put(AppSettingRow(AppSettings.KEY_COMPARE_TICKERS, "AAPL,JPM,NOK"))
        store.appSettings.put(AppSettingRow(AppSettings.KEY_CURRENT_TICKER, "AAPL"))

        for (ticker in listOf("AAPL", "JPM", "NOK")) {
            store.stockCache.upsert(cacheRow(ticker, fresh))
        }

        store.alerts.putSnapshot(
            SnapshotRow(
                ticker = "AAPL",
                snapshotJson = "{}",
                healthScore = 64,
                baselineScore = 68,
                capturedAt = "2026-09-25T08:00:00Z"
            )
        )
        store.alerts.record(
            NotificationRow(
                ticker = "AAPL",
                alertType = "fundamental_score",
                title = "Fundamental score moved",
                body = "The recorded score moved from 68 to 64. Revisit your reasons.",
                severity = "watch",
                url = "/stock/AAPL",
                deliveredAt = "2026-09-25T08:00:00Z"
            )
        )
        store.close()
    }

    private fun thesis(
        ticker: String,
        rationale: String,
        condition: String,
        reviewedAt: String,
        assessment: String
    ) = ThesisRow(
        ticker = ticker,
        conviction = "high",
        targetBuyPrice = null,
        coreRationale = rationale,
        moatTagsJson = "[\"Brand\",\"Switching costs\"]",
        sellTriggersJson = "[{\"id\":\"$ticker-condition\",\"text\":\"$condition\",\"triggered\":false}]",
        journalEntriesJson = "[{\"id\":\"$ticker-review\",\"date\":\"$reviewedAt\",\"note\":\"Quarterly review completed.\",\"kind\":\"review\",\"assessment\":\"$assessment\"}]",
        updatedAt = reviewedAt,
        mustRemainTrue = condition
    )

    private fun cacheRow(ticker: String, fresh: String): StockCacheRow {
        val model = instrumentation.context.assets.open("$ticker.model.json")
            .bufferedReader().use { it.readText() }
            .let { kotlinx.serialization.json.Json.parseToJsonElement(it).jsonObject }
        val financials = model.getValue("financials").toString()
        val record = buildJsonObject {
            listOf(
                "ticker", "name", "sector", "industry", "price", "change_pct", "currency",
                "market_cap", "health_score", "altman_z", "piotroski_score", "roic_pct",
                "fcf_conversion_pct", "net_cash_b"
            ).forEach { key -> model[key]?.let { put(key, it) } }
            put("financials_json", JsonPrimitive(financials))
            put("checklist_json", JsonPrimitive(model.getValue("checklist").toString()))
            put("catalysts_json", JsonPrimitive(model.getValue("catalysts").toString()))
            put("risks_json", JsonPrimitive(model.getValue("risks").toString()))
            put("pillars_json", JsonPrimitive(model.getValue("pillars").toString()))
            put("summary_json", JsonPrimitive(model.getValue("summary").toString()))
            put("statements_json", JsonPrimitive("{}"))
        }
        return StockCacheRow(
            ticker = ticker,
            name = model.getValue("name").jsonPrimitive.content,
            sector = model["sector"]?.jsonPrimitive?.content,
            healthScore = model["health_score"]?.jsonPrimitive?.content?.toIntOrNull(),
            recordJson = record.toString(),
            financialsJson = financials,
            lastFetchedAt = fresh,
            financialsFetchedAt = fresh
        )
    }
}
