package com.termux.view.textselection;

import android.view.MotionEvent;
import android.view.ViewTreeObserver;

/**
 * Controller for the text selection handles of a terminal view.
 * Implemented by {@link TextSelectionCursorController}, consumed by {@link TextSelectionHandleView}.
 */
public interface CursorController extends ViewTreeObserver.OnTouchModeChangeListener {

    int LEFT = 0;
    int RIGHT = 1;

    /** Start text selection at the position of the given long-press event. */
    void show(MotionEvent event);

    /** Stop text selection. Returns true if a selection was active. */
    boolean hide();

    /** Reposition the selection handles so they match the current selection. */
    void render();

    boolean isActive();

    /**
     * Called from a handle being dragged. The (x, y) point is the desired handle
     * anchor in terminal view pixel coordinates.
     */
    void updateSelection(TextSelectionHandleView handle, int x, int y);
}
