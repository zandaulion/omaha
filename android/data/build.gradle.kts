plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.zandaulion.omaha.data"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        getByName("androidTest") {
            // The engine, read out of assets exactly as the app will read it.
            assets.srcDir("../engine-android/build/generated/coreAssets")
            // The PWA-produced backup, taken live from core/ rather than
            // copied here — a copy is a fixture that can quietly go stale.
            assets.srcDir("../../core/__fixtures__")
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

dependencies {
    api(project(":engine-android"))

    implementation("androidx.room:room-runtime:2.7.1")
    implementation("androidx.room:room-ktx:2.7.1")
    ksp("androidx.room:room-compiler:2.7.1")

    // JsonElement only — no @Serializable classes, so no compiler plugin. The
    // interchange shape is defined by core/backup.js, not by a Kotlin type,
    // and mirroring it as data classes would be a second definition of it.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Phase 6 (docs/16_ROADMAP.md). Repositories live here, matching every
    // other repository in this module — not in :app, which only needs to
    // compile against AuthRepository's/RelayRepository's/BillingRepository's
    // own return types. The com.google.gms.google-services *plugin* stays in
    // :app, since it processes google-services.json and that file lives
    // there; Firebase's SDK is a singleton reachable from anywhere once :app
    // has initialised it, the same way this module never had to know how
    // Room was opened.
    implementation(platform("com.google.firebase:firebase-bom:34.17.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-functions")

    // Sign in with Google, via Credential Manager rather than the deprecated
    // GoogleSignInClient.
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")

    implementation("com.android.billingclient:billing-ktx:9.1.0")

    // Firebase Auth and the Billing Library both hand back a Task<T>, not a
    // suspend function. This is the `.await()` extension on it — separate
    // from kotlinx-coroutines-android, which does not include it.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.room:room-testing:2.7.1")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation(kotlin("test"))

    // JVM unit tests. DcfParityTest needs no device: it compares Kotlin
    // arithmetic against vectors recorded from the JS module.
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
}

// The engine bundle has to exist before the instrumented tests can read it.
tasks.matching { it.name.contains("AndroidTest") }.configureEach {
    dependsOn(":engine-android:stageCoreAssets")
}
