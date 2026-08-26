plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

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
        versionCode = 1
        versionName = "0.1"
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

tasks.matching { it.name.startsWith("generate") || it.name.startsWith("merge") }.configureEach {
    dependsOn(":engine-android:stageCoreAssets")
}

dependencies {
    implementation(project(":design"))
    implementation(project(":data"))

    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
