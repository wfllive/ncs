# Native Game Proguard Rules
-keep class com.example.stormgame.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
