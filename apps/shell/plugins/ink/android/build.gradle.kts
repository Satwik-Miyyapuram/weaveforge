import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    // The app keeps the old applicationId org.weaveforge.ink, so the library needs its own.
    namespace = "org.weaveforge.ink.plugin"
    compileSdk = 37

    defaultConfig {
        // The old app's floor (phase-4-phones.md decision 7).
        minSdk = 29
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        // Same values as apps/android: the widget's feed host rule and Google sign-in.
        buildConfigField("String", "APP_URL", "\"https://app.weaveforge.org\"")
        buildConfigField(
            "String",
            "ALLOWED_HOSTS",
            "\"app.weaveforge.org,api.weaveforge.org,weaveforge.org,supabase.co,google.com,gstatic.com,googleusercontent.com,googleapis.com,google-analytics.com,googletagmanager.com,cloudflarestorage.com\"",
        )
        buildConfigField(
            "String",
            "GOOGLE_WEB_CLIENT_ID",
            "\"400432666296-so09t7r3qdoja9d23dk9dcndooe2beq6.apps.googleusercontent.com\"",
        )
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests {
            // Robolectric needs the merged resources for the view-tree test.
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

dependencies {
    implementation(project(":tauri-android"))
    // Same pins as apps/android: front-buffered rendering and the WebView compat layer.
    implementation("androidx.graphics:graphics-core:1.0.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-ktx:1.13.1")
    // Plugin's lifecycle hooks take an AppCompatActivity; same version as tauri-android.
    implementation("androidx.appcompat:appcompat:1.6.0")
    // Google sign-in through the system account sheet (GoogleAccountPicker).
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    testImplementation("junit:junit:4.13.2")
    // `org.json` is part of Android, but a JVM unit test sees only stubs of it.
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
