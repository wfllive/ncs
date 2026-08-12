package ru.wfllive.nova.security

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SecurityModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SecurityModule"

    @ReactMethod
    fun getAppSignature(promise: Promise) {
        try {
            val sha256 = SecurityUtils.getAppSignatureSha256(reactApplicationContext)
            promise.resolve(sha256)
        } catch (e: Exception) {
            promise.reject("SECURITY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun verifyIntegrity(promise: Promise) {
        try {
            val status = SecurityUtils.verifyIntegrity(reactApplicationContext)
            val map = Arguments.createMap().apply {
                putBoolean("isTampered", status.isTampered)
                putString("actualSha256", status.actualSha256)
                putString("expectedSha256", status.expectedSha256)
                putBoolean("isDebug", status.isDebug)
                putBoolean("isDebuggerAttached", status.isDebuggerAttached)
                putBoolean("isFridaDetected", status.isFridaDetected)
                putBoolean("isPackageNameValid", status.isPackageNameValid)
                putString("statusMessage", status.statusMessage)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("SECURITY_ERROR", e.message, e)
        }
    }
}
