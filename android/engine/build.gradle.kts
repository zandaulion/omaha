plugins {
    id("org.jetbrains.kotlin.jvm")
}

dependencies {
    // The QuickJS binding. Pre-1.0 — see doc 13 §18 for what that means here.
    implementation("io.github.dokar3:quickjs-kt-jvm:1.0.0-alpha13")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation(kotlin("test"))
    // JsonElement only — no @Serializable classes, so the compiler plugin is
    // not needed. Used to compare scores as parsed values rather than as text.
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

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
