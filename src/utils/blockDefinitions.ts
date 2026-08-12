// Block definitions for React / JSX (instead of Jetpack Compose / Kotlin)
export const blockCategories = {
  STATE: { id: 'STATE', label: 'State & Variables', color: '#FF8C1A', icon: 'server-outline' },
  LAYOUT: { id: 'LAYOUT', label: 'Layout (div, section)', color: '#78C478', icon: 'layers-outline' },
  UI: { id: 'UI', label: 'UI Components', color: '#A06CD5', icon: 'cube-outline' },
  MODIFIER: { id: 'MODIFIER', label: 'CSS / Style', color: '#5AD9D9', icon: 'color-palette-outline' },
  EVENT: { id: 'EVENT', label: 'Events & Handlers', color: '#FFAB19', icon: 'flash-outline' },
  TEXT_STYLE: { id: 'TEXT_STYLE', label: 'Text Style', color: '#5CB1D6', icon: 'text-outline' },
  LIST: { id: 'LIST', label: 'Lists & Data', color: '#FF6680', icon: 'list-outline' },
  CONTROL: { id: 'CONTROL', label: 'Control Flow', color: '#E066FF', icon: 'git-compare-outline' },
  ANIMATION: { id: 'ANIMATION', label: 'Animations (CSS / Framer)', color: '#9B59B6', icon: 'sync-outline' },
  NAVIGATION: { id: 'NAVIGATION', label: 'Navigation (React Router)', color: '#66B2FF', icon: 'navigate-outline' },
  MEDIA: { id: 'MEDIA', label: 'Images & Media', color: '#66CCFF', icon: 'image-outline' },
};

// Map block definition IDs to their required imports
// This ensures only needed imports are added to the generated file
const BLOCK_IMPORTS = {
  // React / JSX
  div_layout: ['react'],
  use_state: ['react'],
  scaffold_with_bottombar: ['androidx.compose.material3.*'],
  elevated_card: ['androidx.compose.material3.*', 'androidx.compose.material3.CardDefaults'],
  outlined_card: ['androidx.compose.material3.*'],
  button: ['androidx.compose.material3.*'],
  outlined_button: ['androidx.compose.material3.*'],
  text_button: ['androidx.compose.material3.*'],
  icon_button: ['androidx.compose.material3.*', 'androidx.compose.material.icons.Icons', 'androidx.compose.material.icons.filled.*'],
  extended_fab: ['androidx.compose.material3.*', 'androidx.compose.material.icons.Icons', 'androidx.compose.material.icons.filled.*'],
  alert_dialog: ['androidx.compose.material3.*'],
  modal_bottom_sheet: ['androidx.compose.material3.*'],
  textfield: ['androidx.compose.material3.*'],
  checkbox: ['androidx.compose.material3.*'],
  switch: ['androidx.compose.material3.*'],
  slider: ['androidx.compose.material3.*'],
  linear_progress: ['androidx.compose.material3.*'],
  circular_progress: ['androidx.compose.material3.*'],
  divider: ['androidx.compose.material3.*'],

  // Text style
  text: ['androidx.compose.material3.*', 'androidx.compose.ui.text.font.FontWeight'],
  text_with_variable: ['androidx.compose.material3.*', 'androidx.compose.ui.text.font.FontWeight'],
  text_html: ['androidx.compose.ui.text.buildAnnotatedString'],
  font_weight_bold: ['androidx.compose.ui.text.font.FontWeight'],
  font_weight_normal: ['androidx.compose.ui.text.font.FontWeight'],
  font_weight_light: ['androidx.compose.ui.text.font.FontWeight'],

  // Layout
  column: ['androidx.compose.foundation.layout.*', 'androidx.compose.ui.Alignment'],
  row: ['androidx.compose.foundation.layout.*', 'androidx.compose.ui.Alignment'],
  box: ['androidx.compose.foundation.layout.*', 'androidx.compose.ui.Alignment'],
  surface: ['androidx.compose.material3.*'],
  lazy_column: ['androidx.compose.foundation.lazy.*'],
  lazy_row: ['androidx.compose.foundation.lazy.*'],

  // Modifiers
  modifier_padding: ['androidx.compose.foundation.layout.*'],
  modifier_padding_all: ['androidx.compose.foundation.layout.*'],
  modifier_fill_max_size: ['androidx.compose.foundation.layout.*'],
  modifier_fill_max_width: ['androidx.compose.foundation.layout.*'],
  modifier_fill_max_height: ['androidx.compose.foundation.layout.*'],
  modifier_size: ['androidx.compose.foundation.layout.*'],
  modifier_width: ['androidx.compose.foundation.layout.*'],
  modifier_height: ['androidx.compose.foundation.layout.*'],
  modifier_vertical_scroll: ['androidx.compose.foundation.verticalScroll', 'androidx.compose.foundation.rememberScrollState'],
  modifier_horizontal_scroll: ['androidx.compose.foundation.horizontalScroll', 'androidx.compose.foundation.rememberScrollState'],
  modifier_border: ['androidx.compose.foundation.border', 'androidx.compose.ui.graphics.Color', 'androidx.compose.foundation.shape.RoundedCornerShape'],
  modifier_shadow: ['androidx.compose.foundation.shadow'],
  modifier_clip: ['androidx.compose.foundation.shape.RoundedCornerShape', 'androidx.compose.ui.draw.clip'],
  modifier_offset: ['androidx.compose.foundation.layout.offset'],

  // State
  remember_int_state: ['androidx.compose.runtime.*'],
  remember_string_state: ['androidx.compose.runtime.*'],
  remember_boolean_state: ['androidx.compose.runtime.*'],
  remember_list_state: ['androidx.compose.runtime.*'],
  remember_map_state: ['androidx.compose.runtime.*'],
  derived_state_of: ['androidx.compose.runtime.*'],

  // Animations
  animate_color_as_state: ['androidx.compose.animation.animateColorAsState', 'androidx.compose.ui.graphics.Color'],
  animate_dp_as_state: ['androidx.compose.animation.animateDpAsState'],
  animate_float_as_state: ['androidx.compose.animation.animateFloatAsState'],
  update_transition: ['androidx.compose.animation.updateTransition'],

  // Media
  async_image: ['coil.compose.AsyncImage'],
  image_painter: ['androidx.compose.foundation.Image', 'androidx.compose.ui.res.painterResource'],
  icon_component: ['androidx.compose.material.icons.Icons', 'androidx.compose.material.icons.filled.*'],

  // Events
  on_click_launch_url: ['android.content.Intent', 'android.net.Uri'],
  on_click_share: ['android.content.Intent'],
};

