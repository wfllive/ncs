package com.termux.shared.theme;

import android.content.Context;
import android.content.res.TypedArray;

/**
 * Minimal ThemeUtils stub replacing {@code com.termux.shared.theme.ThemeUtils}.
 * Resolves a themed color attribute, falling back to a provided default. The vendored
 * extra-keys code passes {@code 0} as the attribute id (the original termux theme attrs are
 * not shipped), in which case the default is returned directly.
 */
public final class ThemeUtils {

    private ThemeUtils() {}

    public static int getSystemAttrColor(Context context, int attr, int defaultColor) {
        if (attr == 0 || context == null) return defaultColor;
        TypedArray ta = null;
        try {
            ta = context.getTheme().obtainStyledAttributes(new int[]{attr});
            return ta.getColor(0, defaultColor);
        } catch (Exception e) {
            return defaultColor;
        } finally {
            if (ta != null) ta.recycle();
        }
    }
}
