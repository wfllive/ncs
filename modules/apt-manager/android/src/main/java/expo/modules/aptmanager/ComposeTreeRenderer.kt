package expo.modules.aptmanager

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.Rect
import android.graphics.Typeface
import android.text.TextUtils
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import androidx.cardview.widget.CardView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Renders a Compose Studio component tree (the same JSON model that
 * composeProject.js turns into Kotlin @Composable code) into a real Android
 * View hierarchy, draws it into a Bitmap, and returns the PNG as Base64.
 *
 * The point of this renderer is to remove the "fake" preview: instead of
 * approximating Jetpack Compose with React Native <View> elements, the
 * editor asks the Android framework to lay out the same tree the user's
 * generated code would build at runtime. Spacing, padding, Material text
 * styles, weights, and the status bar / action bar all come from the real
 * Android UI toolkit.
 */
object ComposeTreeRenderer {

    private const val DEFAULT_DENSITY = 2.625f // ~420 dpi phone baseline

    fun render(
        context: Context,
        treeJson: String,
        widthPx: Int,
        heightPx: Int,
        density: Float = DEFAULT_DENSITY,
        backgroundColor: String? = null,
        isDark: Boolean = false,
    ): String {
        val root = JSONObject(treeJson)
        val host = FrameLayout(context)
        val widthSpec = View.MeasureSpec.makeMeasureSpec(widthPx, View.MeasureSpec.EXACTLY)
        // heightSpec = AT_MOST so the bitmap is tall enough to fit the whole
        // tree without forcing a fake phone height. Callers decide heightPx.
        val heightSpec = View.MeasureSpec.makeMeasureSpec(heightPx, View.MeasureSpec.AT_MOST)

        val rootView = buildView(context, root, isDark)
        host.addView(
            rootView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
        )
        host.setBackgroundColor(parseColor(backgroundColor ?: "#F8FAFC", isDark))
        host.measure(widthSpec, heightSpec)
        host.layout(0, 0, host.measuredWidth, host.measuredHeight)

        val bitmap = Bitmap.createBitmap(
            host.measuredWidth.coerceAtLeast(1),
            host.measuredHeight.coerceAtLeast(1),
            Bitmap.Config.ARGB_8888,
        )
        val canvas = Canvas(bitmap)
        host.draw(canvas)

        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        bitmap.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun buildView(context: Context, node: JSONObject, isDark: Boolean): View {
        val rawType = node.optString("type", "Column")
        // Legacy visual projects stored this container as `Scafold`. Both
        // spellings are handled here as a last line of defence, even if a
        // caller bypasses the JavaScript tree sanitizer.
        val type = when (rawType) {
            "Scaffold", "Scafold" -> "Column"
            else -> rawType
        }
        val props = node.optJSONObject("props") ?: JSONObject()
        val children = node.optJSONArray("children")

        return when (type) {
            "Column" -> buildColumn(context, props, children, isDark)
            "Row" -> buildRow(context, props, children, isDark)
            "Box" -> buildBox(context, props, children, isDark)
            "LazyColumn" -> buildLazyColumn(context, props, children, isDark)
            "Card" -> buildCard(context, props, children, isDark)
            "Text" -> buildText(context, props, isDark)
            "Button" -> buildButton(context, props, isDark)
            "OutlinedTextField" -> buildTextField(context, props, isDark)
            "Image" -> buildImage(context, props)
            "Checkbox" -> buildCheckbox(context, props, isDark)
            "Switch" -> buildSwitch(context, props, isDark)
            "LinearProgressIndicator" -> buildLinearProgress(context, props)
            "CircularProgressIndicator" -> buildCircularProgress(context, props)
            "HorizontalDivider" -> buildDivider(context, props)
            "Spacer" -> buildSpacer(context, props)
            "Icon" -> buildIcon(context, props)
            "WebView" -> buildWebViewStub(context, props)
            else -> buildUnknown(context, type)
        }
    }

    private fun buildColumn(
        context: Context, props: JSONObject, children: JSONArray?, isDark: Boolean
    ): View {
        val container = LinearLayout(context)
        container.orientation = LinearLayout.VERTICAL
        applyCommonContainer(container, props)
        container.gravity = parseVerticalGravity(props.optString("verticalAlignment"))
        val spacing = dp(context, props.optDouble("spacing", 0.0))
        if (children != null) for (i in 0 until children.length()) {
            val childNode = children.getJSONObject(i)
            val childProps = childNode.optJSONObject("props") ?: JSONObject()
            val child = buildView(context, childNode, isDark)
            val lp = LinearLayout.LayoutParams(
                parseSize(context, childProps, "width", LinearLayout.LayoutParams.MATCH_PARENT),
                parseSize(context, childProps, "height", LinearLayout.LayoutParams.WRAP_CONTENT),
            )
            if (i > 0) lp.topMargin = spacing
            container.addView(child, lp)
        }
        return wrapScrollIfNeeded(context, container, props)
    }

    private fun buildRow(
        context: Context, props: JSONObject, children: JSONArray?, isDark: Boolean
    ): View {
        val container = LinearLayout(context)
        container.orientation = LinearLayout.HORIZONTAL
        applyCommonContainer(container, props)
        container.gravity = parseVerticalGravity(props.optString("verticalAlignment"))
        container.gravity = container.gravity or parseHorizontalGravity(props.optString("horizontalAlignment"))
        val spacing = dp(context, props.optDouble("spacing", 0.0))
        if (children != null) for (i in 0 until children.length()) {
            val childNode = children.getJSONObject(i)
            val childProps = childNode.optJSONObject("props") ?: JSONObject()
            val child = buildView(context, childNode, isDark)
            val lp = LinearLayout.LayoutParams(
                parseSize(context, childProps, "width", LinearLayout.LayoutParams.WRAP_CONTENT),
                parseSize(context, childProps, "height", LinearLayout.LayoutParams.WRAP_CONTENT),
            )
            if (i > 0) lp.leftMargin = spacing
            container.addView(child, lp)
        }
        return container
    }

    private fun buildBox(
        context: Context, props: JSONObject, children: JSONArray?, isDark: Boolean
    ): View {
        val container = FrameLayout(context)
        applyCommonContainer(container, props)
        if (children != null) for (i in 0 until children.length()) {
            val child = buildView(context, children.getJSONObject(i), isDark)
            val lp = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                parseGravity(props.optString("contentAlignment")),
            )
            container.addView(child, lp)
        }
        return container
    }

