package expo.modules.termuxterminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ContextThemeWrapper
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import com.termux.shared.termux.extrakeys.ExtraKeysConstants.CONTROL_CHARS_ALIASES
import com.termux.shared.termux.extrakeys.ExtraKeysConstants.EXTRA_KEY_DISPLAY_MAPS
import com.termux.shared.termux.extrakeys.ExtraKeysInfo
import com.termux.shared.termux.extrakeys.ExtraKeysView
import com.termux.shared.termux.extrakeys.SpecialButton
import com.termux.shared.termux.terminal.io.BellHandler
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * A React Native / Expo native view hosting a full Termux terminal (the same engine used by
 * Termux and AndroidIDE): a [TerminalView] on top and an [ExtraKeysView] bar (ESC, TAB, CTRL,
 * ALT, arrows, ...) below it — exactly like Termux's terminal toolbar.
 *
 * The previous implementation was a bare [TerminalView] with stub clients and no extra keys,
 * which made the terminal unusable on a phone. This rewrite wires proper key handling, IME,
 * clipboard, bell, font scaling and JS events/commands.
 */
class TermuxTerminalView(context: Context, appContext: AppContext) :
    ExpoView(context, appContext), TerminalViewClient, TerminalSessionClient {

    companion object {
        private const val BG_COLOR = "#0D1117"
        private const val MIN_FONT_SIZE = 6
        private const val MAX_FONT_SIZE = 64
        private const val DEFAULT_FONT_SIZE = 13

        /** Default Termux-style 2-row extra keys (7 columns). Swipe up on a key for its popup. */
        private const val DEFAULT_EXTRA_KEYS =
            "[['ESC','/',{key:'-',popup:'|'},'HOME','UP','END','PGUP']," +
            "['TAB','CTRL','ALT','LEFT','DOWN','RIGHT','PGDN']]"
    }

    private val onTerminalEvent by EventDispatcher()

    private val terminalView: TerminalView
    private val extraKeysView: ExtraKeysView
    private var session: TerminalSession? = null

    private var fontSize: Int = DEFAULT_FONT_SIZE
    private var workingDirectory: String? = null
    private var initialCommand: String? = null
    private var initialCommandSent = false

    init {
        orientation = VERTICAL
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        setBackgroundColor(Color.parseColor(BG_COLOR))

        terminalView = TerminalView(context, null).apply {
            layoutParams = LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f)
            setBackgroundColor(Color.parseColor(BG_COLOR))
            setTextSize(fontSize)
            setTypeface(Typeface.MONOSPACE)
            isFocusable = true
            isFocusableInTouchMode = true
            keepScreenOn = true
        }
        addView(terminalView)

        // MaterialButton (used by ExtraKeysView) requires a Material Components theme, which the
        // host React Native activity may not provide, so wrap the context with one.
        val themedContext = ContextThemeWrapper(
            context,
            com.google.android.material.R.style.Theme_MaterialComponents
        )
        extraKeysView = ExtraKeysView(themedContext, null).apply {
            val rows = 2
            val heightPx = dp(40) * rows
            layoutParams = LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, heightPx)
            setButtonColors(0xFFE6EDF3.toInt(), 0xFF80DEEA.toInt(), 0x00000000, 0xFF30363D.toInt())
        }
        addView(extraKeysView)

        terminalView.setTerminalViewClient(this)
        extraKeysView.setExtraKeysViewClient(SkTerminalExtraKeys(terminalView, { toggleKeyboard() }, { pasteFromClipboard() }))
        reloadExtraKeys(DEFAULT_EXTRA_KEYS)

        startSession()
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    // ---------------------------------------------------------------------------------------------
    // Props (set from JS)
    // ---------------------------------------------------------------------------------------------

    fun setFontSizeProp(size: Int) {
        val clamped = size.coerceIn(MIN_FONT_SIZE, MAX_FONT_SIZE)
        if (clamped != fontSize) {
            fontSize = clamped
            terminalView.setTextSize(fontSize)
        }
    }

    fun setWorkingDirectory(dir: String?) { workingDirectory = dir }

    fun setInitialCommand(command: String?) {
        initialCommand = command
        initialCommandSent = false
        maybeSendInitialCommand()
    }

    fun setExtraKeys(json: String?) { reloadExtraKeys(json ?: DEFAULT_EXTRA_KEYS) }

    private var readOnlyMode = false

    /**
     * Read-only («viewer») mode: the extra-keys bar is hidden, the soft keyboard never
     * appears and key input is swallowed, so the terminal only shows output — every
     * action is launched by the app's own buttons (moderation-safe, no manual typing).
     */
    fun setReadOnly(value: Boolean) {
        readOnlyMode = value
        if (value) {
            extraKeysView.visibility = View.GONE
            hideKeyboard()
        } else {
            reloadExtraKeys(currentExtraKeysJson)
        }
    }

    private fun hideKeyboard() {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
        imm.hideSoftInputFromWindow(terminalView.windowToken, 0)
    }

    // ---------------------------------------------------------------------------------------------
    // Commands (called from JS via ref)
    // ---------------------------------------------------------------------------------------------

    fun writeText(text: String) {
        session?.write(text)
    }

    /** Paste the Android clipboard content into the terminal session. Returns true on success. */
    fun pasteFromClipboard(): Boolean {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        val clip = cm.primaryClip ?: return false
        if (clip.itemCount <= 0) return false
        val text = clip.getItemAt(0).coerceToText(context)?.toString() ?: return false
        if (text.isEmpty()) return false
        val current = session ?: return false
        if (!current.isRunning) return false
        val emulator = current.emulator ?: return false
        emulator.paste(text)
        return true
    }

    /** Copy the whole on-screen terminal transcript to the Android clipboard. */
    fun copyTranscriptToClipboard(): Boolean {
        val current = session ?: return false
        val emulator = current.emulator ?: return false
        val text = emulator.screen?.transcriptText ?: return false
        if (text.isBlank()) return false
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        cm.setPrimaryClip(ClipData.newPlainText("terminal transcript", text))
        return true
    }

    /**
     * Return the whole terminal transcript (scrollback included), or null.
     * Used by the build screen "share log" action: the full build output lives in the
     * native terminal, so the JS log array alone is not enough.
     */
    fun getTranscriptText(): String? {
        val current = session ?: return null
        val emulator = current.emulator ?: return null
        return emulator.screen?.transcriptText
    }

    /** Simulate pressing an extra key, e.g. "ENTER", "ESC", "TAB", "UP". */
    fun sendKey(key: String) {
        val code = com.termux.shared.termux.extrakeys.ExtraKeysConstants.PRIMARY_KEY_CODES_FOR_STRINGS[key]
        if (code != null) {
            val event = KeyEvent(0, 0, KeyEvent.ACTION_DOWN, code, 0, 0)
            terminalView.onKeyDown(code, event)
        } else {
            session?.write(key)
        }
    }

    fun restart() {
        session?.finishIfRunning()
        startSession()
    }

    fun toggleKeyboard() {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
        if (readOnlyMode) {
            // Read-only terminal: the keyboard must never appear, toggle only dismisses.
            imm.hideSoftInputFromWindow(terminalView.windowToken, 0)
            return
        }
        if (imm.isActive(terminalView)) {
            imm.hideSoftInputFromWindow(terminalView.windowToken, 0)
        } else {
            terminalView.requestFocus()
            imm.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private var currentExtraKeysJson: String = DEFAULT_EXTRA_KEYS

    private fun reloadExtraKeys(json: String) {
        try {
            currentExtraKeysJson = json
            // Пустой JSON ("[]") или read-only режим — скрыть панель спец-клавиш целиком
            // (терминал в режиме просмотра: только вывод, все действия — кнопками приложения).
            val empty = readOnlyMode || json.isBlank() || json.trim() == "[]" || json.trim() == "null"
            extraKeysView.visibility = if (empty) View.GONE else View.VISIBLE
            if (empty) return
            val displayMap = EXTRA_KEY_DISPLAY_MAPS.DEFAULT_CHAR_DISPLAY
            val info = ExtraKeysInfo(json, displayMap, CONTROL_CHARS_ALIASES)
            extraKeysView.reload(info, dp(40).toFloat())
        } catch (e: Exception) {
            logStackTraceWithMessage("ExtraKeys", "Failed to load extra keys", e)
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Session
    // ---------------------------------------------------------------------------------------------

    private fun startSession() {
        val appCtx = context.applicationContext
        val config = TerminalEnvironment.build(appCtx, workingDirectory)

        val newSession = TerminalSession(
            config.shellPath,
            config.cwd,
            config.args,
            config.env,
            null,
            this
        )
        session = newSession
        terminalView.attachSession(newSession)

        // Defer the event until the view is attached to the RN hierarchy so the JS callback exists.
        val shell = config.shellPath
        val cwd = config.cwd
        val bootstrap = config.isBootstrap
        val proot = config.isProot
        val pid = newSession.pid
        post {
            onTerminalEvent(
                mapOf(
                    "type" to "started",
                    "shell" to shell,
                    "cwd" to cwd,
                    "pid" to pid,
                    "bootstrap" to bootstrap,
                    "proot" to proot
                )
            )
        }

        maybeSendInitialCommand()

        postDelayed({
            // Read-only terminal: never pop the soft keyboard automatically.
            if (readOnlyMode) return@postDelayed
            terminalView.requestFocus()
            val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
        }, 250)
    }

    private fun maybeSendInitialCommand() {
        val cmd = initialCommand
        if (cmd.isNullOrEmpty() || initialCommandSent) return
        val s = session ?: return
        if (!s.isRunning || s.emulator == null) return
        initialCommandSent = true
        s.write("$cmd\n")
    }

    // =============================================================================================
    // TerminalViewClient
    // =============================================================================================

    override fun onScale(scale: Float): Float {
        if (scale < 0.9f || scale > 1.1f) {
            val newSize = (fontSize + if (scale > 1.0f) 1 else -1).coerceIn(MIN_FONT_SIZE, MAX_FONT_SIZE)
            if (newSize != fontSize) {
                fontSize = newSize
                terminalView.setTextSize(fontSize)
            }
            return 1.0f
        }
        return scale
    }

    override fun onSingleTapUp(e: MotionEvent?) {
        // Read-only: a tap never summons the soft keyboard (long-press selection still works).
        if (readOnlyMode) return
        terminalView.requestFocus()
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
    }

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false

    // Match the stock Termux default (InputType.TYPE_NULL). With char-based input
    // (TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) many soft keyboards hold every key in an
    // IME composing buffer and only flush it when Space is pressed, which makes typing
    // show nothing (or only spaces) until a word is committed. In TYPE_NULL mode the
    // keyboards send key events / commitText per character, exactly like in Termux.
    override fun shouldEnforceCharBasedInput(): Boolean = false

    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = true
    override fun copyModeChanged(copyMode: Boolean) {}

    override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean {
        // Read-only: consume keys (incl. hardware keyboards) so nothing reaches the PTY.
        // Software keyboard input is additionally blocked because the keyboard never opens.
        if (readOnlyMode) return true
        // Let the TerminalView handle standard key processing (arrows, ctrl combos, etc.).
        return false
    }

    override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false
    override fun onLongPress(event: MotionEvent?): Boolean = false

    // Read modifier state from the extra-keys bar (CTRL / ALT / SHIFT / FN buttons).
    override fun readControlKey(): Boolean =
        extraKeysView.readSpecialButton(SpecialButton.CTRL, true) == true

    override fun readAltKey(): Boolean =
        extraKeysView.readSpecialButton(SpecialButton.ALT, true) == true

    override fun readShiftKey(): Boolean =
        extraKeysView.readSpecialButton(SpecialButton.SHIFT, true) == true

    override fun readFnKey(): Boolean =
        extraKeysView.readSpecialButton(SpecialButton.FN, true) == true

    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean = readOnlyMode

    override fun onEmulatorSet() {
        maybeSendInitialCommand()
    }

    // Logging (TerminalViewClient)
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {
        android.util.Log.e(tag ?: "TermuxTerminal", message ?: "", e)
    }
    override fun logStackTrace(tag: String?, e: Exception?) {
        android.util.Log.e(tag ?: "TermuxTerminal", "", e)
    }

    // =============================================================================================
    // TerminalSessionClient
    // =============================================================================================

    override fun onTextChanged(changedSession: TerminalSession?) {
        terminalView.onScreenUpdated()
    }

    override fun onTitleChanged(changedSession: TerminalSession?) {
        onTerminalEvent(mapOf("type" to "title", "title" to (changedSession?.mSessionName ?: "")))
    }

    override fun onSessionFinished(finishedSession: TerminalSession?) {
        val exit = finishedSession?.exitStatus ?: -1
        onTerminalEvent(mapOf("type" to "exit", "exitCode" to exit))
    }

    override fun onCopyTextToClipboard(session: TerminalSession?, text: String?) {
        if (text.isNullOrEmpty()) return
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        cm.setPrimaryClip(ClipData.newPlainText("terminal", text))
    }

    override fun onPasteTextFromClipboard(session: TerminalSession?) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        val clip = cm.primaryClip ?: return
        if (clip.itemCount == 0) return
        val text = clip.getItemAt(0).coerceToText(context)?.toString() ?: return
        session?.write(text)
    }

    override fun onBell(session: TerminalSession?) {
        BellHandler.getInstance(context).doBell()
    }

    override fun onColorsChanged(session: TerminalSession?) {
        terminalView.onScreenUpdated()
    }

    override fun onTerminalCursorStateChange(state: Boolean) {}

    override fun getTerminalCursorStyle(): Int = TerminalEmulator.TERMINAL_CURSOR_STYLE_BLOCK

    // ---------------------------------------------------------------------------------------------

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        session?.finishIfRunning()
    }
}
