package com.termux.view.textselection;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;

import com.termux.terminal.TerminalEmulator;
import com.termux.view.TerminalView;

import expo.modules.termuxterminal.R;

/**
 * Full text selection controller for the {@link TerminalView}:
 * long-press selects the word under the finger, two draggable handles adjust the
 * selection and a floating action mode offers Copy / Paste / Select all.
 */
public class TextSelectionCursorController implements CursorController {

    private static final int MENU_COPY = 0;
    private static final int MENU_PASTE = 1;
    private static final int MENU_SELECT_ALL = 2;

    private final TerminalView mTerminalView;
    private final TextSelectionHandleView mStartHandle;
    private final TextSelectionHandleView mEndHandle;

    private boolean mIsSelectingText = false;
    private ActionMode mActionMode;

    private int mSelX1 = -1, mSelX2 = -1, mSelY1 = -1, mSelY2 = -1;

    public TextSelectionCursorController(TerminalView terminalView) {
        mTerminalView = terminalView;
        mStartHandle = new TextSelectionHandleView(terminalView.getContext(), this, CursorController.LEFT, terminalView);
        mEndHandle = new TextSelectionHandleView(terminalView.getContext(), this, CursorController.RIGHT, terminalView);
    }

    // ---------------------------------------------------------------------------------------------
    // CursorController
    // ---------------------------------------------------------------------------------------------

    @Override
    public void show(MotionEvent event) {
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        if (emulator == null) return;

        int cx = clampX(mTerminalView.getCursorX(event.getX()));
        int cy = clampY(mTerminalView.getCursorY(event.getY()));

        // Select the word under the finger: expand the position over non-whitespace characters.
        String line = emulator.getScreen().getSelectedText(0, cy, emulator.mColumns, cy);
        if (line == null) line = "";
        final int lineLength = line.length();
        if (cx > lineLength) cx = lineLength;

        int x1 = cx, x2 = cx;
        while (x1 > 0 && !Character.isWhitespace(line.charAt(x1 - 1))) x1--;
        while (x2 < lineLength && !Character.isWhitespace(line.charAt(x2))) x2++;

        mIsSelectingText = true;
        mSelX1 = x1;
        mSelY1 = cy;
        mSelX2 = x2;
        mSelY2 = cy;

        showActionMode();
        positionHandles();
        mTerminalView.invalidate();
    }

    @Override
    public boolean hide() {
        if (!mIsSelectingText) return false;
        mIsSelectingText = false;

        mStartHandle.hide();
        mEndHandle.hide();

        if (mActionMode != null) {
            // This triggers onDestroyActionMode which nulls the reference.
            mActionMode.finish();
            mActionMode = null;
        }

        mSelX1 = mSelX2 = mSelY1 = mSelY2 = -1;
        return true;
    }

    @Override
    public void render() {
        positionHandles();
    }

    @Override
    public boolean isActive() {
        return mIsSelectingText;
    }

    @Override
    public void updateSelection(TextSelectionHandleView handle, int x, int y) {
        if (!mIsSelectingText) return;

        final int cx = clampX(mTerminalView.getCursorX(x));
        final int cy = clampY(mTerminalView.getCursorY(y));

        if (handle == mStartHandle) {
            mSelX1 = cx;
            mSelY1 = cy;
        } else {
            mSelX2 = cx;
            mSelY2 = cy;
        }

        // Keep the selection ordered: start must not be after end.
        if (mSelY1 > mSelY2 || (mSelY1 == mSelY2 && mSelX1 > mSelX2)) {
            final int tmpX = mSelX1, tmpY = mSelY1;
            mSelX1 = mSelX2;
            mSelY1 = mSelY2;
            mSelX2 = tmpX;
            mSelY2 = tmpY;
        }

        positionHandles();
        mTerminalView.invalidate();
    }

    // ---------------------------------------------------------------------------------------------
    // TerminalView integration
    // ---------------------------------------------------------------------------------------------

    /** Current selection as [y1, y2, x1, x2], matching TerminalRenderer.render() arguments. */
    public void getSelectors(int[] sel) {
        if (sel == null || sel.length < 4) return;
        if (mSelY1 < 0 || mSelY2 < 0) {
            sel[0] = sel[1] = sel[2] = sel[3] = -1;
        } else {
            sel[0] = mSelY1;
            sel[1] = mSelY2;
            sel[2] = mSelX1;
            sel[3] = mSelX2;
        }
    }

    /** Show the floating action mode unless it is already shown. */
    public void showActionMode() {
        if (mActionMode != null || !mIsSelectingText || !mTerminalView.isAttachedToWindow()) return;
        try {
            mActionMode = mTerminalView.startActionMode(mActionModeCallback, ActionMode.TYPE_FLOATING);
            if (mActionMode == null) {
                mActionMode = mTerminalView.startActionMode(mActionModeCallback, ActionMode.TYPE_PRIMARY);
            }
        } catch (Throwable ignored) {
            // Some devices fail to show a floating toolbar for non-editable views; the
            // selection itself (and long-press menu via the extra keys) still works.
        }
    }

