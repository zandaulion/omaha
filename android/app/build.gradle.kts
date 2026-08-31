import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

/**
 * The actual Play Store upload keystore — `zandaulion`, at
 * C:\Users\danie\StudioProjects\zandaulion, outside this repo. Play Console
 * locks each app to the certificate its first upload was signed with; a
 * release built against any other key (this module briefly fell back to the
 * debug keystore) gets rejected at upload with a certificate-mismatch error,
 * not a build error, so this has to be correct before `bundleRelease` runs at
 * all. keystore.properties is gitignored — see keystore.properties.example.
 */
val keystorePropertiesFile = rootProject.file("keystore.properties")
require(keystorePropertiesFile.exists()) {
    "android/keystore.properties is missing. Copy android/keystore.properties.example " +
        "to android/keystore.properties and fill in the zandaulion keystore's real path " +
        "and passwords — release builds must not silently fall back to the debug keystore."
}
val keystoreProperties = Properties().apply { load(FileInputStream(keystorePropertiesFile)) }

/**
 * The Compose client. Doc 13 §11 step 4; `docs/16_ROADMAP.md` phase 4.
 *
 * Foundation only, no Material. Doc 13 §10 makes visual parity with the PWA a
 * standing requirement, and Material3 would bring a second colour scheme and a
 * second type scale into a codebase whose whole parity argument is that there
 * is one of each. A `NavigationBar` would also not look like the PWA's nav —
 * different metrics, a pill indicator the web client has no equivalent of — so
 * the component that would save the most work is the one that matches least.
 */
android {
    namespace = "com.zandaulion.omaha.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zandaulion.omaha"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "0.4"
    }

    sourceSets {
        getByName("main") {
            // The engine, staged by :engine-android, exactly as :selftest reads it.
            assets.srcDir("../engine-android/build/generated/coreAssets")
        }
    }

    buildFeatures {
        compose = true
    }

    signingConfigs {
        create("release") {
            storeFile = file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
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

tasks.matching { it.name.startsWith("generate") || it.name.startsWith("merge") }.configureEach {
    dependsOn(":engine-android:stageCoreAssets")
}

dependencies {
    implementation(project(":design"))
    implementation(project(":data"))
    // The widget's rendering surface. :widget is deliberately data-free (see
    // its own build.gradle.kts), so this module owns the refresh worker, the
    // configuration activity, and the one OmahaEngine.get() call site the
    // widget's data ever passes through.
    implementation(project(":widget"))
    // Gradle's `implementation` does not leak transitively — :widget depends
    // on Glance for its own rendering, but WidgetRefreshWorker and
    // WidgetConfigActivity here call GlanceAppWidgetManager/updateAppWidgetState
    // directly too, so this module needs the same coordinate declared again.
    implementation("androidx.glance:glance-appwidget:1.2.0")

    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.foundation:foundation")
    // Material3 for exactly one component: the DCF sandbox's Slider. See
    // DcfSandbox.AssumptionSlider for why that exception is worth making —
    // every colour it draws is passed in from the tokens, and nothing in this
    // app reads MaterialTheme.
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.core:core-ktx:1.16.0")
    // The alert sweep. Doc 13 §11 step 5 names WorkManager specifically: an
    // AlarmManager schedule does not survive a reboot without a receiver, and
    // a foreground service for a six-hourly network read would be both a Play
    // policy problem and a persistent notification nobody asked for.
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // AuthRepository, RelayRepository and BillingRepository — Firebase Auth,
    // Cloud Functions, Credential Manager and Play Billing — all live in
    // :data (see its build.gradle.kts). This module only needs the
    // com.google.gms.google-services *plugin*, applied above, since
    // google-services.json lives here; Firebase's SDK is a process-wide
    // singleton once initialised, reachable from :data without either module
    // repeating the other's dependency declarations.

    debugImplementation("androidx.compose.ui:ui-tooling")
}
