plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * What the web view loads. `WEAVEFORGE_URL` at build time overrides the
 * deployed app, so a debug build can point at a laptop on the same network
 * (`WEAVEFORGE_URL=http://192.168.1.10:3000 ./gradlew assembleDebug`) — the
 * same variable the desktop shell reads.
 */
val appUrl: String = System.getenv("WEAVEFORGE_URL")?.takeIf { it.isNotBlank() }
    ?: "https://app.weaveforge.org/"

android {
    namespace = "org.weaveforge.ink"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.weaveforge.ink"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.6.0"
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
        // A plain-http development URL needs cleartext; the deployed app is https.
        manifestPlaceholders["cleartext"] = appUrl.startsWith("http://").toString()
    }

    buildFeatures {
        buildConfig = true
    }

    androidResources {
        // Windows drops `desktop.ini` into folders it has customised; the
        // resource merger refuses any file it does not understand.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:<dir>_*:!CVS:!thumbs.db:!picasa.ini:!desktop.ini:!*~"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    // CanvasFrontBufferedRenderer: the wet stroke written straight to the scanout buffer.
    implementation("androidx.graphics:graphics-core:1.0.3")
}
