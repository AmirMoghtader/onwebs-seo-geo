package com.onwebs.seogeo

import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Lets the page be inspected from the desktop over adb. Without it there
    // is no way to see why the app renders differently from the same file
    // opened in the phone's own browser, and the alternative is guessing.
    WebView.setWebContentsDebuggingEnabled(true)
  }

  override fun onWebViewCreate(webView: WebView) {
    // The page paints its own dark theme. Android's algorithmic darkening
    // rewrites colours it believes belong to a light page, and applied to
    // this one it destroyed the light text while leaving the dark background
    // alone. The theme-level switches do not cover this path on API 33+, so
    // it is turned off on the WebView itself.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
      WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)
    ) {
      @Suppress("DEPRECATION")
      WebSettingsCompat.setForceDark(webView.settings, WebSettingsCompat.FORCE_DARK_OFF)
    }
  }
}
