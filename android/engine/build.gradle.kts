plugins {
    id("org.jetbrains.kotlin.jvm")
}

dependencies {
    // The QuickJS binding. Pre-1.0 — see doc 13 §18 for what that means here.
    implementation("io.github.dokar3:quickjs-kt-jvm:1.0.0-alpha13")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    // JsonElement only, no @Serializable classes, so no compiler plugin. Used
    // by the HTTP bridge to move requests and responses across as JSON.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    // The real socket behind HttpBridge. OkHttp will set Cookie and
    // User-Agent, which a browser forbids — the asymmetry that lets this
    // client reach Yahoo directly while the PWA needs a proxy.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation(kotlin("test"))
    // JsonElement only — no @Serializable classes, so the compiler plugin is
    // not needed. Used to compare scores as parsed values rather than as text.
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

// Shared with :engine-android's instrumented tests. The two parity suites must
// compare results the same way; a second canonicaliser could drift and would
// then be comparing two different questions.
sourceSets["test"].kotlin.srcDir("src/testShared/kotlin")

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
    }
}
