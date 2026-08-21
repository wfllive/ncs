package com.example.yandexads;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;

import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.common.InitializationListener;
import com.yandex.mobile.ads.banner.BannerAdView;
import com.yandex.mobile.ads.banner.BannerAdSize;
import com.yandex.mobile.ads.common.AdRequest;

public class MainActivity extends Activity {
    private BannerAdView bannerAdView;
    private static final String DEMO_BANNER_ID = "demo-banner-yandex";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // 1. Initialize Yandex Mobile Ads SDK (v8.x API)
        YandexAds.initialize(this, new InitializationListener() {
            @Override
            public void onInitializationCompleted() {
                // Ensure UI operations run on the Main UI Thread
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, "Yandex Ads Initialized!", Toast.LENGTH_SHORT).show();
                        loadBannerAd();
                    }
                });
            }
        });

        Button btnInterstitial = findViewById(R.id.btn_interstitial);
        if (btnInterstitial != null) {
            btnInterstitial.setOnClickListener(v -> {
                Toast.makeText(MainActivity.this, "Loading Interstitial Ad...", Toast.LENGTH_SHORT).show();
            });
        }

        Button btnRewarded = findViewById(R.id.btn_rewarded);
        if (btnRewarded != null) {
            btnRewarded.setOnClickListener(v -> {
                Toast.makeText(MainActivity.this, "Loading Rewarded Ad...", Toast.LENGTH_SHORT).show();
            });
        }
    }

    private void loadBannerAd() {
        try {
            FrameLayout container = findViewById(R.id.banner_container);
            if (container == null) return;

            bannerAdView = new BannerAdView(this);
            // In Yandex Ads 8.x, sticky banner size is created via BannerAdSize.sticky(context, width)
            bannerAdView.setAdSize(BannerAdSize.sticky(this, 320));

            container.addView(bannerAdView);

            // In Yandex Ads 8.x, AdUnitId is passed into AdRequest.Builder(adUnitId)
            AdRequest adRequest = new AdRequest.Builder(DEMO_BANNER_ID).build();
            bannerAdView.loadAd(adRequest);
        } catch (Exception e) {
            Toast.makeText(this, "Ad load notice: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (bannerAdView != null) {
            bannerAdView.destroy();
        }
        super.onDestroy();
    }
}