    public ActionMode getActionMode() {
        return mActionMode;
    }

    /** Shift the selection rows after the terminal scrolled new lines into view. */
    public void decrementYTextSelectionCursors(int decrement) {
        if (mSelY1 >= 0) mSelY1 -= decrement;
        if (mSelY2 >= 0) mSelY2 -= decrement;
        positionHandles();
    }

    public void incrementYTextSelectionCursors(int increment) {
        if (mSelY1 >= 0) mSelY1 += increment;
        if (mSelY2 >= 0) mSelY2 += increment;
        positionHandles();
    }

    public void onDetached() {
        hide();
    }

    @Override
    public void onTouchModeChanged(boolean isInTouchMode) {
        if (!isInTouchMode) hide();
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    private void positionHandles() {
        if (!mIsSelectingText) return;
        mStartHandle.positionAtCursor(mSelX1, mSelY1);
        mEndHandle.positionAtCursor(mSelX2, mSelY2);
    }

    private int clampX(int x) {
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        final int max = emulator != null ? emulator.mColumns : 80;
        if (x < 0) return 0;
        return Math.min(x, max);
    }

    private int clampY(int y) {
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        if (emulator == null) return y;
        final int min = -emulator.getScreen().getActiveTranscriptRows();
        final int max = emulator.mRows - 1;
        if (y < min) return min;
        return Math.min(y, max);
    }

    private String getSelectedText() {
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        if (emulator == null || mSelY1 < 0 || mSelY2 < 0) return null;
        return emulator.getScreen().getSelectedText(mSelX1, mSelY1, mSelX2, mSelY2, true);
    }

    private void copySelectionToClipboard() {
        final String selectedText = getSelectedText();
        if (selectedText == null || selectedText.isEmpty()) return;
        final Context context = mTerminalView.getContext();
        final ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("terminal text", selectedText));
        }
    }

    private void pasteFromClipboard() {
        final Context context = mTerminalView.getContext();
        final ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        final ClipData clip = clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return;
        final CharSequence text = clip.getItemAt(0).coerceToText(context);
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        if (text != null && text.length() > 0 && emulator != null) {
            emulator.paste(text.toString());
        }
    }

    private void selectAll() {
        final TerminalEmulator emulator = mTerminalView.mEmulator;
        if (emulator == null) return;
        mSelX1 = 0;
        mSelY1 = -emulator.getScreen().getActiveTranscriptRows();
        mSelX2 = emulator.mColumns;
        mSelY2 = emulator.mRows - 1;
        positionHandles();
        mTerminalView.invalidate();
    }

    // ---------------------------------------------------------------------------------------------
    // Action mode (floating toolbar with Copy / Paste / Select all)
    // ---------------------------------------------------------------------------------------------

    private final ActionMode.Callback mActionModeCallback = new ActionMode.Callback2() {

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            final Context context = mTerminalView.getContext();
            final int show = MenuItem.SHOW_AS_ACTION_IF_ROOM | MenuItem.SHOW_AS_ACTION_WITH_TEXT;
            menu.add(Menu.NONE, MENU_COPY, Menu.NONE, context.getString(R.string.copy_text)).setShowAsAction(show);
            menu.add(Menu.NONE, MENU_PASTE, Menu.NONE, context.getString(R.string.paste_text)).setShowAsAction(show);
            menu.add(Menu.NONE, MENU_SELECT_ALL, Menu.NONE, context.getString(R.string.text_selection_select_all)).setShowAsAction(show);
            return true;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            final Context context = mTerminalView.getContext();
            final ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            final MenuItem pasteItem = menu.findItem(MENU_PASTE);
            if (pasteItem != null && clipboard != null) {
                pasteItem.setEnabled(clipboard.hasPrimaryClip());
            }
            return true;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            switch (item.getItemId()) {
                case MENU_COPY:
                    copySelectionToClipboard();
                    mTerminalView.stopTextSelectionMode();
                    return true;
                case MENU_PASTE:
                    pasteFromClipboard();
                    mTerminalView.stopTextSelectionMode();
                    return true;
                case MENU_SELECT_ALL:
                    selectAll();
                    mode.invalidate();
                    return true;
                default:
                    return false;
            }
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            mActionMode = null;
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (mSelY1 >= 0 && mSelY2 >= 0) {
                outRect.set(
                    mTerminalView.getPointX(mSelX1),
                    mTerminalView.getPointY(mSelY1),
                    mTerminalView.getPointX(mSelX2),
                    mTerminalView.getPointY(mSelY2 + 1));
            } else {
                outRect.set(0, 0, view.getWidth(), view.getHeight());
            }
        }
    };
}
