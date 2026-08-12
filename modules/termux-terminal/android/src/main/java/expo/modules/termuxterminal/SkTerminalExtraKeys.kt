package expo.modules.termuxterminal

import android.view.View
import com.termux.shared.termux.terminal.io.TerminalExtraKeys
import com.termux.view.TerminalView

/**
 * Extra-keys handler based on Termux/AndroidIDE's [TerminalExtraKeys]. Adds support for a
 * couple of convenience pseudo keys that are not sent to the shell:
 *  - `KEYBOARD` : toggles the soft keyboard
 *  - `PASTE`    : pastes the Android clipboard into the terminal
 *  - `DRAWER`   : reserved (no-op here, handled by the app)
 */
class SkTerminalExtraKeys(
    terminalView: TerminalView,
    private val onToggleKeyboard: () -> Unit,
    private val onPaste: () -> Unit
) : TerminalExtraKeys(terminalView) {

    override fun onTerminalExtraKeyButtonClick(
        view: View,
        key: String,
        ctrlDown: Boolean,
        altDown: Boolean,
        shiftDown: Boolean,
        fnDown: Boolean
    ) {
        when (key) {
            "KEYBOARD" -> { onToggleKeyboard(); return }
            "PASTE" -> { onPaste(); return }
            "DRAWER" -> return
            else -> super.onTerminalExtraKeyButtonClick(view, key, ctrlDown, altDown, shiftDown, fnDown)
        }
    }
}
