package com.example.stormapp;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import com.storm.engine.crash.CrashHandler;

public class MainActivity extends Activity {
    private int counter = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Universal Debug Crash Handler (API 21 - 36+)
        CrashHandler.init(this);

        setContentView(R.layout.activity_main);

        final TextView titleView = findViewById(R.id.title_view);
        Button btn = findViewById(R.id.click_button);

        btn.setOnClickListener(v -> {
            counter++;
            titleView.setText("Clicked: " + counter + " times!");
            Toast.makeText(MainActivity.this, "Awesome! Count = " + counter, Toast.LENGTH_SHORT).show();
        });
    }
}
