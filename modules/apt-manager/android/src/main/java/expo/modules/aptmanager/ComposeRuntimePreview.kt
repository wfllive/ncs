@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package expo.modules.aptmanager

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import android.webkit.WebView
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Professional real Jetpack Compose preview renderer.
 *
 * Renders the EXACT same visual model that the IDE's .kt generator produces.
 * Uses real Material 3 composables (Scaffold, TopAppBar, Card, TextField, etc)
 * with proper theme, full modifier support, state simulation and accurate layout.
 *
 * This is NOT a View-based approximation — it is genuine Compose running
 * inside an off-screen ComposeView and captured to bitmap.
 */
object ComposeRuntimePreview {

    data class PreviewConfig(
        val widthPx: Int,
        val heightPx: Int,
        val dark: Boolean,
        val backgroundColor: String?,
        val density: Float = 2.625f,
        val projectPrimary: String? = null,
        val projectSecondary: String? = null,
        val projectBackground: String? = null,
        val simulateState: Boolean = true,
        val interactive: Boolean = false,
        val actionBarTitle: String? = null,
        val showActionBar: Boolean = true,
        // Custom color roles parsed from the .kt's own lightColorScheme(...) /
        // darkColorScheme(...) definitions, keyed by role name (e.g. "primary").
        val lightScheme: Map<String, String>? = null,
        val darkScheme: Map<String, String>? = null
    )

    fun render(
        activity: Activity,
        treeJson: String,
        config: PreviewConfig
    ): String {
        val root = try {
            JSONObject(treeJson)
        } catch (e: Exception) {
            return errorBitmap(activity, "Invalid tree JSON", config)
        }

        val view = ComposeView(activity)
        if (activity is ComponentActivity) {
            view.setViewTreeLifecycleOwner(activity)
            view.setViewTreeSavedStateRegistryOwner(activity)
        }

        // Build the full Material theme from project config + dark mode
        view.setContent {
            val colorScheme = buildProfessionalColorScheme(
                dark = config.dark,
                primary = config.projectPrimary,
                secondary = config.projectSecondary,
                background = config.projectBackground,
                lightScheme = config.lightScheme,
                darkScheme = config.darkScheme
            )

            MaterialTheme(colorScheme = colorScheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = colorScheme.background
                ) {
                    Box(
                        modifier = Modifier
                            .widthIn(max = (config.widthPx / config.density).dp)
                            .heightIn(max = (config.heightPx / config.density).dp)
                    ) {
                        // Inject config-level actionBarTitle / showActionBar into root props
                        // so Scaffold synthesis always sees the screen metadata (from JS bridge).
                        val enrichedRoot = JSONObject(root.toString())
                        val rootProps = if (enrichedRoot.has("props")) enrichedRoot.optJSONObject("props") ?: JSONObject() else JSONObject()
                        if (config.actionBarTitle != null && config.actionBarTitle.isNotBlank()) {
                            rootProps.put("actionBarTitle", config.actionBarTitle)
                            rootProps.put("title", config.actionBarTitle)
                            rootProps.put("text", config.actionBarTitle)
                        }
                        rootProps.put("showActionBar", config.showActionBar)
                        enrichedRoot.put("props", rootProps)

                        ComposeNode(
                            node = enrichedRoot,
                            config = config,
                            level = 0
                        )
                    }
                }
            }
        }

        val host = activity.findViewById<ViewGroup>(android.R.id.content)
            ?: return errorBitmap(activity, "Preview host unavailable", config)

        view.translationX = -10000f
        host.addView(view, ViewGroup.LayoutParams(1, 1))

        return try {
            // Important: use AT_MOST for height to allow tall content to render fully
            val widthSpec = View.MeasureSpec.makeMeasureSpec(config.widthPx, View.MeasureSpec.EXACTLY)
            val heightSpec = View.MeasureSpec.makeMeasureSpec(config.heightPx, View.MeasureSpec.AT_MOST)

            view.measure(widthSpec, heightSpec)
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)

