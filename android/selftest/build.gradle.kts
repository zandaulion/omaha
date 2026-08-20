plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * A sideloadable harness that runs the parity and round-trip checks on a real
 * handset and shows the results on screen.
 *
 * It exists because the instrumented suites need adb, and the one question
 * they cannot answer from an emulator is what any of this costs on an actual
 * ARM phone. Everything it asserts is already asserted in CI; the value here is
 * the device it runs on.
 *
 * Deliberately built from plain views rather than Compose. This is a
 * diagnostic, and it should not drag in the UI toolkit before step 4 has
 * decided anything — nor inflate the APK whose size :probe is measuring.
 */
android {
    namespace = "com.zandaulion.omaha.selftest"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zandaulion.omaha.selftest"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    sourceSets {
        getByName("main") {
            // The engine, staged by :engine-android.
            assets.srcDir("../engine-android/build/generated/coreAssets")
            // Only the fixtures this harness actually reads. The recorded HTTP
            // bodies and full models are for the ingestion tests and would add
            // a third of a megabyte for nothing.
            assets.srcDir("build/generated/testFixtures")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
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

val stageFixtures by tasks.registering(Sync::class) {
    from(rootProject.layout.projectDirectory.dir("../core/__fixtures__")) {
        include("*.scoring-input.json", "*.scoring-output.json", "backup.pwa.json")
    }
    into(layout.buildDirectory.dir("generated/testFixtures"))
}

tasks.matching { it.name.startsWith("generate") || it.name.startsWith("merge") }.configureEach {
    dependsOn(":engine-android:stageCoreAssets", stageFixtures)
}

dependencies {
    implementation(project(":data"))

    // Declared here because this module uses them directly. :data keeps them
    // as implementation details, which is right: what it exposes is a store,
    // not a particular way of storing.
    implementation("androidx.room:room-runtime:2.7.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
