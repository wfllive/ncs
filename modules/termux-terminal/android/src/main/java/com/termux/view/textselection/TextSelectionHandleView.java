package com.termux.view.textselection;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.ColorDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.PopupWindow;

import com.termux.view.TerminalView;

/**
 * A draggable text selection handle (start or end) drawn as a thin line with a
 * circle below it, shown in a {@link PopupWindow} over the terminal view — the
 * same UX as the native Android text selection handles.
 */
@SuppressLint("ViewConstructor")
public class TextSelectionHandleView extends View implements View.OnTouchListener {

    public static final int LEFT = CursorController.LEFT;
    public static final int RIGHT = CursorController.RIGHT;

    private static final int HANDLE_COLOR = 0xFF7C3AED;

    private final TerminalView mTerminalView;
    private final CursorController mController;
    private final int mOrientation;
    private final PopupWindow mPopupWindow;
    private final Paint mPaint;

    private final int mCircleRadius;
    private final int mStrokeWidth;
    /** How far above the finger the handle stays while dragging, in px. */
    private final int mDragLift;

    private final int[] mTempCoords = new int[2];

    private int mHotspotX;
    private int mLineSpacing;
    private boolean mIsShowing;
    private boolean mIsDragging;
    private float mDragOffsetX;
    private float mDragOffsetY;
    private int mPopupX;
    private int mPopupY;

    public TextSelectionHandleView(Context context, CursorController controller, int orientation, TerminalView terminalView) {
        super(context);
        mController = controller;
        mOrientation = orientation;
        mTerminalView = terminalView;

        final float density = getResources().getDisplayMetrics().density;
        mStrokeWidth = Math.max(2, Math.round(1.5f * density));
        mCircleRadius = Math.round(7 * density);
        mDragLift = Math.round(32 * density);

        mPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        mPaint.setColor(HANDLE_COLOR);

        setOnTouchListener(this);

        mPopupWindow = new PopupWindow(this, ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mPopupWindow.setClippingEnabled(true);
        mPopupWindow.setSplitTouchEnabled(true);
        mPopupWindow.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
    }

    private int computeLineSpacing() {
        // Height of one terminal row in pixels.
        final int spacing = mTerminalView.getPointY(1) - mTerminalView.getPointY(0);
        return spacing > 0 ? spacing : Math.round(14 * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        mLineSpacing = computeLineSpacing();
        final int width = mCircleRadius * 2 + mStrokeWidth * 2;
        final int height = mLineSpacing + mCircleRadius * 2 + mStrokeWidth;
        mHotspotX = width / 2;
        setMeasuredDimension(width, height);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        final int centerX = getWidth() / 2;
        final int lineBottom = mLineSpacing + mStrokeWidth / 2;
        mPaint.setStrokeWidth(mStrokeWidth);
        canvas.drawLine(centerX, mStrokeWidth / 2f, centerX, lineBottom, mPaint);
        canvas.drawCircle(centerX, lineBottom + mCircleRadius, mCircleRadius, mPaint);
    }

    /**
     * Position the handle so that its anchor sits on character column {@code cx}
     * at the bottom of terminal row {@code cy}. Hides the handle if the row is
     * currently scrolled off screen.
     */
    public void positionAtCursor(int cx, int cy) {
        if (!mTerminalView.isAttachedToWindow()) return;

        measure(MeasureSpec.UNSPECIFIED, MeasureSpec.UNSPECIFIED);

        final int anchorX = mTerminalView.getPointX(cx);
        final int anchorY = mTerminalView.getPointY(cy + 1);

        // Only show the handle while its row is visible on screen.
        final int viewHeight = mTerminalView.getHeight();
        final boolean visible = anchorY >= 0 && (anchorY - mLineSpacing) < viewHeight;
        if (!visible) {
            if (mIsShowing) hide();
            return;
        }

        mTerminalView.getLocationInWindow(mTempCoords);
        final int x = mTempCoords[0] + anchorX - mHotspotX;
        final int y = mTempCoords[1] + anchorY - mLineSpacing;
        showOrUpdate(x, y);
    }

    private void showOrUpdate(int windowX, int windowY) {
        if (mIsShowing) {
            if (windowX != mPopupX || windowY != mPopupY) {
                mPopupX = windowX;
                mPopupY = windowY;
                try {
                    mPopupWindow.update(windowX, windowY, -1, -1);
                } catch (Exception ignored) {
                }
            }
        } else {
            mPopupX = windowX;
            mPopupY = windowY;
            try {
                mPopupWindow.showAtLocation(mTerminalView, Gravity.NO_GRAVITY, windowX, windowY);
                mIsShowing = true;
            } catch (Exception ignored) {
            }
        }
    }

    public boolean isShowing() {
        return mIsShowing;
    }

    public int getOrientation() {
        return mOrientation;
    }

    public void hide() {
        mIsDragging = false;
        if (mIsShowing) {
            mIsShowing = false;
            try {
                mPopupWindow.dismiss();
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    @SuppressLint("ClickableViewAccessibility")
    public boolean onTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                mIsDragging = true;
                // Distance from the finger to the current popup top-left corner.
                mDragOffsetX = event.getRawX() - mPopupX;
                mDragOffsetY = event.getRawY() - mPopupY;
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (!mIsDragging) return true;
                // Desired popup top-left corner following the finger (screen == window coords here).
                final float newPopupX = event.getRawX() - mDragOffsetX;
                final float newPopupY = event.getRawY() - mDragOffsetY - mDragLift;
                showOrUpdate(Math.round(newPopupX), Math.round(newPopupY));

                // Convert the handle anchor into terminal view coordinates and update the selection.
                mTerminalView.getLocationInWindow(mTempCoords);
                final int anchorViewX = Math.round(newPopupX - mTempCoords[0]) + mHotspotX;
                final int anchorViewY = Math.round(newPopupY - mTempCoords[1]) + mLineSpacing;
                mController.updateSelection(this, anchorViewX, anchorViewY);
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: {
                mIsDragging = false;
                // Snap the handles exactly onto the selection bounds.
                mController.render();
                return true;
            }
        }
        return false;
    }
}
