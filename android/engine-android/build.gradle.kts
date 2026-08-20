plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.zandaulion.omaha.engine.android"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        getByName("main") {
            // The Kotlin host lives once, in :engine. This module is the
            // Android binding of it — same source, different QuickJS artifact
            // — so a fix to the engine cannot land on one target and not the
            // other.
            java.srcDir("../engine/src/main/kotlin")

            // core/ is served from assets on Android. Staged by a Copy task
            // rather than pointed at directly, so tests and fixtures do not end
            // up shipped inside the library.
            assets.srcDir("build/generated/coreAssets")
        }
        getByName("androidTest") {
            // The fixtures are test data and belong only to this build.
            assets.srcDir("../../core/__fixtures__")
            // Same canonicaliser as the JVM parity suite — see :engine.
            java.srcDir("../engine/src/testShared/kotlin")
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

/**
 * Stage the generated bundle into assets.
 *
 * Only `core/dist/`. QuickJS in this binding holds one module per interpreter,
 * so the bundle is what actually runs and the individual modules would be dead
 * weight in the download.
 *
 * A Sync rather than a Copy, and rooted at the assets directory rather than at
 * a subdirectory of it, so that files which stop being produced actually
 * disappear. A Copy leaves them behind, and they were still being shipped.
 */
val stageCoreAssets by tasks.registering(Sync::class) {
    dependsOn(":bundleCore")
    from(rootProject.layout.projectDirectory.dir("../core/dist")) {
        into("core/dist")
    }
    into(layout.buildDirectory.dir("generated/coreAssets"))
}

tasks.named("preBuild") { dependsOn(stageCoreAssets) }

dependencies {
    // This module compiles :engine's source against the Android artifacts, so
    // its dependencies have to mirror :engine's or the shared source stops
    // compiling on one target only — which is how it failed the first time.
    implementation("io.github.dokar3:quickjs-kt-android:1.0.0-alpha13")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    androidTestImplementation(kotlin("test"))
}