            val bitmap = Bitmap.createBitmap(
                view.measuredWidth.coerceAtLeast(1),
                view.measuredHeight.coerceAtLeast(1),
                Bitmap.Config.ARGB_8888
            )
            val canvas = Canvas(bitmap)
            view.draw(canvas)

            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            bitmap.recycle()

            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Throwable) {
            errorBitmap(activity, "Render error: ${e.message}", config)
        } finally {
            host.removeView(view)
            view.disposeComposition()
        }
    }

    private fun errorBitmap(activity: Activity, message: String, config: PreviewConfig): String {
        return try {
            val w = (config.widthPx / 2).coerceAtLeast(200)
            val h = (config.heightPx / 3).coerceAtLeast(120)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            c.drawColor(if (config.dark) AndroidColor.parseColor("#1F2937") else AndroidColor.parseColor("#F8FAFC"))
            val paint = android.graphics.Paint().apply {
                color = AndroidColor.parseColor("#EF4444")
                textSize = 28f
                isAntiAlias = true
            }
            c.drawText("PREVIEW ERROR", 24f, 40f, paint)
            c.drawText(message.take(60), 24f, 78f, paint.apply { textSize = 22f; color = AndroidColor.parseColor("#64748B") })
            Base64.encodeToString(
                ByteArrayOutputStream().apply { bmp.compress(Bitmap.CompressFormat.PNG, 100, this); bmp.recycle() }.toByteArray(),
                Base64.NO_WRAP
            )
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * Build the preview [ColorScheme] to be pixel-identical to the theme the
     * generated project actually declares.
     *
     * The generated `ui/theme/Theme.kt` calls:
     *   `lightColorScheme(primary = P, secondary = S, background = B)`
     *   `darkColorScheme(primary = P)`
     *
     * Crucially, only those specific roles are overridden. Every other role
     * (onPrimary, primaryContainer, onPrimaryContainer, surface, outline, ...)
     * keeps the Material 3 baseline default (the Purple "seed" palette from the
     * official `lightColorScheme()` / `darkColorScheme()`).
     *
     * We replicate that exact semantics by taking the unparameterized baseline
     * scheme and applying the SAME overrides the generator applies. We must NOT
     * re-derive container roles from the project primary — that is precisely
     * what made old previews diverge from the real app.
     */
    private fun buildProfessionalColorScheme(
        dark: Boolean,
        primary: String?,
        secondary: String?,
        background: String?,
        lightScheme: Map<String, String>?,
        darkScheme: Map<String, String>?
    ): ColorScheme {
        val baseline = if (dark) darkColorScheme() else lightColorScheme()

        // The .kt may declare its OWN complete theme:
        //   private val LightColors = lightColorScheme(primary = Color(0xFF...), ...)
        //   private val DarkColors  = darkColorScheme(...)
        //   MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, ...)
        // When the file supplies its own roles, we replicate them exactly so the
        // preview matches the real APK. Otherwise (no custom scheme) we fall back
        // to the plain baseline palette, which is what a plain
        // `lightColorScheme()/darkColorScheme()` AppTheme produces.
        val roles = if (dark) darkScheme else lightScheme
        if (roles != null && roles.isNotEmpty()) {
            return applySchemeRoles(baseline, roles)
        }

        // No custom scheme in the file: keep the baseline (the generated AppTheme
        // ignores project primary/secondary/background at runtime).
        return baseline
    }

    /** Overlay the given role->color hex map onto a baseline [ColorScheme]. */
    private fun applySchemeRoles(base: ColorScheme, roles: Map<String, String>): ColorScheme {
        fun c(key: String): Color? {
            val v = roles[key] ?: return null
            return try { Color(AndroidColor.parseColor(v)) } catch (_: Exception) { null }
        }
        return base.copy(
            primary = c("primary") ?: base.primary,
            onPrimary = c("onPrimary") ?: base.onPrimary,
            primaryContainer = c("primaryContainer") ?: base.primaryContainer,
            onPrimaryContainer = c("onPrimaryContainer") ?: base.onPrimaryContainer,
            secondary = c("secondary") ?: base.secondary,
            onSecondary = c("onSecondary") ?: base.onSecondary,
            secondaryContainer = c("secondaryContainer") ?: base.secondaryContainer,
            onSecondaryContainer = c("onSecondaryContainer") ?: base.onSecondaryContainer,
            tertiary = c("tertiary") ?: base.tertiary,
            onTertiary = c("onTertiary") ?: base.onTertiary,
            tertiaryContainer = c("tertiaryContainer") ?: base.tertiaryContainer,
            onTertiaryContainer = c("onTertiaryContainer") ?: base.onTertiaryContainer,
            background = c("background") ?: base.background,
            onBackground = c("onBackground") ?: base.onBackground,
            surface = c("surface") ?: base.surface,
            onSurface = c("onSurface") ?: base.onSurface,
            surfaceVariant = c("surfaceVariant") ?: base.surfaceVariant,
            onSurfaceVariant = c("onSurfaceVariant") ?: base.onSurfaceVariant,
            surfaceTint = c("surfaceTint") ?: base.surfaceTint,
            inversePrimary = c("inversePrimary") ?: base.inversePrimary,
            inverseSurface = c("inverseSurface") ?: base.inverseSurface,
            inverseOnSurface = c("inverseOnSurface") ?: base.inverseOnSurface,
            error = c("error") ?: base.error,
            onError = c("onError") ?: base.onError,
            errorContainer = c("errorContainer") ?: base.errorContainer,
            onErrorContainer = c("onErrorContainer") ?: base.onErrorContainer,
            outline = c("outline") ?: base.outline,
            outlineVariant = c("outlineVariant") ?: base.outlineVariant,
            scrim = c("scrim") ?: base.scrim,
            surfaceBright = c("surfaceBright") ?: base.surfaceBright,
            surfaceDim = c("surfaceDim") ?: base.surfaceDim,
            surfaceContainer = c("surfaceContainer") ?: base.surfaceContainer,
            surfaceContainerHigh = c("surfaceContainerHigh") ?: base.surfaceContainerHigh,
            surfaceContainerHighest = c("surfaceContainerHighest") ?: base.surfaceContainerHighest,
            surfaceContainerLow = c("surfaceContainerLow") ?: base.surfaceContainerLow,
            surfaceContainerLowest = c("surfaceContainerLowest") ?: base.surfaceContainerLowest
        )
    }

    private fun safeColor(hex: String?, fallback: Color): Color {
        if (hex.isNullOrBlank() || hex == "transparent") return fallback
        return try {
            Color(AndroidColor.parseColor(hex))
        } catch (_: Exception) {
            fallback
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    private fun ComposeNode(node: JSONObject, config: PreviewConfig, level: Int) {
        if (!node.has("type")) {
            Box(Modifier.fillMaxWidth().height(40.dp)) {
                Text("Invalid node", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
            }
            return
        }

        val type = node.optString("type", "Column")
        val props = node.optJSONObject("props") ?: JSONObject()
        val children = node.optJSONArray("children") ?: JSONArray()

        val mod = buildAdvancedModifier(props, config)

        // === TOP-LEVEL SCAFFOLD SYNTHESIS (for pixel-perfect parity) ===
        // Many trees have a plain Column/Row/Box as root. The generated .kt files almost always
        // wrap the screen body inside a Scaffold + TopAppBar when showActionBar is true.
        // When we are at the root (level==0) and metadata says we need an action bar, synthesize
        // the exact same header so the preview matches the real build 100%.
        if (level == 0) {
            val showActionBar = props.optBoolean("showActionBar", config.showActionBar)
            val titleFromConfigOrProps = listOf(
                config.actionBarTitle ?: "",
                props.optString("actionBarTitle", ""),
                props.optString("title", ""),
                props.optString("text", ""),
                props.optString("name", "")
            ).firstOrNull { it.isNotBlank() } ?: ""

            if (showActionBar && titleFromConfigOrProps.isNotBlank() && type != "Scaffold" && type != "Scafold") {
                // Render a real Scaffold + TopAppBar around the actual content root.
                // This produces the exact visual that the generator emits.
                Scaffold(
                    modifier = mod,
                    topBar = {
                        // A plain `TopAppBar(title = { Text(...) })` renders with the
                        // Material 3 default colors (surface container background,
                        // onSurface title) — not primary. Match that exactly.
                        TopAppBar(
                            title = {
                                Text(
                                    text = titleFromConfigOrProps,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        )
                    },
                    containerColor = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.background)
                ) { innerPadding ->
                    // Render original node content inside the scaffold padding
                    Column(
                        Modifier
                            .padding(innerPadding)
                            .fillMaxSize()
                    ) {
                        // Re-render the original node as content (avoid infinite recursion by calling with level+1)
                        when (type) {
                            "Column" -> {
                                Column(
                                    modifier = buildAdvancedModifier(props, config),
                                    verticalArrangement = spacedByOrTop(props),
                                    horizontalAlignment = horizontalAlignment(props)
                                ) { Children(children, config, level + 1) }
                            }
                            "Row" -> {
                                Row(
                                    modifier = buildAdvancedModifier(props, config),
                                    horizontalArrangement = spacedByOrStart(props),
                                    verticalAlignment = verticalAlignment(props)
                                ) { Children(children, config, level + 1) }
                            }
                            else -> {
                                // Fallback: just render children or the node itself
                                ComposeNode(node, config, level + 1)
                            }
                        }
                    }
                }
                return
            }
        }

        when (type) {
            "Scaffold", "Scafold" -> {
                val scaffoldBg = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.background)
                // Honor injected config + root props for exact match to generated Activity
                val showActionBar = props.optBoolean("showActionBar", config.showActionBar)

                // Professional: synthesize real TopAppBar from screen metadata when missing.
                // Priority: config (from JS) > root props (actionBarTitle/title/text/name) > default
                val hasExplicitTopBar = props.has("topBar") && props.optJSONObject("topBar") != null
                val screenTitle = listOf(
                    config.actionBarTitle ?: "",
                    props.optString("actionBarTitle", ""),
                    props.optString("title", ""),
                    props.optString("text", ""),
                    props.optString("name", "")
                ).firstOrNull { it.isNotBlank() } ?: ""

                Scaffold(
                    modifier = mod,
                    topBar = {
                        if (!showActionBar) return@Scaffold

                        when {
                            hasExplicitTopBar -> {
                                props.optJSONObject("topBar")?.let { ComposeNode(it, config, level + 1) }
                            }
                            screenTitle.isNotBlank() -> {
                                TopAppBar(
                                    title = {
                                        Text(
                                            text = screenTitle,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                )
                            }
                            else -> Unit
                        }
                    },
                    containerColor = scaffoldBg
                ) { innerPadding ->
                    Column(
                        Modifier
                            .padding(innerPadding)
                            .then(buildAdvancedModifier(props, config))
                    ) {
                        Children(children, config, level)
                    }
                }
            }

            "TopAppBar" -> {
                // Extremely robust + priority title extraction
                val titleText = listOf(
                    props.optString("actionBarTitle", ""),
                    props.optString("title", ""),
                    props.optString("text", ""),
                    props.optString("name", "")
                ).firstOrNull { it.isNotBlank() } ?: "App"

                val textSize = num(props, "textSize", 20f)

                // A plain M3 TopAppBar uses the surface container background and
                // onSurface content. Only override when the user explicitly sets a
                // backgroundColor / textColor on the component (e.g. AppTheme app bar).
                val explicitBg = props.optString("backgroundColor", "").takeIf { it.isNotBlank() && it != "transparent" }
                val explicitFg = props.optString("textColor", "").takeIf { it.isNotBlank() }
                val appBarColors = if (explicitBg != null || explicitFg != null) {
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = explicitBg?.let { safeColor(it, MaterialTheme.colorScheme.surface) }
                            ?: MaterialTheme.colorScheme.surface,
                        titleContentColor = explicitFg?.let { safeColor(it, MaterialTheme.colorScheme.onSurface) }
                            ?: MaterialTheme.colorScheme.onSurface,
                        navigationIconContentColor = explicitFg?.let { safeColor(it, MaterialTheme.colorScheme.onSurface) }
                            ?: MaterialTheme.colorScheme.onSurface,
                        actionIconContentColor = explicitFg?.let { safeColor(it, MaterialTheme.colorScheme.onSurface) }
                            ?: MaterialTheme.colorScheme.onSurface
                    )
                } else {
                    TopAppBarDefaults.topAppBarColors()
                }

                TopAppBar(
                    title = {
                        Text(
                            text = titleText,
                            fontSize = textSize.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    colors = appBarColors,
                    modifier = mod
                )
            }

            "Column" -> {
                Column(
                    modifier = mod,
                    verticalArrangement = spacedByOrTop(props),
                    horizontalAlignment = horizontalAlignment(props)
                ) {
                    // Honour Modifier.weight(...) on direct children, exactly like a
                    // real Column { Box(Modifier.weight(1f)) { … } }.
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i) ?: continue
                        val w = child.optJSONObject("props")?.opt("weight")
                        if (w != null) {
                            val f = if (w is Number) w.toFloat() else (w as? String)?.toFloatOrNull()
                            if (f != null) {
                                Box(
                                    Modifier
                                        .weight(f)
                                        .fillMaxWidth()
                                ) { ComposeNode(child, config, level + 1) }
                                continue
                            }
                        }
                        ComposeNode(child, config, level + 1)
                    }
                }
            }

            "Row" -> {
                Row(
                    modifier = mod,
                    horizontalArrangement = spacedByOrStart(props),
                    verticalAlignment = verticalAlignment(props)
                ) {
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i) ?: continue
                        val w = child.optJSONObject("props")?.opt("weight")
                        if (w != null) {
                            val f = if (w is Number) w.toFloat() else (w as? String)?.toFloatOrNull()
                            if (f != null) {
                                Box(
                                    Modifier
                                        .weight(f)
                                        .fillMaxHeight()
                                ) { ComposeNode(child, config, level + 1) }
                                continue
                            }
                        }
                        ComposeNode(child, config, level + 1)
                    }
                }
            }

            "LazyColumn" -> {
                LazyColumn(
                    modifier = mod,
                    verticalArrangement = spacedByOrTop(props)
                ) {
                    items(children.length()) { idx ->
                        ComposeNode(children.getJSONObject(idx), config, level + 1)
                    }
                }
            }

            "LazyRow" -> {
                LazyRow(
                    modifier = mod,
                    horizontalArrangement = spacedByOrStart(props)
                ) {
                    items(children.length()) { idx ->
                        ComposeNode(children.getJSONObject(idx), config, level + 1)
                    }
                }
            }

            "Box" -> {
                Box(
                    modifier = mod,
                    contentAlignment = contentAlignment(props)
                ) {
                    Children(children, config, level)
                }
            }

            "Card", "ElevatedCard", "OutlinedCard" -> {
                // Material 3: Card and ElevatedCard use RoundedCornerShape(12.dp)
                // (ShapeDefaults.Medium) by default and apply their elevation via
                // CardDefaults — never via a manual Modifier.shadow (that produced a
                // doubled, inaccurate shadow).
                val shape = if (props.has("borderRadius"))
                    RoundedCornerShape(num(props, "borderRadius", 12f).dp)
                else
                    RoundedCornerShape(12.dp)

                val isElevated = type == "ElevatedCard"
                val isOutlined = type == "OutlinedCard"
                val defaultElevation = if (isElevated) 1f else 0f
                val elevation = num(props, "elevation", defaultElevation).dp
                val explicitBg = props.optString("backgroundColor", "").takeIf { it.isNotBlank() && it != "transparent" }

                val baseMod = mod
                val content: @Composable () -> Unit = {
                    Column(Modifier.padding(num(props, "padding", if (isOutlined) 16f else 12f).dp)) {
                        Children(children, config, level)
                    }
                }

                // A plain `Card(modifier = …)` uses CardDefaults.*Colors() defaults
                // (surfaceContainerHighest for Card, surfaceContainerLow for
                // ElevatedCard, surface for OutlinedCard). Only override when the
                // user explicitly set a backgroundColor.
                when (type) {
                    "OutlinedCard" -> OutlinedCard(
                        modifier = baseMod,
                        shape = shape,
                        colors = explicitBg?.let { CardDefaults.outlinedCardColors(containerColor = safeColor(it, MaterialTheme.colorScheme.surface)) }
                            ?: CardDefaults.outlinedCardColors()
                    ) { content() }
                    "ElevatedCard" -> ElevatedCard(
                        modifier = baseMod,
                        shape = shape,
                        colors = explicitBg?.let { CardDefaults.elevatedCardColors(containerColor = safeColor(it, MaterialTheme.colorScheme.surfaceContainerLow)) }
                            ?: CardDefaults.elevatedCardColors(),
                        elevation = CardDefaults.elevatedCardElevation(defaultElevation = elevation)
                    ) { content() }
                    else -> Card(
                        modifier = baseMod,
                        shape = shape,
                        colors = explicitBg?.let { CardDefaults.cardColors(containerColor = safeColor(it, MaterialTheme.colorScheme.surfaceContainerHighest)) }
                            ?: CardDefaults.cardColors(),
                        elevation = CardDefaults.cardElevation(defaultElevation = elevation)
                    ) { content() }
                }
            }

            "Surface" -> {
                Surface(
                    modifier = mod,
                    shape = RoundedCornerShape(num(props, "borderRadius", 0f).dp),
                    color = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.surface),
                    tonalElevation = num(props, "elevation", 1f).dp
                ) {
                    Children(children, config, level)
                }
            }

            "Text" -> {
                val text = props.optString("text", "")
                val size = num(props, "textSize", 16f)
                val ts = props.optString("textStyle")
                val weight = when (ts) {
                    "bold" -> FontWeight.Bold
                    "medium" -> FontWeight.Medium
                    else -> FontWeight.Normal
                }
                val style = when (ts) {
                    "display" -> MaterialTheme.typography.displaySmall
                    "headline" -> MaterialTheme.typography.headlineSmall
                    "title" -> MaterialTheme.typography.titleMedium
                    "label" -> MaterialTheme.typography.labelLarge
                    "body" -> MaterialTheme.typography.bodyLarge
                    else -> MaterialTheme.typography.bodyMedium
                }
                val color = if (props.has("textColor") && props.optString("textColor").isNotBlank())
                    safeColor(props.optString("textColor"), MaterialTheme.colorScheme.onSurface)
                else
                    // Inherit the content color (e.g. onPrimary inside a Button,
                    // onSurface inside a Card) instead of forcing onSurface.
                    LocalContentColor.current
                val align = when (props.optString("textAlign")) {
                    "center" -> TextAlign.Center
                    "end" -> TextAlign.End
                    else -> TextAlign.Start
                }
                val lineHeight = numOrNull(props, "lineHeight")?.sp ?: TextUnit.Unspecified
                val letterSpacing = numOrNull(props, "letterSpacing")?.sp ?: TextUnit.Unspecified
                val maxLines = numOrNull(props, "maxLines")?.toInt() ?: 6

                Text(
                    text = text,
                    modifier = mod,
                    color = color,
                    fontSize = size.sp,
                    fontWeight = weight,
                    lineHeight = lineHeight,
                    letterSpacing = letterSpacing,
                    fontStyle = if (ts == "italic") FontStyle.Italic else FontStyle.Normal,
                    textAlign = align,
                    style = style,
                    maxLines = maxLines,
                    overflow = if (maxLines > 0) TextOverflow.Ellipsis else TextOverflow.Clip
                )
            }

            "Button" -> {
                val bg = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.primary)
                val contentColor = safeColor(props.optString("textColor"), MaterialTheme.colorScheme.onPrimary)
                val textSize = num(props, "textSize", 15f)
                val enabled = props.optBoolean("enabled", true)

                // M3 filled button uses the fully-rounded (pill) shape by default
                // (ButtonMediumTokens.ContainerShapeRound = CornerFull). Honour an
                // explicit borderRadius, otherwise render the pill exactly like a
                // plain `Button { … }` in the generated app.
                val shape = if (props.has("borderRadius"))
                    RoundedCornerShape(num(props, "borderRadius", 12f).dp)
                else
                    RoundedCornerShape(50.dp)

                Button(
                    onClick = {},
                    enabled = enabled,
                    modifier = mod.defaultMinSize(minHeight = 40.dp),
                    shape = shape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = bg,
                        contentColor = contentColor
                    )
                    // contentPadding intentionally omitted: ButtonDefaults.ContentPadding
                    // reproduces the real M3 metrics (24.dp horizontal / 8.dp vertical).
                ) {
                    if (children.length() > 0) {
                        // Icon+label (or label) buttons: children now inherit onPrimary
                        // via LocalContentColor, so rendering them is faithful.
                        Children(children, config, level)
                    } else {
                        Text(
                            text = resolveButtonText(props, children),
                            fontSize = textSize.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }

            "FilledTonalButton" -> {
                val textSize = num(props, "textSize", 15f)
                val enabled = props.optBoolean("enabled", true)
                val shape = if (props.has("borderRadius"))
                    RoundedCornerShape(num(props, "borderRadius", 12f).dp)
                else
                    RoundedCornerShape(50.dp)
                val explicitBg = props.optString("backgroundColor", "").takeIf { it.isNotBlank() && it != "transparent" }
                val explicitFg = props.optString("textColor", "").takeIf { it.isNotBlank() }

                FilledTonalButton(
                    onClick = {},
                    enabled = enabled,
                    modifier = mod.defaultMinSize(minHeight = 40.dp),
                    shape = shape,
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = explicitBg?.let { safeColor(it, MaterialTheme.colorScheme.secondaryContainer) }
                            ?: MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = explicitFg?.let { safeColor(it, MaterialTheme.colorScheme.onSecondaryContainer) }
                            ?: MaterialTheme.colorScheme.onSecondaryContainer
                    )
                ) {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(resolveButtonText(props, children), fontSize = textSize.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }

            "ElevatedButton" -> {
                val textSize = num(props, "textSize", 15f)
                val enabled = props.optBoolean("enabled", true)
                val shape = if (props.has("borderRadius"))
                    RoundedCornerShape(num(props, "borderRadius", 12f).dp)
                else
                    RoundedCornerShape(50.dp)
                val explicitBg = props.optString("backgroundColor", "").takeIf { it.isNotBlank() && it != "transparent" }
                val explicitFg = props.optString("textColor", "").takeIf { it.isNotBlank() }

                ElevatedButton(
                    onClick = {},
                    enabled = enabled,
                    modifier = mod.defaultMinSize(minHeight = 40.dp),
                    shape = shape,
                    colors = ButtonDefaults.elevatedButtonColors(
                        containerColor = explicitBg?.let { safeColor(it, MaterialTheme.colorScheme.surfaceContainerLow) }
                            ?: MaterialTheme.colorScheme.surfaceContainerLow,
                        contentColor = explicitFg?.let { safeColor(it, MaterialTheme.colorScheme.primary) }
                            ?: MaterialTheme.colorScheme.primary
                    )
                ) {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(resolveButtonText(props, children), fontSize = textSize.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }

            "TextButton" -> {
                val textSize = num(props, "textSize", 15f)
                val enabled = props.optBoolean("enabled", true)

                TextButton(onClick = {}, enabled = enabled, modifier = mod) {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(resolveButtonText(props, children), fontSize = textSize.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            "OutlinedButton" -> {
                val textSize = num(props, "textSize", 15f)
                val enabled = props.optBoolean("enabled", true)
                val shape = if (props.has("borderRadius"))
                    RoundedCornerShape(num(props, "borderRadius", 12f).dp)
                else
                    RoundedCornerShape(50.dp)

                OutlinedButton(
                    onClick = {},
                    enabled = enabled,
                    modifier = mod.defaultMinSize(minHeight = 40.dp),
                    shape = shape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                ) {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(
                        resolveButtonText(props, children),
                        color = safeColor(props.optString("textColor"), MaterialTheme.colorScheme.primary),
                        fontSize = textSize.sp
                    )
                }
            }

            "FloatingActionButton" -> {
                val text = resolveButtonText(props, children)
                val bg = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.primaryContainer)

                FloatingActionButton(onClick = {}, modifier = mod, containerColor = bg) {
                    if (text.isNotBlank() && text != "FloatingActionButton" && text != "Button") {
                        Text(
                            text.take(1),
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
            }

            "IconButton" -> {
                IconButton(onClick = {}, modifier = mod) {
                    // A plain `IconButton { Icon(...) }` typically wraps one Icon child.
                    if (children.length() > 0) {
                        Children(children, config, level)
                    } else {
                        val iconName = props.optString("iconName", "Star")
                        Icon(
                            imageVector = iconForName(iconName),
                            contentDescription = props.optString("contentDescription", null),
                            tint = safeColor(props.optString("tint"), MaterialTheme.colorScheme.onSurfaceVariant)
                        )
                    }
                }
            }

            "Badge" -> {
                // M3 Badge — a small filled pill used for counts (e.g. "5").
                val label = listOf(props.optString("text", ""), props.optString("label", "")).firstOrNull { it.isNotBlank() }
                val badgeColor = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.error)
                val contentColor = safeColor(props.optString("textColor"), MaterialTheme.colorScheme.onError)
                if (label != null) {
                    Badge(modifier = mod, containerColor = badgeColor) {
                        Text(label, color = contentColor, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                } else {
                    Badge(modifier = mod, containerColor = badgeColor) {
                        Children(children, config, level)
                    }
                }
            }

            "TextField", "OutlinedTextField" -> {
                var value by remember { mutableStateOf(props.optString("text", "")) }

                OutlinedTextField(
                    value = value,
                    onValueChange = { if (config.simulateState) value = it },
                    modifier = mod,
                    label = { if (props.has("label")) Text(props.optString("label")) },
                    placeholder = { if (props.has("hint")) Text(props.optString("hint")) },
                    singleLine = props.optBoolean("singleLine", true),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary
                    )
                )
            }

            "Image" -> {
                val w = num(props, "width", 120f).dp
                val h = num(props, "height", 120f).dp
                val bg = safeColor(props.optString("backgroundColor"), Color(0xFFE5E7EB))

                Box(
                    modifier = mod
                        .size(w, h)
                        .background(bg, RoundedCornerShape(num(props, "borderRadius", 8f).dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Image,
                        contentDescription = props.optString("contentDescription", "Image"),
                        tint = Color(0xFF64748B),
                        modifier = Modifier.size(36.dp)
                    )
                }
            }

            "Checkbox" -> {
                var checked by remember { mutableStateOf(props.optBoolean("checked", false)) }
                Row(
                    modifier = mod,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = checked,
                        onCheckedChange = { if (config.simulateState) checked = it }
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(props.optString("text", ""), color = MaterialTheme.colorScheme.onSurface)
                }
            }

            "Switch" -> {
                var checked by remember { mutableStateOf(props.optBoolean("checked", false)) }
                Row(
                    modifier = mod,
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(props.optString("text", ""))
                    Switch(
                        checked = checked,
                        onCheckedChange = { if (config.simulateState) checked = it }
                    )
                }
            }

            "LinearProgressIndicator" -> {
                val progress = (num(props, "progress", 0.5f)).coerceIn(0f, 1f)
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = mod.height(num(props, "height", 6f).dp),
                    color = safeColor(props.optString("color"), MaterialTheme.colorScheme.primary),
                    trackColor = safeColor(props.optString("trackColor"), MaterialTheme.colorScheme.surfaceVariant)
                )
            }

            "CircularProgressIndicator" -> {
                CircularProgressIndicator(
                    modifier = mod.size(num(props, "width", 42f).dp),
                    color = safeColor(props.optString("color"), MaterialTheme.colorScheme.primary),
                    strokeWidth = 4.dp
                )
            }

            "HorizontalDivider" -> {
                HorizontalDivider(
                    modifier = mod.height(num(props, "height", 1f).dp),
                    color = safeColor(props.optString("color"), MaterialTheme.colorScheme.outlineVariant),
                    thickness = num(props, "height", 1f).dp
                )
            }

            "Spacer" -> {
                Spacer(modifier = mod.height(num(props, "height", 16f).dp))
            }

            "Icon" -> {
                val iconName = props.optString("iconName", "Star")
                val size = num(props, "size", 28f).dp
                val tint = if (props.has("tint") && props.optString("tint").isNotBlank())
                    safeColor(props.optString("tint"), MaterialTheme.colorScheme.primary)
                else
                    LocalContentColor.current

                Icon(
                    imageVector = iconForName(iconName),
                    contentDescription = props.optString("contentDescription", null),
                    modifier = mod.size(size),
                    tint = tint
                )
            }

            "WebView" -> {
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = false
                            loadUrl(props.optString("url", "https://example.com"))
                        }
                    },
                    modifier = mod.height(num(props, "height", 180f).dp)
                )
            }

            "Slider" -> {
                val value = (num(props, "progress", 0.5f)).coerceIn(0f, 1f)
                Slider(
                    value = value,
                    onValueChange = {},
                    modifier = mod,
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                )
            }

            "RadioButton" -> {
                val selected = props.optBoolean("checked", props.optBoolean("selected", false))
                Row(modifier = mod, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = selected, onClick = {})
                    if (props.has("text")) {
                        Spacer(Modifier.width(8.dp))
                        Text(props.optString("text", ""), color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            }

            "AssistChip", "SuggestionChip" -> {
                val label = resolveButtonText(props, children)
                val chip: @Composable () -> Unit = {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(label, fontSize = num(props, "textSize", 14f).sp)
                }
                if (type == "AssistChip") AssistChip(onClick = {}, modifier = mod, label = chip)
                else SuggestionChip(onClick = {}, modifier = mod, label = chip)
            }

            "FilterChip", "InputChip" -> {
                val label = resolveButtonText(props, children)
                val selected = props.optBoolean("selected", false)
                val chip: @Composable () -> Unit = {
                    if (children.length() > 0) Children(children, config, level)
                    else Text(label, fontSize = num(props, "textSize", 14f).sp)
                }
                if (type == "FilterChip") FilterChip(selected = selected, onClick = {}, modifier = mod, label = chip)
                else InputChip(selected = selected, onClick = {}, modifier = mod, label = chip)
            }

            "NavigationBar" -> {
                val navColor = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.surfaceContainer)
                NavigationBar(modifier = mod, containerColor = navColor) {
                    // NavigationBarItem is a RowScope extension — render it inside the
                    // NavigationBar's RowScope so the receiver is correct.
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i) ?: continue
                        if (child.optString("type") == "NavigationBarItem") {
                            NavigationBarItemNode(child, config, level)
                        } else {
                            ComposeNode(child, config, level + 1)
                        }
                    }
                }
            }

            "NavigationBarItem" -> {
                // Only valid inside a NavigationBar (RowScope). As a defensive fallback
                // (e.g. parsed from invalid code) render a simple icon+label column.
                val selected = props.optBoolean("selected", false)
                val label = listOf(props.optString("label", ""), props.optString("text", "")).firstOrNull { it.isNotBlank() }
                Column(modifier = mod, horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = iconForName(props.optString("iconName", "Home")),
                        contentDescription = null,
                        tint = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (label != null) Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            "BottomAppBar" -> {
                val barColor = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.surfaceContainer)
                BottomAppBar(modifier = mod, containerColor = barColor) {
                    Children(children, config, level)
                }
            }

            "PrimaryTabRow", "SecondaryTabRow", "TabRow" -> {
                val selectedIndex = num(props, "selectedTabIndex", 0f).toInt()
                // Render an M3-style tab row. We build it with a Row + indicator
                // line instead of the real TabRow composable to avoid depending on
                // TabRowScope (whose receiver differs across Material3 versions).
                Row(
                    modifier = mod
                        .fillMaxWidth()
                        .background(safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.surface))
                ) {
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i) ?: continue
                        if (child.optString("type") != "Tab") {
                            ComposeNode(child, config, level + 1)
                            continue
                        }
                        val cProps = child.optJSONObject("props") ?: JSONObject()
                        val cChildren = child.optJSONArray("children") ?: JSONArray()
                        val selected = cProps.optBoolean("selected", i == selectedIndex)
                        val label = resolveButtonText(cProps, cChildren)
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 48.dp)
                                .clickable(onClick = {}),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Text(
                                label,
                                fontSize = num(cProps, "textSize", 14f).sp,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(4.dp))
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(2.dp)
                                    .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                            )
                        }
                    }
                }
            }

            "Tab" -> {
                // Standalone Tab (outside a TabRow). Render a simple label.
                val selected = props.optBoolean("selected", false)
                val label = resolveButtonText(props, children)
                Column(
                    modifier = mod.defaultMinSize(minHeight = 48.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        label,
                        fontSize = num(props, "textSize", 14f).sp,
                        fontWeight = FontWeight.Medium,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            "VerticalDivider" -> {
                VerticalDivider(
                    modifier = mod.width(num(props, "width", 1f).dp).height(num(props, "height", 16f).dp),
                    color = safeColor(props.optString("color"), MaterialTheme.colorScheme.outlineVariant),
                    thickness = num(props, "width", 1f).dp
                )
            }

            "AlertDialog" -> {
                val title = listOf(props.optString("title", ""), props.optString("text", "")).firstOrNull { it.isNotBlank() }
                val body = props.optString("text", "")
                AlertDialog(
                    onDismissRequest = {},
                    modifier = mod,
                    title = { if (title != null) Text(title, fontWeight = FontWeight.SemiBold) },
                    text = { if (body != title) Text(body) },
                    confirmButton = {
                        TextButton(onClick = {}) { Text("OK") }
                    }
                )
            }

            "DropdownMenu" -> {
                DropdownMenu(expanded = true, onDismissRequest = {}, modifier = mod) {
                    Children(children, config, level)
                }
            }

            "DropdownMenuItem" -> {
                val label = resolveButtonText(props, children)
                DropdownMenuItem(
                    text = { if (children.length() > 0) Children(children, config, level) else Text(label) },
                    onClick = {},
                    modifier = mod
                )
            }

            "BasicTextField", "SelectableText" -> {
                // BasicTextField is stable; SelectableText is experimental foundation,
                // so render it as a plain Text for a safe static preview.
                if (type == "BasicTextField") {
                    BasicTextField(
                        value = props.optString("text", ""),
                        onValueChange = {},
                        modifier = mod,
                        singleLine = props.optBoolean("singleLine", true)
                    )
                } else {
                    Text(
                        props.optString("text", ""),
                        modifier = mod,
                        fontSize = num(props, "textSize", 14f).sp
                    )
                }
            }

            "ExtendedFloatingActionButton" -> {
                val label = resolveButtonText(props, children)
                val bg = safeColor(props.optString("backgroundColor"), MaterialTheme.colorScheme.primaryContainer)
                ExtendedFloatingActionButton(
                    text = { Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) },
                    icon = {
                        if (children.length() > 0) Children(children, config, level)
                        else Icon(Icons.Default.Add, contentDescription = null)
                    },
                    onClick = {},
                    modifier = mod,
                    containerColor = bg
                )
            }

            "RangeSlider" -> {
                val start = num(props, "startValue", 0.2f).coerceIn(0f, 1f)
                val end = num(props, "endValue", 0.8f).coerceIn(0f, 1f)
                RangeSlider(
                    value = start..end,
                    onValueChange = {},
                    modifier = mod,
                    valueRange = 0f..1f,
                    colors = SliderDefaults.colors(
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                )
            }

            "Snackbar" -> {
                val msg = resolveButtonText(props, children)
                val actionLabel = props.optString("actionLabel", "").takeIf { it.isNotBlank() }
                Snackbar(
                    modifier = mod,
                    action = {
                        if (actionLabel != null) TextButton(onClick = {}) { Text(actionLabel) }
                    }
                ) {
                    Text(msg)
                }
            }

            "FlowRow" -> {
                FlowRow(
                    modifier = mod,
                    horizontalArrangement = spacedByOrStart(props),
                    verticalArrangement = spacedByOrTop(props)
                ) { Children(children, config, level) }
            }

            "FlowColumn" -> {
                FlowColumn(
                    modifier = mod,
                    verticalArrangement = spacedByOrTop(props)
                ) { Children(children, config, level) }
            }

            "SingleChoiceSegmentedButtonRow" -> {
                SingleChoiceSegmentedButtonRow(modifier = mod) {
                    for (i in 0 until children.length()) {
                        val child = children.optJSONObject(i) ?: continue
                        if (child.optString("type") == "SegmentedButton") {
                            SegmentedButtonNode(child, config, level)
                        } else {
                            ComposeNode(child, config, level + 1)
                        }
                    }
                }
            }

            "SegmentedButton" -> {
                // Standalone SegmentedButton (outside the row) — defensive fallback.
                val selected = props.optBoolean("selected", false)
                val label = resolveButtonText(props, children)
                Column(modifier = mod, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        label,
                        fontSize = num(props, "textSize", 13f).sp,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            "ModalNavigationDrawer", "DismissibleNavigationDrawer", "PermanentNavigationDrawer" -> {
                // Static "open drawer" preview: a left drawer panel (the experimental
                // ModalNavigationDrawer itself animates and is non-trivial to drive in an
                // off-screen static view, so we render the open state faithfully).
                Box(modifier = mod.fillMaxSize()) {
                    Surface(
                        modifier = Modifier
                            .align(Alignment.CenterStart)
                            .width(280.dp)
                            .fillMaxHeight(),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        tonalElevation = 2.dp
                    ) {
                        Column(Modifier.padding(vertical = 8.dp)) {
                            Children(children, config, level)
                        }
                    }
                }
            }

            "ModalDrawerSheet", "DrawerSheet" -> {
                Surface(
                    modifier = mod.width(280.dp).fillMaxHeight(),
                    color = MaterialTheme.colorScheme.surfaceContainerLow
                ) {
                    Column(Modifier.padding(vertical = 8.dp)) {
                        Children(children, config, level)
                    }
                }
            }

            "NavigationDrawerItem", "DrawerItem" -> {
                val selected = props.optBoolean("selected", false)
                val label = resolveButtonText(props, children)
                Row(
                    modifier = mod
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 2.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .clickable(onClick = {})
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val iconChild = children.optJSONObject(0)
                    if (iconChild != null && iconChild.optString("type") == "Icon") {
                        Icon(
                            imageVector = iconForName(iconChild.optJSONObject("props")?.optString("iconName") ?: "Home"),
                            contentDescription = null,
                            modifier = Modifier.size(24.dp),
                            tint = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else if (children.length() > 0) {
                        Children(children, config, level)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(
                        label,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                        color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurface
                    )
                }
            }

            "ModalBottomSheet", "BottomSheet", "StandardBottomSheet" -> {
                // Static expanded bottom sheet with a drag handle (the animated
                // ModalBottomSheet is driven by a coroutine state we can't drive here).
                Surface(
                    modifier = mod.fillMaxWidth(),
                    shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    tonalElevation = 2.dp
                ) {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Box(
                            Modifier
                                .align(Alignment.CenterHorizontally)
                                .width(36.dp)
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
                        )
                        Spacer(Modifier.height(10.dp))
                        Children(children, config, level)
                    }
                }
            }

            "DatePicker", "DateRangePicker", "DatePickerDialog" -> {
                // Static, recognizable calendar preview (the real DatePicker is a large
                // experimental component; a simple grid keeps the build version-safe).
                val title = listOf(props.optString("title", ""), props.optString("text", ""))
                    .firstOrNull { it.isNotBlank() } ?: if (type == "DateRangePicker") "Select range" else "Select date"
                Surface(
                    modifier = mod.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 1.dp
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        Spacer(Modifier.height(12.dp))
                        // Weekday header
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            for (d in listOf("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")) {
                                Text(d, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        for (row in 0..3) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                for (col in 1..7) {
                                    Box(Modifier.size(34.dp), contentAlignment = Alignment.Center) {
                                        val day = row * 7 + col
                                        if (day in 1..28) {
                                            Text(
                                                "$day",
                                                fontSize = 12.sp,
                                                color = if (day == 15) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                                                modifier = if (day == 15) Modifier
                                                    .size(32.dp)
                                                    .clip(CircleShape)
                                                    .background(MaterialTheme.colorScheme.primaryContainer)
                                                else Modifier
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = {}) { Text("Cancel") }
                            Spacer(Modifier.width(4.dp))
                            TextButton(onClick = {}) { Text("OK") }
                        }
                    }
                }
            }

            "SearchBar" -> {
                val query = props.optString("query", props.optString("text", ""))
                Surface(
                    modifier = mod.fillMaxWidth(),
                    shape = RoundedCornerShape(28.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh
                ) {
                    Row(
                        Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(8.dp))
                        BasicTextField(
                            value = query,
                            onValueChange = {},
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 14.sp)
                        )
                        if (query.isNotBlank()) Icon(Icons.Default.Close, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            else -> {
                // Fallback: render as column of children + label
                Column(modifier = mod) {
                    Text(
                        "[$type]",
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        modifier = Modifier.padding(4.dp)
                    )
                    Children(children, config, level)
                }
            }
        }
    }

    @Composable
    private fun Children(children: JSONArray, config: PreviewConfig, level: Int) {
        for (i in 0 until children.length()) {
            val child = try {
                children.getJSONObject(i)
            } catch (_: Exception) {
                continue
            }
            ComposeNode(child, config, level + 1)
        }
    }

    /** Render a NavigationBarItem inside a NavigationBar's RowScope. */
    @Composable
    private fun RowScope.NavigationBarItemNode(node: JSONObject, config: PreviewConfig, level: Int) {
        val props = node.optJSONObject("props") ?: JSONObject()
        val selected = props.optBoolean("selected", false)
        val label = listOf(props.optString("label", ""), props.optString("text", "")).firstOrNull { it.isNotBlank() }
        val iconChild = node.optJSONArray("children")?.optJSONObject(0)
        val iconName = iconChild?.optJSONObject("props")?.optString("iconName") ?: props.optString("iconName", "Home")
        NavigationBarItem(
            selected = selected,
            onClick = {},
            modifier = buildAdvancedModifier(props, config),
            icon = {
                Icon(
                    imageVector = iconForName(iconName),
                    contentDescription = null,
                    tint = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            label = { if (label != null) Text(label, fontSize = 10.sp) }
        )
    }

    /** Render a SegmentedButton inside a SingleChoiceSegmentedButtonRow's scope. */
    @Composable
    private fun SingleChoiceSegmentedButtonRowScope.SegmentedButtonNode(node: JSONObject, config: PreviewConfig, level: Int) {
        val props = node.optJSONObject("props") ?: JSONObject()
        val selected = props.optBoolean("selected", false)
        val nodeChildren = node.optJSONArray("children") ?: JSONArray()
        val label = resolveButtonText(props, nodeChildren)
        SegmentedButton(
            selected = selected,
            onClick = {},
            shape = RoundedCornerShape(20.dp),
            modifier = buildAdvancedModifier(props, config),
            label = { Text(label, fontSize = num(props, "textSize", 13f).sp) }
        )
    }

    private fun buildAdvancedModifier(props: JSONObject, config: PreviewConfig): Modifier {
        var m: Modifier = Modifier

        // === Width / Height (incl. fillMaxWidth(fraction)) ===
        val wObj = props.opt("width")
        when {
            wObj == "match_parent" || wObj == "fillMaxWidth" -> m = m.fillMaxWidth()
            wObj is Number -> m = m.width(wObj.toFloat().dp)
            wObj is String -> {
                val f = wObj.toFloatOrNull()
                when {
                    f != null -> m = m.width(f.dp)
                    wObj.contains("fillMaxWidth") -> {
                        // fillMaxWidth(0.5f) — capture the fraction in the parser
                        val frac = Regex("\\(([0-9.]+)\\)").find(wObj)?.groupValues?.get(1)?.toFloatOrNull()
                        m = if (frac != null) m.fillMaxWidth(frac) else m.fillMaxWidth()
                    }
                }
            }
        }
        val hObj = props.opt("height")
        when {
            hObj == "match_parent" || hObj == "fillMaxHeight" -> m = m.fillMaxHeight()
            hObj is Number -> m = m.height(hObj.toFloat().dp)
            hObj is String -> {
                val f = hObj.toFloatOrNull()
                when {
                    f != null -> m = m.height(f.dp)
                    hObj.contains("fillMaxHeight") -> {
                        val frac = Regex("\\(([0-9.]+)\\)").find(hObj)?.groupValues?.get(1)?.toFloatOrNull()
                        m = if (frac != null) m.fillMaxHeight(frac) else m.fillMaxHeight()
                    }
                }
            }
        }

        // === Size(w, h) ===
        val sizeW = props.opt("sizeWidth")
        val sizeH = props.opt("sizeHeight")
        if (sizeW != null || sizeH != null) {
            val w = sizeW?.let { if (it is Number) it.toFloat().dp else try { (it as String).toFloat().dp } catch (_: Exception) { 0.dp } } ?: Dp.Unspecified
            val h = sizeH?.let { if (it is Number) it.toFloat().dp else try { (it as String).toFloat().dp } catch (_: Exception) { 0.dp } } ?: Dp.Unspecified
            if (w != Dp.Unspecified && h != Dp.Unspecified) m = m.size(w, h)
            else if (w != Dp.Unspecified) m = m.width(w)
            else if (h != Dp.Unspecified) m = m.height(h)
        }

        // === widthIn / heightIn ===
        val widthInMin = numOrNull(props, "widthInMin"); val widthInMax = numOrNull(props, "widthInMax")
        if (widthInMin != null || widthInMax != null) {
            m = m.widthIn(widthInMin?.dp ?: Dp.Unspecified, widthInMax?.dp ?: Dp.Unspecified)
        }
        val heightInMin = numOrNull(props, "heightInMin"); val heightInMax = numOrNull(props, "heightInMax")
        if (heightInMin != null || heightInMax != null) {
            m = m.heightIn(heightInMin?.dp ?: Dp.Unspecified, heightInMax?.dp ?: Dp.Unspecified)
        }

        // === Aspect ratio ===
        val ratio = numOrNull(props, "aspectRatio")
        if (ratio != null) m = m.aspectRatio(ratio)

        // === Padding (all / horizontal / vertical / start/end/top/bottom) ===
        val pad = num(props, "padding", 0f)
        if (pad > 0) m = m.padding(pad.dp)
        val padH = numOrNull(props, "paddingHorizontal")
        val padV = numOrNull(props, "paddingVertical")
        if (padH != null || padV != null) {
            m = m.padding(horizontal = padH?.dp ?: 0.dp, vertical = padV?.dp ?: 0.dp)
        }
        val padStart = numOrNull(props, "paddingStart"); val padEnd = numOrNull(props, "paddingEnd")
        val padTop = numOrNull(props, "paddingTop"); val padBottom = numOrNull(props, "paddingBottom")
        if (padStart != null || padEnd != null || padTop != null || padBottom != null) {
            m = m.padding(
                start = padStart?.dp ?: 0.dp,
                end = padEnd?.dp ?: 0.dp,
                top = padTop?.dp ?: 0.dp,
                bottom = padBottom?.dp ?: 0.dp
            )
        }

        // === Offset ===
        val offX = numOrNull(props, "offsetX"); val offY = numOrNull(props, "offsetY")
        if (offX != null || offY != null) {
            m = m.offset(x = offX?.dp ?: 0.dp, y = offY?.dp ?: 0.dp)
        }

        // === Background ===
        val bg = props.optString("backgroundColor", "")
        if (bg.isNotBlank() && bg != "transparent") {
            m = m.background(safeColor(bg, Color.Transparent))
        }

        // === Border radius (clip) + border ===
        val radius = num(props, "borderRadius", 0f)
        if (radius > 0) {
            m = m.clip(RoundedCornerShape(radius.dp))
        }
        val borderColor = props.optString("borderColor", "")
        val borderWidth = numOrNull(props, "borderWidth")
        if (borderColor.isNotBlank() && borderWidth != null && borderWidth > 0) {
            m = m.border(
                borderWidth.dp,
                safeColor(borderColor, Color.Black),
                if (radius > 0) RoundedCornerShape(radius.dp) else RoundedCornerShape(0.dp)
            )
        }

        // === Elevation / shadow ===
        val elev = num(props, "elevation", 0f)
        if (elev > 0) {
            val r = radius.dp.coerceAtLeast(4.dp)
            m = m.shadow(elev.dp, RoundedCornerShape(r))
        }

        // === Clickable simulation ===
        if (props.has("onClick")) {
            m = m.clickable { /* no-op in static preview */ }
        }

        return m
    }

    /** Like [num] but returns null when the prop is absent / not a number. */
    private fun numOrNull(p: JSONObject, key: String): Float? {
        val v = p.opt(key) ?: return null
        return try {
            when (v) {
                is Number -> v.toFloat()
                is String -> v.toFloatOrNull()
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun spacedByOrTop(props: JSONObject) =
        if (props.has("spacing")) Arrangement.spacedBy(num(props, "spacing", 0f).dp) else Arrangement.Top

    private fun spacedByOrStart(props: JSONObject) =
        if (props.has("spacing")) Arrangement.spacedBy(num(props, "spacing", 0f).dp) else Arrangement.Start

    private fun horizontalAlignment(props: JSONObject): Alignment.Horizontal {
        return when (props.optString("horizontalAlignment", "start")) {
            "center" -> Alignment.CenterHorizontally
            "end" -> Alignment.End
            else -> Alignment.Start
        }
    }

    private fun verticalAlignment(props: JSONObject): Alignment.Vertical {
        return when (props.optString("verticalAlignment", "top")) {
            "center" -> Alignment.CenterVertically
            "bottom" -> Alignment.Bottom
            else -> Alignment.Top
        }
    }

    private fun contentAlignment(props: JSONObject): Alignment {
        return when (props.optString("contentAlignment", "topStart")) {
            "center" -> Alignment.Center
            "topCenter" -> Alignment.TopCenter
            "bottomCenter" -> Alignment.BottomCenter
            "centerStart" -> Alignment.CenterStart
            "centerEnd" -> Alignment.CenterEnd
            "topEnd" -> Alignment.TopEnd
            "bottomStart" -> Alignment.BottomStart
            "bottomEnd" -> Alignment.BottomEnd
            else -> Alignment.TopStart
        }
    }

    private fun resolveButtonText(props: JSONObject, children: JSONArray): String {
        val direct = props.optString("text", "").trim()
        if (direct.isNotEmpty()) return direct

        for (i in 0 until children.length()) {
            val c = children.optJSONObject(i) ?: continue
            if (c.optString("type") == "Text") {
                val t = c.optJSONObject("props")?.optString("text", "") ?: ""
                if (t.isNotBlank()) return t
            }
        }
        return "Button"
    }

    private fun num(p: JSONObject, key: String, fallback: Float): Float {
        return try {
            when (val v = p.opt(key)) {
                is Number -> v.toFloat()
                is String -> v.toFloatOrNull() ?: fallback
                else -> fallback
            }
        } catch (_: Exception) {
            fallback
        }
    }

    private fun iconForName(name: String): ImageVector {
        return when (name.lowercase().replace("_", "").replace("-", "")) {
            "star", "favorite", "starfilled" -> Icons.Filled.Star
            "home" -> Icons.Filled.Home
            "settings" -> Icons.Filled.Settings
            "person", "account", "accountcircle" -> Icons.Filled.Person
            "search" -> Icons.Filled.Search
            "add", "plus" -> Icons.Filled.Add
            "addcircle", "addbox" -> Icons.Filled.AddCircle
            "delete", "trash" -> Icons.Filled.Delete
            "edit", "create", "editnote" -> Icons.Filled.Edit
            "check", "done", "checkcircle" -> Icons.Filled.Check
            "close", "clear", "closefilled" -> Icons.Filled.Close
            "arrowback", "arrowleft", "keyboardarrowleft" -> Icons.Filled.ArrowBack
            "arrowforward", "arrowright", "keyboardarrowright" -> Icons.Filled.ArrowForward
            "arrowup", "keyboardarrowup" -> Icons.Filled.ArrowUpward
            "arrowdown", "keyboardarrowdown" -> Icons.Filled.ArrowDownward
            "arrowdropdown" -> Icons.Filled.ArrowDropDown
            "menu" -> Icons.Filled.Menu
            "info", "infofilled" -> Icons.Filled.Info
            "list" -> Icons.Filled.List
            "email", "mail", "message" -> Icons.Filled.Email
            "phone", "call" -> Icons.Filled.Phone
            "calendar", "date", "datetoday", "daterange" -> Icons.Filled.DateRange
            "image", "photo", "imagelist" -> Icons.Filled.Image
            "notifications", "notificationsfilled" -> Icons.Filled.Notifications
            "favorite", "favoritefilled" -> Icons.Filled.Favorite
            "thumbup" -> Icons.Filled.ThumbUp
            "warning", "error", "errorfilled" -> Icons.Filled.Warning
            "lock", "lockfilled", "security" -> Icons.Filled.Lock
            "logout", "exit" -> Icons.Filled.Logout
            "share" -> Icons.Filled.Share
            "send", "sendfilled" -> Icons.Filled.Send
            "download", "downloadfilled" -> Icons.Filled.Download
            "upload" -> Icons.Filled.Upload
            "refresh", "sync", "cached" -> Icons.Filled.Refresh
            "cart", "shoppingcart", "shoppingbag" -> Icons.Filled.ShoppingCart
            "play", "playarrow", "playcircle" -> Icons.Filled.PlayArrow
            "pause" -> Icons.Filled.Pause
            "location", "place", "pin", "mappin" -> Icons.Filled.LocationOn
            "face", "facefilled", "emoticon" -> Icons.Filled.Face
            "link" -> Icons.Filled.Link
            "morevert", "more", "morevertical" -> Icons.Filled.MoreVert
            "morehoriz" -> Icons.Filled.MoreHoriz
            "wifi" -> Icons.Filled.Wifi
            "cloud" -> Icons.Filled.Cloud
            "folder", "folderfilled" -> Icons.Filled.Folder
            "flag", "flagfilled" -> Icons.Filled.Flag
            "history", "restore" -> Icons.Filled.History
            "map" -> Icons.Filled.Map
            "video", "videocam", "videocamfilled" -> Icons.Filled.Videocam
            "mic", "keyboardvoice" -> Icons.Filled.Mic
            "volume", "volumeup" -> Icons.Filled.VolumeUp
            else -> Icons.Filled.Star
        }
    }
}
