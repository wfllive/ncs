# Android Core Component Keep Rules (Activities, Applications, Providers, Services)
-keep public class * extends android.app.Activity { *; }
-keep public class * extends android.app.Application { *; }
-keep public class * extends android.app.Service { *; }
-keep public class * extends android.content.BroadcastReceiver { *; }
-keep public class * extends android.content.ContentProvider { *; }
-keep public class * extends android.view.View { *; }

# Keep Attributes & Annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions,SourceFile,LineNumberTable
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Yandex Mobile Ads SDK & Submodules
-keep class com.yandex.mobile.ads.** { *; }
-dontwarn com.yandex.mobile.ads.**

# Keep AppMetrica Analytics
-keep class io.appmetrica.analytics.** { *; }
-dontwarn io.appmetrica.analytics.**

# Keep Varioqub Experiments
-keep class com.yandex.varioqub.** { *; }
-dontwarn com.yandex.varioqub.**

# Keep Storm Crash Handler
-keep class com.storm.engine.crash.** { *; }

# Keep AndroidX & Lifecycle
-keep class androidx.** { *; }
-dontwarn androidx.**

# Keep Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Keep Kotlin Stdlib & Coroutines
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Keep OkHttp & Okio (Network stack)
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# General warnings suppression for optional mediation libraries
-dontwarn javax.annotation.**
-dontwarn javax.inject.**
-dontwarn org.checkerframework.**
