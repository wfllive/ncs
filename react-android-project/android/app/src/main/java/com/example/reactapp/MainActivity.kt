package com.example.reactapp

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader

// Локальный Vite-контент (dist, скопирован в assets) раздаётся через WebViewAssetLoader
// с https-хоста appassets.androidplatform.net — ES-модули и fetch работают БЕЗ опасных
// file://-флагов, которые помечают проверки безопасности Google Play / RuStore.
// Требуется зависимость: implementation("androidx.webkit:webkit:1.14.0").
private const val CONTENT_URL = "https://appassets.androidplatform.net/assets/index.html"

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // file:// не используется: контент идёт с https-хоста appassets через assetLoader.
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return super.shouldInterceptRequest(view, request)
                return assetLoader.shouldInterceptRequest(uri)
                    ?: super.shouldInterceptRequest(view, request)
            }
        }
        webView.loadUrl(CONTENT_URL)
        setContentView(webView)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onPause() { super.onPause(); if (this::webView.isInitialized) webView.onPause() }
    override fun onResume() { super.onResume(); if (this::webView.isInitialized) webView.onResume() }
    override fun onDestroy() { if (this::webView.isInitialized) webView.destroy(); super.onDestroy() }
}