export const blockDefinitions = [
  // ==================== STATE & VARIABLES ====================
  {
    id: 'remember_int_state',
    category: 'STATE',
    label: 'Remember Int State',
    description: 'const [counter, setCounter] = useState(0)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'counter' },
      { type: 'number', label: 'Initial Value', placeholder: '0' }
    ],
    outputs: ['next'],
  },
  {
    id: 'remember_string_state',
    category: 'STATE',
    label: 'Remember String State',
    description: 'const [text, setText] = useState("")',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'text' },
      { type: 'text', label: 'Initial Value', placeholder: '' }
    ],
    outputs: ['next'],
  },
  {
    id: 'remember_boolean_state',
    category: 'STATE',
    label: 'Remember Boolean State',
    description: 'var isChecked by remember { mutableStateOf(false) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'isChecked' },
      { type: 'boolean', label: 'Initial Value' }
    ],
    outputs: ['next'],
  },
  {
    id: 'remember_list_state',
    category: 'STATE',
    label: 'Remember List State',
    description: 'var items by remember { mutableStateOf(mutableListOf()) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'items' }
    ],
    outputs: ['next'],
  },
  {
    id: 'remember_map_state',
    category: 'STATE',
    label: 'Remember Map State',
    description: 'var data by remember { mutableStateOf(mutableMapOf()) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'data' }
    ],
    outputs: ['next'],
  },
  {
    id: 'update_state',
    category: 'STATE',
    label: 'Update State Value',
    description: 'counter = newValue',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'counter' },
      { type: 'text', label: 'New Value or Expression', placeholder: 'counter + 1' }
    ],
    outputs: ['next'],
  },
  {
    id: 'derived_state_of',
    category: 'STATE',
    label: 'Derived State Of',
    description: 'val doubled by remember { derivedStateOf { counter * 2 } }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'doubled' },
      { type: 'text', label: 'Expression', placeholder: 'counter * 2' }
    ],
    outputs: ['next'],
  },
  
  // ==================== LAYOUT CONTAINERS ====================
  {
    id: 'scaffold',
    category: 'LAYOUT',
    label: 'Scaffold with TopBar',
    description: 'Scaffold(topBar = { TopAppBar(title = { Text("...") }) }) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'TopBar Title', placeholder: 'MyApp' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'scaffold_with_bottombar',
    category: 'LAYOUT',
    label: 'Scaffold with BottomBar',
    description: 'Scaffold(bottomBar = { NavigationBar { ... } }) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'TopBar Title', placeholder: 'MyApp' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'column',
    category: 'LAYOUT',
    label: 'Column Layout',
    description: '<div style={{ ... }}> ... </div>',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Horizontal Alignment', placeholder: 'CenterHorizontally' },
      { type: 'number', label: 'Vertical Spacing (dp)', placeholder: '16' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'row',
    category: 'LAYOUT',
    label: 'Row Layout',
    description: 'Row(modifier, horizontalArrangement, verticalAlignment) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Horizontal Arrangement', placeholder: 'spacedBy' },
      { type: 'number', label: 'Spacing (dp)', placeholder: '12' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'box',
    category: 'LAYOUT',
    label: 'Box Layout',
    description: 'Box(modifier, contentAlignment) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Content Alignment', placeholder: 'Center' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'elevated_card',
    category: 'LAYOUT',
    label: 'ElevatedCard',
    description: 'ElevatedCard(modifier) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'number', label: 'Elevation (dp)', placeholder: '4' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'outlined_card',
    category: 'LAYOUT',
    label: 'OutlinedCard',
    description: 'OutlinedCard(modifier) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'number', label: 'Border Width (dp)', placeholder: '1' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'surface',
    category: 'LAYOUT',
    label: 'Surface',
    description: 'Surface(modifier, color, shadowElevation) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Color', placeholder: 'MaterialTheme.colorScheme.surface' },
      { type: 'number', label: 'Shadow Elevation (dp)', placeholder: '4' }
    ],
    outputs: ['next', 'content'],
  },
  
  // ==================== UI COMPONENTS ====================
  {
    id: 'text',
    category: 'UI',
    label: 'Text',
    description: 'Text("Hello World", style, fontWeight)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Text Content', placeholder: 'Hello World' },
      { type: 'text', label: 'Style', placeholder: 'headlineSmall' },
      { type: 'text', label: 'Font Weight', placeholder: 'Bold' }
    ],
    outputs: ['next'],
  },
  {
    id: 'text_with_variable',
    category: 'UI',
    label: 'Text with Variable',
    description: 'Text("Count: $counter", style)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Text with $variable', placeholder: 'Count: $counter' },
      { type: 'text', label: 'Style', placeholder: 'titleLarge' }
    ],
    outputs: ['next'],
  },
  {
    id: 'text_html',
    category: 'UI',
    label: 'Text with HTML/AnnotatedString',
    description: 'Text(buildAnnotatedString { ... })',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Content', placeholder: 'bold text' }
    ],
    outputs: ['next'],
  },
  {
    id: 'button',
    category: 'UI',
    label: '🔘 Button',
    description: 'Example: <button onClick={() => ...}>Save</button>',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Button Label', placeholder: '+1' },
      { type: 'text', label: 'OnClick Action', placeholder: 'counter++' }
    ],
    outputs: ['next'],
  },
  {
    id: 'outlined_button',
    category: 'UI',
    label: 'OutlinedButton',
    description: 'OutlinedButton(onClick = { ... }) { Text("label") }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Button Label', placeholder: 'Reset' },
      { type: 'text', label: 'OnClick Action', placeholder: 'counter = 0' }
    ],
    outputs: ['next'],
  },
  {
    id: 'text_button',
    category: 'UI',
    label: 'TextButton',
    description: 'TextButton(onClick = { ... }) { Text("label") }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Button Label', placeholder: 'Cancel' },
      { type: 'text', label: 'OnClick Action', placeholder: 'dismiss()' }
    ],
    outputs: ['next'],
  },
  {
    id: 'icon_button',
    category: 'UI',
    label: 'IconButton',
    description: 'IconButton(onClick = { ... }) { Icon(Icons.Default.Add, ...) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Icon Name', placeholder: 'Add' },
      { type: 'text', label: 'OnClick Action', placeholder: 'addItem()' }
    ],
    outputs: ['next'],
  },
  {
    id: 'extended_fab',
    category: 'UI',
    label: 'ExtendedFloatingActionButton',
    description: 'ExtendedFloatingActionButton(onClick, icon, text)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Icon', placeholder: 'Edit' },
      { type: 'text', label: 'Text', placeholder: 'Add Item' },
      { type: 'text', label: 'OnClick Action', placeholder: 'navigate()' }
    ],
    outputs: ['next'],
  },
  {
    id: 'outlined_textfield',
    category: 'UI',
    label: 'OutlinedTextField',
    description: 'OutlinedTextField(value, onValueChange, label, placeholder)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Value Variable', placeholder: 'text' },
      { type: 'text', label: 'Label', placeholder: 'Enter text' },
      { type: 'text', label: 'Placeholder', placeholder: 'Type here...' },
      { type: 'boolean', label: 'Single Line', placeholder: 'true' }
    ],
    outputs: ['next'],
  },
  {
    id: 'checkbox',
    category: 'UI',
    label: 'Checkbox with Text',
    description: 'Row { Checkbox(checked, onCheckedChange); Text(label) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Checked Variable', placeholder: 'isChecked' },
      { type: 'text', label: 'Label Text', placeholder: 'Accept terms' }
    ],
    outputs: ['next'],
  },
  {
    id: 'switch',
    category: 'UI',
    label: 'Switch with Text',
    description: 'Row { Text(label); Switch(checked, onCheckedChange) }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Checked Variable', placeholder: 'isDarkMode' },
      { type: 'text', label: 'Label Text', placeholder: 'Dark mode' }
    ],
    outputs: ['next'],
  },
  {
    id: 'slider',
    category: 'UI',
    label: 'Slider',
    description: 'Slider(value, onValueChange, valueRange)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Value Variable', placeholder: 'sliderValue' },
      { type: 'number', label: 'Min Value', placeholder: '0' },
      { type: 'number', label: 'Max Value', placeholder: '100' }
    ],
    outputs: ['next'],
  },
  {
    id: 'linear_progress',
    category: 'UI',
    label: 'LinearProgressIndicator',
    description: 'LinearProgressIndicator(progress = 0.5f)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Progress Variable', placeholder: 'progress' }
    ],
    outputs: ['next'],
  },
  {
    id: 'circular_progress',
    category: 'UI',
    label: 'CircularProgressIndicator',
    description: 'CircularProgressIndicator()',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Progress Variable', placeholder: 'progress' }
    ],
    outputs: ['next'],
  },
  {
    id: 'divider',
    category: 'UI',
    label: 'HorizontalDivider',
    description: 'HorizontalDivider(thickness, color)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Thickness (dp)', placeholder: '1' }
    ],
    outputs: ['next'],
  },
  {
    id: 'spacer',
    category: 'UI',
    label: 'Spacer',
    description: 'Spacer(modifier = Modifier.height(X.dp))',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Height (dp)', placeholder: '16' }
    ],
    outputs: ['next'],
  },
  {
    id: 'info_row',
    category: 'UI',
    label: 'InfoRow (Label + Value)',
    description: 'Display label-value pair: InfoRow("Android SDK", Build.VERSION.SDK_INT.toString())',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Label', placeholder: 'Android SDK' },
      { type: 'text', label: 'Value Expression', placeholder: 'Build.VERSION.SDK_INT.toString()' }
    ],
    outputs: ['next'],
  },
  
  // ==================== MODIFIERS ====================
  {
    id: 'modifier_padding',
    category: 'MODIFIER',
    label: 'Padding',
    description: 'Modifier.padding(X.dp)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Padding (dp)', placeholder: '24' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_padding_all',
    category: 'MODIFIER',
    label: 'Padding All Sides',
    description: 'Modifier.padding(horizontal, vertical)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Horizontal (dp)', placeholder: '16' },
      { type: 'number', label: 'Vertical (dp)', placeholder: '16' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_fill_max_size',
    category: 'MODIFIER',
    label: 'Fill Max Size',
    description: 'Modifier.fillMaxSize()',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'modifier_fill_max_width',
    category: 'MODIFIER',
    label: 'Fill Max Width',
    description: 'Modifier.fillMaxWidth()',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'modifier_fill_max_height',
    category: 'MODIFIER',
    label: 'Fill Max Height',
    description: 'Modifier.fillMaxHeight()',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'modifier_size',
    category: 'MODIFIER',
    label: 'Set Size',
    description: 'Modifier.size(width.dp, height.dp)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Width (dp)', placeholder: '100' },
      { type: 'number', label: 'Height (dp)', placeholder: '100' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_width',
    category: 'MODIFIER',
    label: 'Set Width',
    description: 'Modifier.width(X.dp)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Width (dp)', placeholder: '200' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_height',
    category: 'MODIFIER',
    label: 'Set Height',
    description: 'Modifier.height(X.dp)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Height (dp)', placeholder: '200' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_background',
    category: 'MODIFIER',
    label: 'Background Color',
    description: 'Modifier.background(Color.XXX)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Color', placeholder: 'MaterialTheme.colorScheme.primary' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_clickable',
    category: 'MODIFIER',
    label: 'Make Clickable',
    description: 'Modifier.clickable { onClick() }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'OnClick Action', placeholder: 'navigate()' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_vertical_scroll',
    category: 'MODIFIER',
    label: 'Vertical Scroll',
    description: 'Modifier.verticalScroll(rememberScrollState())',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'modifier_horizontal_scroll',
    category: 'MODIFIER',
    label: 'Horizontal Scroll',
    description: 'Modifier.horizontalScroll(rememberScrollState())',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'modifier_border',
    category: 'MODIFIER',
    label: 'Border',
    description: 'Modifier.border(width.dp, Color, shape)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Width (dp)', placeholder: '1' },
      { type: 'text', label: 'Color', placeholder: 'Color.Gray' },
      { type: 'text', label: 'Shape', placeholder: 'RoundedCornerShape(8.dp)' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_shadow',
    category: 'MODIFIER',
    label: 'Shadow',
    description: 'Modifier.shadow(elevation.dp, shape)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Elevation (dp)', placeholder: '4' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_clip',
    category: 'MODIFIER',
    label: 'Clip Shape',
    description: 'Modifier.clip(RoundedCornerShape(X.dp))',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Corner Radius (dp)', placeholder: '12' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_alpha',
    category: 'MODIFIER',
    label: 'Alpha (Opacity)',
    description: 'Modifier.alpha(0.5f)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Alpha (0.0 - 1.0)', placeholder: '0.5' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_rotate',
    category: 'MODIFIER',
    label: 'Rotate',
    description: 'Modifier.rotate(45f)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Degrees', placeholder: '45' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_scale',
    category: 'MODIFIER',
    label: 'Scale',
    description: 'Modifier.scale(1.5f)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'Scale Factor', placeholder: '1.5' }
    ],
    outputs: ['next'],
  },
  {
    id: 'modifier_offset',
    category: 'MODIFIER',
    label: 'Offset',
    description: 'Modifier.offset(x.dp, y.dp)',
    shape: 'stack',
    inputs: [
      { type: 'number', label: 'X Offset (dp)', placeholder: '0' },
      { type: 'number', label: 'Y Offset (dp)', placeholder: '0' }
    ],
    outputs: ['next'],
  },
  
  // ==================== EVENTS & ACTIONS ====================
  {
    id: 'on_click_increment',
    category: 'EVENT',
    label: 'Increment Variable',
    description: 'counter++',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'counter' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_decrement',
    category: 'EVENT',
    label: 'Decrement Variable',
    description: 'counter--',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'counter' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_set_value',
    category: 'EVENT',
    label: 'Set Variable Value',
    description: 'counter = 0',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'counter' },
      { type: 'any', label: 'New Value', placeholder: '0' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_toggle',
    category: 'EVENT',
    label: 'Toggle Boolean',
    description: 'isChecked = !isChecked',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'isChecked' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_add_to_list',
    category: 'EVENT',
    label: 'Add to List',
    description: 'items.add(item)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' },
      { type: 'text', label: 'Item to Add', placeholder: '"New item"' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_remove_from_list',
    category: 'EVENT',
    label: 'Remove from List',
    description: 'items.removeAt(index)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' },
      { type: 'number', label: 'Index', placeholder: '0' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_clear_list',
    category: 'EVENT',
    label: 'Clear List',
    description: 'items.clear()',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_show_snackbar',
    category: 'EVENT',
    label: 'Show Snackbar',
    description: 'scope.launch { snackbarHostState.showSnackbar("...") }',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Message', placeholder: 'Item added' },
      { type: 'text', label: 'Action Label', placeholder: 'Undo' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_launch_url',
    category: 'EVENT',
    label: 'Launch URL',
    description: 'context.startActivity(Intent(ACTION_VIEW, Uri.parse(url)))',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'URL', placeholder: 'https://example.com' }
    ],
    outputs: ['next'],
  },
  {
    id: 'on_click_share',
    category: 'EVENT',
    label: 'Share Text',
    description: 'context.startActivity(Intent(ACTION_SEND))',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Text to Share', placeholder: 'Check this out!' },
      { type: 'text', label: 'Subject', placeholder: 'Sharing' }
    ],
    outputs: ['next'],
  },
  
  // ==================== TEXT STYLE ====================
  {
    id: 'style_headline_large',
    category: 'TEXT_STYLE',
    label: 'Headline Large',
    description: 'MaterialTheme.typography.headlineLarge',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_headline_medium',
    category: 'TEXT_STYLE',
    label: 'Headline Medium',
    description: 'MaterialTheme.typography.headlineMedium',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_headline_small',
    category: 'TEXT_STYLE',
    label: 'Headline Small',
    description: 'MaterialTheme.typography.headlineSmall',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_title_large',
    category: 'TEXT_STYLE',
    label: 'Title Large',
    description: 'MaterialTheme.typography.titleLarge',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_title_medium',
    category: 'TEXT_STYLE',
    label: 'Title Medium',
    description: 'MaterialTheme.typography.titleMedium',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_title_small',
    category: 'TEXT_STYLE',
    label: 'Title Small',
    description: 'MaterialTheme.typography.titleSmall',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_body_large',
    category: 'TEXT_STYLE',
    label: 'Body Large',
    description: 'MaterialTheme.typography.bodyLarge',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_body_medium',
    category: 'TEXT_STYLE',
    label: 'Body Medium',
    description: 'MaterialTheme.typography.bodyMedium',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_body_small',
    category: 'TEXT_STYLE',
    label: 'Body Small',
    description: 'MaterialTheme.typography.bodySmall',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_label_large',
    category: 'TEXT_STYLE',
    label: 'Label Large',
    description: 'MaterialTheme.typography.labelLarge',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_label_medium',
    category: 'TEXT_STYLE',
    label: 'Label Medium',
    description: 'MaterialTheme.typography.labelMedium',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'style_label_small',
    category: 'TEXT_STYLE',
    label: 'Label Small',
    description: 'MaterialTheme.typography.labelSmall',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'font_weight_bold',
    category: 'TEXT_STYLE',
    label: 'Bold',
    description: 'FontWeight.Bold',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'font_weight_normal',
    category: 'TEXT_STYLE',
    label: 'Normal',
    description: 'FontWeight.Normal',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  {
    id: 'font_weight_light',
    category: 'TEXT_STYLE',
    label: 'Light',
    description: 'FontWeight.Light',
    shape: 'reporter',
    inputs: [],
    outputs: ['value'],
  },
  
  // ==================== LISTS & DATA ====================
  {
    id: 'lazy_column',
    category: 'LIST',
    label: 'LazyColumn',
    description: 'LazyColumn(modifier) { items(list) { item -> ... } }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'lazy_row',
    category: 'LIST',
    label: 'LazyRow',
    description: 'LazyRow(modifier) { items(list) { item -> ... } }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'list_item',
    category: 'LIST',
    label: 'List Item',
    description: 'items[index]',
    shape: 'reporter',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' },
      { type: 'number', label: 'Index', placeholder: '0' }
    ],
    outputs: ['value'],
  },
  {
    id: 'list_size',
    category: 'LIST',
    label: 'List Size',
    description: 'items.size',
    shape: 'reporter',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' }
    ],
    outputs: ['value'],
  },
  {
    id: 'list_is_empty',
    category: 'LIST',
    label: 'List is Empty',
    description: 'items.isEmpty()',
    shape: 'reporter',
    inputs: [
      { type: 'text', label: 'List Variable', placeholder: 'items' }
    ],
    outputs: ['value'],
  },
  
  // ==================== ANIMATIONS ====================
  {
    id: 'animate_color_as_state',
    category: 'ANIMATION',
    label: 'Animate Color',
    description: 'val color by animateColorAsState(if (checked) Color.Green else Color.Red)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'color' },
      { type: 'text', label: 'True Color', placeholder: 'Color.Green' },
      { type: 'text', label: 'False Color', placeholder: 'Color.Red' }
    ],
    outputs: ['next'],
  },
  {
    id: 'animate_dp_as_state',
    category: 'ANIMATION',
    label: 'Animate Size (dp)',
    description: 'val size by animateDpAsState(if (expanded) 200.dp else 100.dp)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'size' },
      { type: 'number', label: 'Expanded Size (dp)', placeholder: '200' },
      { type: 'number', label: 'Collapsed Size (dp)', placeholder: '100' }
    ],
    outputs: ['next'],
  },
  {
    id: 'animate_float_as_state',
    category: 'ANIMATION',
    label: 'Animate Float',
    description: 'val alpha by animateFloatAsState(if (visible) 1f else 0f)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'alpha' },
      { type: 'number', label: 'Target Value', placeholder: '1.0' }
    ],
    outputs: ['next'],
  },
  {
    id: 'update_transition',
    category: 'ANIMATION',
    label: 'UpdateTransition',
    description: 'val transition = updateTransition(targetState, label)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Target State', placeholder: 'currentState' }
    ],
    outputs: ['next'],
  },
  
  // ==================== DIALOGS ====================
  {
    id: 'alert_dialog',
    category: 'DIALOG',
    label: 'AlertDialog',
    description: 'AlertDialog(onDismissRequest, title, text, confirmButton)',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Show Variable', placeholder: 'showDialog' },
      { type: 'text', label: 'Title', placeholder: 'Confirm' },
      { type: 'text', label: 'Message', placeholder: 'Are you sure?' }
    ],
    outputs: ['next', 'content'],
  },
  {
    id: 'modal_bottom_sheet',
    category: 'DIALOG',
    label: 'ModalBottomSheet',
    description: 'ModalBottomSheet(onDismissRequest) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Show Variable', placeholder: 'showSheet' }
    ],
    outputs: ['next', 'content'],
  },
  
  // ==================== NAVIGATION ====================
  {
    id: 'navigate_to_screen',
    category: 'NAVIGATION',
    label: 'Navigate to Screen',
    description: 'navController.navigate("screenName")',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Screen Name', placeholder: 'Details' }
    ],
    outputs: ['next'],
  },
  {
    id: 'navigate_back',
    category: 'NAVIGATION',
    label: 'Navigate Back',
    description: 'navController.popBackStack()',
    shape: 'stack',
    inputs: [],
    outputs: ['next'],
  },
  {
    id: 'navigate_with_args',
    category: 'NAVIGATION',
    label: 'Navigate with Arguments',
    description: 'navController.navigate("screen/$arg1/$arg2")',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Route with Args', placeholder: 'user/123' }
    ],
    outputs: ['next'],
  },
  
  // ==================== MEDIA & IMAGES ====================
  {
    id: 'async_image',
    category: 'MEDIA',
    label: 'AsyncImage (Coil)',
    description: 'AsyncImage(model = "...", contentDescription = "...")',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Image URL', placeholder: 'https://...' },
      { type: 'text', label: 'Content Description', placeholder: 'Description' },
      { type: 'number', label: 'Width (dp)', placeholder: '200' },
      { type: 'number', label: 'Height (dp)', placeholder: '200' }
    ],
    outputs: ['next'],
  },
  {
    id: 'image_painter',
    category: 'MEDIA',
    label: 'Image with Painter',
    description: 'Image(painterResource(R.drawable.xxx), ...)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Resource Name', placeholder: 'R.drawable.logo' },
      { type: 'text', label: 'Content Description', placeholder: 'Logo' }
    ],
    outputs: ['next'],
  },
  {
    id: 'icon_component',
    category: 'MEDIA',
    label: 'Icon',
    description: 'Icon(Icons.Default.XXX, contentDescription, tint)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Icon Name', placeholder: 'Favorite' },
      { type: 'text', label: 'Tint Color', placeholder: 'Color.Red' }
    ],
    outputs: ['next'],
  },

  // ==================== CONTROL FLOW (C-Blocks with nesting) ====================
  {
    id: 'if_else',
    category: 'CONTROL',
    label: 'If / Else',
    description: 'Example: if (isLoggedIn) { showHome() } else { showLogin() }',
    shape: 'c-block',
    inputs: [
      { type: 'boolean', label: 'Condition', placeholder: 'counter > 0' }
    ],
    outputs: ['next', 'then', 'else'],
  },
  {
    id: 'repeat_times',
    category: 'CONTROL',
    label: 'Repeat N Times',
    description: 'repeat(N) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'number', label: 'Times', placeholder: '5' }
    ],
    outputs: ['next', 'do'],
  },
  {
    id: 'while_loop',
    category: 'CONTROL',
    label: 'While Loop',
    description: 'while (condition) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'boolean', label: 'Condition', placeholder: 'counter < 10' }
    ],
    outputs: ['next', 'do'],
  },
  {
    id: 'when_expression',
    category: 'CONTROL',
    label: 'When Expression',
    description: 'when (value) { case -> ... else -> ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Value to Check', placeholder: 'status' }
    ],
    outputs: ['next', 'branches'],
  },
  {
    id: 'try_catch',
    category: 'CONTROL',
    label: 'Try / Catch',
    description: 'try { ... } catch (e: Exception) { ... }',
    shape: 'c-block',
    inputs: [],
    outputs: ['next', 'try', 'catch'],
  },
  {
    id: 'launched_effect',
    category: 'CONTROL',
    label: 'Launched Effect',
    description: 'LaunchedEffect(key) { ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Key', placeholder: 'Unit' }
    ],
    outputs: ['next', 'do'],
  },
  {
    id: 'disposable_effect',
    category: 'CONTROL',
    label: 'Disposable Effect',
    description: 'DisposableEffect(key) { ... onDispose { ... } }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Key' }
    ],
    outputs: ['next', 'do', 'onDispose'],
  },
  {
    id: 'side_effect',
    category: 'CONTROL',
    label: 'Side Effect',
    description: 'SideEffect { ... }',
    shape: 'c-block',
    inputs: [],
    outputs: ['next', 'do'],
  },
  {
    id: 'produce_state',
    category: 'CONTROL',
    label: 'Produce State',
    description: 'val data by produceState(initial) { value = ... }',
    shape: 'c-block',
    inputs: [
      { type: 'text', label: 'Variable Name', placeholder: 'data' },
      { type: 'text', label: 'Initial Value', placeholder: 'null' }
    ],
    outputs: ['next', 'do'],
  },

  // ==================== IMPORTS & CUSTOM CODE ====================
  {
    id: 'custom_import',
    category: 'CONTROL',
    label: '📦 Add Import',
    description: 'Add library import (e.g., com.google.gson.Gson)',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Import Path', placeholder: 'com.example.MyClass' }
    ],
    outputs: ['next'],
  },
  {
    id: 'custom_code',
    category: 'CONTROL',
    label: '💻 Custom Code',
    description: 'Write any Kotlin code directly',
    shape: 'stack',
    inputs: [
      { type: 'text', label: 'Code', placeholder: 'Log.d("Tag", "Hello")' }
    ],
    outputs: ['next'],
  },
];

export default blockDefinitions;