    private fun buildLazyColumn(
        context: Context, props: JSONObject, children: JSONArray?, isDark: Boolean
    ): View {
        return buildColumn(context, props, children, isDark)
    }

    private fun buildCard(
        context: Context, props: JSONObject, children: JSONArray?, isDark: Boolean
    ): View {
        val card = CardView(context)
        // CardView expects Float for both cardElevation and radius (pixels).
        card.cardElevation = dpToFloat(context, props.optDouble("elevation", 2.0))
        card.radius = dpToFloat(context, props.optDouble("borderRadius", 12.0))
        card.setCardBackgroundColor(parseColor(props.optString("backgroundColor", "#FFFFFF"), isDark))
        applyPadding(card, props)
        val inner = LinearLayout(context)
        inner.orientation = LinearLayout.VERTICAL
        if (children != null) for (i in 0 until children.length()) {
            inner.addView(buildView(context, children.getJSONObject(i), isDark))
        }
        card.addView(
            inner,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )
        return card
    }

    private fun buildText(context: Context, props: JSONObject, isDark: Boolean): View {
        val text = TextView(context)
        text.text = props.optString("text", "")
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, props.optDouble("textSize", 16.0).toFloat())
        text.setTextColor(parseColor(props.optString("textColor", "#111827"), isDark))
        when (props.optString("textStyle")) {
            "bold" -> text.setTypeface(text.typeface, Typeface.BOLD)
            "italic" -> text.setTypeface(text.typeface, Typeface.ITALIC)
        }
        when (props.optString("textAlign")) {
            "center" -> text.textAlignment = View.TEXT_ALIGNMENT_CENTER
            "end" -> text.textAlignment = View.TEXT_ALIGNMENT_VIEW_END
        }
        text.maxLines = 4
        text.ellipsize = TextUtils.TruncateAt.END
        applyPadding(text, props)
        return text
    }

    private fun buildButton(context: Context, props: JSONObject, isDark: Boolean): View {
        val wrapper = LinearLayout(context)
        wrapper.orientation = LinearLayout.VERTICAL
        applyPadding(wrapper, props)
        val button = Button(context)
        button.text = props.optString("text", "")
        button.setTextColor(parseColor(props.optString("textColor", "#FFFFFF"), isDark))
        button.setBackgroundColor(parseColor(props.optString("backgroundColor", "#4F46E5"), isDark))
        button.minHeight = dp(context, 44.0)
        button.isAllCaps = false
        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        wrapper.addView(button, lp)
        return wrapper
    }

    private fun buildTextField(context: Context, props: JSONObject, isDark: Boolean): View {
        val wrapper = LinearLayout(context)
        wrapper.orientation = LinearLayout.VERTICAL
        applyPadding(wrapper, props)
        val label = props.optString("label", "")
        if (label.isNotEmpty()) {
            val labelView = TextView(context)
            labelView.text = label
            labelView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.0f)
            labelView.setTextColor(parseColor("#4F46E5", isDark))
            wrapper.addView(labelView)
        }
        val edit = EditText(context)
        edit.setText(props.optString("text", ""))
        edit.hint = props.optString("hint", "")
        edit.minHeight = dp(context, 48.0)
        edit.setSingleLine(true)
        wrapper.addView(
            edit,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )
        return wrapper
    }

    private fun buildImage(context: Context, props: JSONObject): View {
        val image = ImageView(context)
        val width = parseSize(context, props, "width", 120)
        val height = parseSize(context, props, "height", 120)
        image.layoutParams = ViewGroup.LayoutParams(width, height)
        image.setBackgroundColor(parseColor(props.optString("backgroundColor", "#E5E7EB"), false))
        // Placeholder square (no remote fetches inside the renderer).
        image.setColorFilter(
            PorterDuffColorFilter(parseColor("#94A3B8", false), PorterDuff.Mode.SRC_IN)
        )
        image.scaleType = ImageView.ScaleType.CENTER_INSIDE
        return image
    }

    private fun buildCheckbox(context: Context, props: JSONObject, isDark: Boolean): View {
        val row = LinearLayout(context)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        val checkbox = CheckBox(context)
        checkbox.isChecked = props.optBoolean("checked", false)
        val label = TextView(context)
        label.text = props.optString("text", "")
        label.setTextColor(parseColor(props.optString("textColor", "#111827"), isDark))
        row.addView(checkbox)
        row.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return row
    }

    private fun buildSwitch(context: Context, props: JSONObject, isDark: Boolean): View {
        val row = LinearLayout(context)
        row.orientation = LinearLayout.HORIZONTAL
        row.gravity = Gravity.CENTER_VERTICAL
        val label = TextView(context)
        label.text = props.optString("text", "")
        label.setTextColor(parseColor(props.optString("textColor", "#111827"), isDark))
        val sw = Switch(context)
        sw.isChecked = props.optBoolean("checked", false)
        row.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(sw)
        return row
    }

    private fun buildLinearProgress(context: Context, props: JSONObject): View {
        val container = LinearLayout(context)
        container.orientation = LinearLayout.VERTICAL
        container.setBackgroundColor(parseColor(props.optString("trackColor", "#E5E7EB"), false))
        val progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal)
        progress.max = 100
        val value = props.optDouble("progress", 0.0)
        progress.progress = if (value <= 1.0) (value * 100).toInt() else value.toInt()
        progress.isIndeterminate = false
        val color = parseColor(props.optString("color", "#4F46E5"), false)
        progress.progressTintList = android.content.res.ColorStateList.valueOf(color)
        container.addView(
            progress,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(context, props.optDouble("height", 8.0))
            )
        )
        return container
    }

    private fun buildCircularProgress(context: Context, props: JSONObject): View {
        val size = dp(context, props.optDouble("width", 48.0))
        val bar = ProgressBar(context, null, android.R.attr.progressBarStyleLarge)
        bar.isIndeterminate = true
        val color = parseColor(props.optString("color", "#4F46E5"), false)
        bar.indeterminateTintList = android.content.res.ColorStateList.valueOf(color)
        bar.layoutParams = ViewGroup.LayoutParams(size, size)
        return bar
    }

    private fun buildDivider(context: Context, props: JSONObject): View {
        val view = View(context)
        view.setBackgroundColor(parseColor(props.optString("color", "#D1D5DB"), false))
        view.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(context, props.optDouble("height", 1.0))
        )
        return view
    }

    private fun buildSpacer(context: Context, props: JSONObject): View {
        val spacer = View(context)
        spacer.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(context, props.optDouble("height", 16.0))
        )
        return spacer
    }

    private fun buildIcon(context: Context, props: JSONObject): View {
        // Without vector assets we paint a star-like glyph with a Paint-based
        // placeholder. The renderer is offline; it cannot fetch MDI fonts.
        val view = IconPlaceholderView(
            context,
            color = parseColor(props.optString("tint", "#4F46E5"), false),
            sizeDp = props.optDouble("size", 28.0).toFloat(),
        )
        view.layoutParams = ViewGroup.LayoutParams(
            dp(context, props.optDouble("size", 28.0).toFloat()),
            dp(context, props.optDouble("size", 28.0).toFloat()),
        )
        return view
    }

    private fun buildWebViewStub(context: Context, props: JSONObject): View {
        val container = LinearLayout(context)
        container.orientation = LinearLayout.VERTICAL
        container.setBackgroundColor(parseColor("#E8F1F5", false))
        container.gravity = Gravity.CENTER
        val label = TextView(context)
        label.text = "WebView"
        label.setTypeface(label.typeface, Typeface.BOLD)
        container.addView(label)
        val url = TextView(context)
        url.text = props.optString("url", "")
        url.maxLines = 1
        url.ellipsize = TextUtils.TruncateAt.END
        container.addView(url)
        container.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(context, props.optDouble("height", 180.0))
        )
        return container
    }

    private fun buildUnknown(context: Context, type: String): View {
        val text = TextView(context)
        text.text = "Unsupported: $type"
        text.setTextColor(Color.RED)
        return text
    }

    // ---------- helpers ----------

    private fun applyCommonContainer(view: ViewGroup, props: JSONObject) {
        val bg = props.optString("backgroundColor", "")
        if (bg.isNotEmpty() && bg != "transparent") {
            view.setBackgroundColor(parseColor(bg, false))
        }
        applyPadding(view, props)
    }

    private fun applyPadding(view: View, props: JSONObject) {
        val padding = dp(view.context, props.optDouble("padding", 0.0)).toInt()
        view.setPadding(padding, padding, padding, padding)
    }

    private fun dp(context: Context, value: Double): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics,
        ).toInt()
    }

    private fun dp(context: Context, value: Float): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            context.resources.displayMetrics,
        ).toInt()
    }

    private fun dpToFloat(context: Context, value: Double): Float {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics,
        )
    }

    private fun parseSize(
        context: Context,
        props: JSONObject,
        key: String,
        default: Int,
    ): Int {
        val raw = props.opt(key)
        return when (raw) {
            is String -> when (raw) {
                "match_parent" -> ViewGroup.LayoutParams.MATCH_PARENT
                "wrap_content" -> ViewGroup.LayoutParams.WRAP_CONTENT
                else -> dp(context, raw.toDoubleOrNull() ?: 0.0)
            }
            is Number -> if (raw.toDouble() <= 0.0) default else dp(context, raw.toDouble())
            else -> default
        }
    }

    private fun parseColor(value: String, isDark: Boolean): Int {
        return try {
            android.graphics.Color.parseColor(value)
        } catch (e: Exception) {
            if (isDark) Color.parseColor("#1F2937") else Color.parseColor("#FFFFFF")
        }
    }

    private fun parseVerticalGravity(value: String?): Int {
        return when (value?.lowercase()) {
            "center" -> Gravity.CENTER_VERTICAL
            "bottom" -> Gravity.BOTTOM
            else -> Gravity.TOP
        }
    }

    private fun parseHorizontalGravity(value: String?): Int {
        return when (value?.lowercase()) {
            "center" -> Gravity.CENTER_HORIZONTAL
            "end", "right" -> Gravity.END
            else -> Gravity.START
        }
    }

    private fun parseGravity(value: String?): Int {
        if (value.isNullOrBlank()) return Gravity.TOP or Gravity.START
        return when (value.lowercase()) {
            "topleft", "topstart" -> Gravity.TOP or Gravity.START
            "topcenter" -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
            "topright", "topend" -> Gravity.TOP or Gravity.END
            "centerleft", "centerstart" -> Gravity.CENTER_VERTICAL or Gravity.START
            "center" -> Gravity.CENTER
            "centerright", "centerend" -> Gravity.CENTER_VERTICAL or Gravity.END
            "bottomleft", "bottomstart" -> Gravity.BOTTOM or Gravity.START
            "bottomcenter" -> Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            "bottomright", "bottomend" -> Gravity.BOTTOM or Gravity.END
            else -> Gravity.TOP or Gravity.START
        }
    }

    private fun wrapScrollIfNeeded(context: Context, view: View, props: JSONObject): View {
        if (props.optString("scrollable") != "true") return view
        return ScrollView(context).apply {
            addView(view)
            isFillViewport = true
        }
    }

    private class IconPlaceholderView(
        context: Context,
        private val color: Int,
        private val sizeDp: Float,
    ) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = this@IconPlaceholderView.color
            style = Paint.Style.FILL
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val r = (minOf(width, height) / 2f) * 0.85f
            // Five-point star
            val outer = r
            val inner = r * 0.45f
            val path = android.graphics.Path()
            for (i in 0 until 10) {
                val angle = Math.toRadians((-90.0 + i * 36.0))
                val radius = if (i % 2 == 0) outer else inner
                val x = (cx + radius * Math.cos(angle)).toFloat()
                val y = (cy + radius * Math.sin(angle)).toFloat()
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            path.close()
            canvas.drawPath(path, paint)
        }
    }
}
