package com.storm.engine.crash;

import android.content.Context;

public class CrashApplication extends android.app.Application {
    @Override
    protected void attachBaseContext(Context base) {
        // Handler MUST be installed before super() so ContentProviders
        // (Yandex Ads, AppMetrica, AndroidX Startup) are covered.
        CrashHandler.installEarly();
        super.attachBaseContext(base);
        CrashHandler.init(base);
    }

    @Override
    public void onCreate() {
        CrashHandler.init(this);
        super.onCreate();
    }
}
