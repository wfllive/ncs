package ru.wfllive.nova.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Debug
import ru.wfllive.nova.BuildConfig
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.Locale

object SecurityUtils {

    data class SecurityStatus(
        val isTampered: Boolean,
        val actualSha256: String,
        val expectedSha256: String,
        val isDebug: Boolean,
        val isDebuggerAttached: Boolean,
        val isFridaDetected: Boolean,
        val isPackageNameValid: Boolean,
        val statusMessage: String
    )

    /**
     * Retrieves the SHA-256 fingerprint of the APK's signing certificate.
     */
    fun getAppSignatureSha256(context: Context): String {
        return try {
            val packageName = context.packageName
            val packageManager = context.packageManager

            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val packageInfo = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                val signingInfo = packageInfo.signingInfo
                if (signingInfo == null) null
                else if (signingInfo.hasMultipleSigners()) {
                    signingInfo.apkContentsSigners
                } else {
                    signingInfo.signingCertificateHistory
                }
            } else {
                @Suppress("DEPRECATION")
                val packageInfo = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                packageInfo.signatures
            }

            if (signatures.isNullOrEmpty()) return ""

            val certBytes = signatures[0].toByteArray()
            val digest = MessageDigest.getInstance("SHA-256")
            val hashBytes = digest.digest(certBytes)

            val hexString = StringBuilder()
            for (i in hashBytes.indices) {
                val hex = Integer.toHexString(0xFF and hashBytes[i].toInt()).uppercase(Locale.US)
                if (hex.length == 1) hexString.append('0')
                hexString.append(hex)
                if (i < hashBytes.size - 1) {
                    hexString.append(':')
                }
            }
            hexString.toString()
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Checks whether a debugger is attached or debuggable flag is enabled in production.
     */
    fun isDebuggerConnected(context: Context): Boolean {
        if (Debug.isDebuggerConnected()) return true
        val isDebuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        return !BuildConfig.DEBUG && isDebuggable
    }

    /**
     * Checks for the presence of Frida server or Frida libraries in the process/filesystem.
     */
    fun isFridaDetected(): Boolean {
        try {
            // Check common frida server binary paths
            val knownPaths = arrayOf(
                "/data/local/tmp/frida-server",
                "/data/local/tmp/re.frida.server",
                "/system/bin/frida-server"
            )
            for (path in knownPaths) {
                if (File(path).exists()) return true
            }

            // Check maps for frida or gadget libraries
            val mapsFile = File("/proc/self/maps")
            if (mapsFile.exists()) {
                val content = mapsFile.readText()
                if (content.contains("frida") || content.contains("gadget") || content.contains("xposed") || content.contains("substrate")) {
                    return true
                }
            }
        } catch (_: Exception) {
            // Ignore security exception
        }
        return false
    }

    /**
     * Checks if the package name matches expected 'ru.wfllive.nova'.
     */
    fun isPackageNameValid(context: Context): Boolean {
        return context.packageName == "ru.wfllive.nova"
    }

    /**
     * Performs a comprehensive security integrity check.
     */
    fun verifyIntegrity(context: Context): SecurityStatus {
        val isDebug = BuildConfig.DEBUG
        val actualSha256 = getAppSignatureSha256(context)
        val rawExpected = try { BuildConfig.EXPECTED_SIGNATURE_SHA256 } catch (_: Throwable) { "" }
        val expectedSha256 = rawExpected.trim().uppercase(Locale.US)

        val debuggerAttached = isDebuggerConnected(context)
        val fridaDetected = isFridaDetected()
        val pkgValid = isPackageNameValid(context)

        var tampered = false
        var message = "Security check passed"

        if (!pkgValid) {
            tampered = true
            message = "Package name mismatch: expected ru.wfllive.nova, got ${context.packageName}"
        } else if (!isDebug && expectedSha256.isNotEmpty()) {
            val normalizedActual = actualSha256.replace(":", "").uppercase(Locale.US)
            val normalizedExpected = expectedSha256.replace(":", "").uppercase(Locale.US)

            if (normalizedActual != normalizedExpected) {
                tampered = true
                message = "Signature mismatch! APK was modified or re-signed."
            }
        }

        if (!isDebug && fridaDetected) {
            tampered = true
            message = "Frida/Xposed dynamic hook environment detected."
        }

        return SecurityStatus(
            isTampered = tampered,
            actualSha256 = actualSha256,
            expectedSha256 = expectedSha256,
            isDebug = isDebug,
            isDebuggerAttached = debuggerAttached,
            isFridaDetected = fridaDetected,
            isPackageNameValid = pkgValid,
            statusMessage = message
        )
    }
}