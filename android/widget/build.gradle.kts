plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * The home-screen widget's rendering surface — phase 7, `docs/16_ROADMAP.md`.
 *
 * Deliberately data-free: no dependency on `:data`, no `OmahaEngine` access.
 * `OmahaEngine.Handles` guarantees exactly one `Room` handle on `omaha.db`;
 * a second module opening the database itself is exactly the failure mode
 * its own header comment warns about. This module only renders whatever
 * `WidgetRefreshWorker` (in `:app`) last wrote into Glance's own per-instance
 * state — see `WidgetState.kt`.
 *
 * No `glance-material3`. Nothing here reads `MaterialTheme` — `ColorProvider`s
 * are built straight from `:design`'s `Tokens.kt`, the same "Foundation only,
 * no Material" rule `:app` and `:design` already hold, with no exception
 * this time.
 */
android {
    namespace = "com.zandaulion.omaha.widget"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":design"))

    // 1.2.0 is the current stable release (verified against Maven Central,
    // 2026-08-29); 1.3.0 is still alpha. Pinned exactly, matching every other
    // dependency in this project — no version catalog, no floating range.
    implementation("androidx.glance:glance:1.2.0")
    implementation("androidx.glance:glance-appwidget:1.2.0")

    // For the manual-refresh tap only — enqueues :app's WidgetRefreshWorker
    // by class name (see RefreshWidgetAction) rather than a compile-time
    // dependency on :app, which would invert this module's whole point.
    implementation("androidx.work:work-runtime-ktx:2.10.1")
}
