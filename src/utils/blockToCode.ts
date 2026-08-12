/**
 * Generate Kotlin Compose code from visual blocks.
 * Extended version supporting all Compose components with smart imports.
 */

// Track which imports are needed based on blocks used
const collectImports = (blocks, imports = new Set(), customImports = []) => {
  if (!blocks) return { imports, customImports };
  for (const block of blocks) {
    const def = block.definitionId;
    const blockImports = BLOCK_IMPORTS_MAP[def];
    
    // Handle custom import block
    if (def === 'custom_import') {
      const importPath = block.inputs?.['Import Path'] || '';
      if (importPath) {
        customImports.push(importPath);
      }
    } else if (blockImports) {
      blockImports.forEach(imp => imports.add(imp));
    }
    
    // Recurse into children
    if (block.children) {
      Object.values(block.children).forEach(childBlocks => {
        if (Array.isArray(childBlocks)) {
          const result = collectImports(childBlocks, imports, customImports);
          imports = result.imports;
          customImports = result.customImports;
        }
      });
    }
  }
  return { imports, customImports };
};

// Map block IDs to their required imports
const BLOCK_IMPORTS_MAP = {
  // Material 3
  scaffold: ['androidx.compose.material3.*'],
  scaffold_with_bottombar: ['androidx.compose.material3.*'],
  elevated_card: ['androidx.compose.material3.*', 'androidx.compose.material3.CardDefaults'],
  outlined_card: ['androidx.compose.material3.*'],
  button: ['androidx.compose.material3.*'],
  outlined_button: ['androidx.compose.material3.*'],
  text_button: ['androidx.compose.material3.*'],
  icon_button: ['androidx.compose.material3.*', 'androidx.compose.material.icons.Icons', 'androidx.compose.material.icons.filled.*'],
  extended_fab: ['androidx.compose.material3.*', 'androidx.compose.material.icons.Icons', 'androidx.compose.material.icons.filled.*'],
  textfield: ['androidx.compose.material3.*'],
  checkbox: ['androidx.compose.material3.*'],
  switch: ['androidx.compose.material3.*'],
  slider: ['androidx.compose.material3.*'],
  linear_progress: ['androidx.compose.material3.*'],
  circular_progress: ['androidx.compose.material3.*'],
  divider: ['androidx.compose.material3.*'],
  alert_dialog: ['androidx.compose.material3.*'],
  modal_bottom_sheet: ['androidx.compose.material3.*'],
  
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
  
  // Control flow
  if_else: [],
  repeat_times: [],
  while_loop: [],
  when_expression: [],
  try_catch: ['android.util.Log'],
  launched_effect: ['androidx.compose.runtime.LaunchedEffect'],
  disposable_effect: ['androidx.compose.runtime.DisposableEffect'],
  side_effect: ['androidx.compose.runtime.SideEffect'],
  produce_state: ['androidx.compose.runtime.produceState'],
  
  // Custom - handled separately
  custom_import: [],
  custom_code: [],
};

export const generateImportsFromBlocks = (blocks) => {
  const { imports, customImports } = collectImports(blocks);
  const standardImports = Array.from(imports).sort().map(imp => `import ${imp}`).join('\n');
  const customImportsStr = customImports.length > 0 
    ? '\n' + customImports.map(imp => `import ${imp}`).join('\n')
    : '';
  return standardImports + customImportsStr;
};

export const generateCodeFromBlocks = (blocks, indent = 0) => {
  if (!blocks || blocks.length === 0) return '';
  const spaces = '    '.repeat(indent);
  const lines = [];

  for (const block of blocks) {
    const def = block.definitionId;
    const inputs = block.inputs || {};
    const children = block.children || {};

    const val = (key, fallback = '') => inputs[key] || fallback;
    const num = (key, fallback = '0') => {
      const v = inputs[key];
      return v && v.trim() !== '' ? v : fallback;
    };

    switch (def) {
      // ==================== STATE ====================
      case 'remember_int_state':
        lines.push(`${spaces}var ${val('Variable Name', 'counter')} by remember { mutableIntStateOf(${num('Initial Value', '0')}) }`);
        break;
      case 'remember_string_state':
        lines.push(`${spaces}var ${val('Variable Name', 'text')} by remember { mutableStateOf("${val('Initial Value')}") }`);
        break;
      case 'remember_boolean_state':
        lines.push(`${spaces}var ${val('Variable Name', 'isChecked')} by remember { mutableStateOf(${val('Initial Value') === 'true' ? 'true' : 'false'}) }`);
        break;
      case 'remember_list_state':
        lines.push(`${spaces}var ${val('Variable Name', 'items')} by remember { mutableStateOf(mutableListOf<String>()) }`);
        break;
      case 'remember_map_state':
        lines.push(`${spaces}var ${val('Variable Name', 'data')} by remember { mutableStateOf(mutableMapOf<String, String>()) }`);
        break;
      case 'update_state':
        lines.push(`${spaces}${val('Variable Name')} = ${val('New Value or Expression')}`);
        break;
      case 'derived_state_of':
        lines.push(`${spaces}val ${val('Variable Name')} by remember { derivedStateOf { ${val('Expression')} } }`);
        break;

      // ==================== LAYOUTS ====================
      case 'scaffold':
        lines.push(`${spaces}Scaffold(`);
        lines.push(`${spaces}    topBar = { TopAppBar(title = { Text("${val('TopBar Title', 'MyApp')}") }) }`);
        lines.push(`${spaces}) { padding ->`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'scaffold_with_bottombar':
        lines.push(`${spaces}Scaffold(`);
        lines.push(`${spaces}    topBar = { TopAppBar(title = { Text("${val('TopBar Title', 'MyApp')}") }) },`);
        lines.push(`${spaces}    bottomBar = { NavigationBar { /* Add items */ } }`);
        lines.push(`${spaces}) { padding ->`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'column':
        lines.push(`${spaces}Column(`);
        lines.push(`${spaces}    modifier = Modifier`);
        lines.push(`${spaces}        .fillMaxSize()`);
        lines.push(`${spaces}        .padding(24.dp),`);
        lines.push(`${spaces}    horizontalAlignment = Alignment.${val('Horizontal Alignment', 'CenterHorizontally')},`);
        lines.push(`${spaces}    verticalArrangement = Arrangement.spacedBy(${num('Vertical Spacing (dp)', '16')}.dp)`);
        lines.push(`${spaces}) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'row':
        lines.push(`${spaces}Row(`);
        lines.push(`${spaces}    horizontalArrangement = Arrangement.${val('Horizontal Arrangement', 'spacedBy')}(${num('Spacing (dp)', '12')}.dp),`);
        lines.push(`${spaces}    verticalAlignment = Alignment.CenterVertically`);
        lines.push(`${spaces}) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'box':
        lines.push(`${spaces}Box(`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxSize(),`);
        lines.push(`${spaces}    contentAlignment = Alignment.${val('Content Alignment', 'Center')}`);
        lines.push(`${spaces}) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'elevated_card':
        lines.push(`${spaces}ElevatedCard(`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxWidth(),`);
        lines.push(`${spaces}    elevation = CardDefaults.elevatedCardElevation(defaultElevation = ${num('Elevation (dp)', '4')}.dp)`);
        lines.push(`${spaces}) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'outlined_card':
        lines.push(`${spaces}OutlinedCard(modifier = Modifier.fillMaxWidth()) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'surface':
        lines.push(`${spaces}Surface(`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxSize(),`);
        lines.push(`${spaces}    color = ${val('Color', 'MaterialTheme.colorScheme.surface')},`);
        lines.push(`${spaces}    shadowElevation = ${num('Shadow Elevation (dp)', '4')}.dp`);
        lines.push(`${spaces}) {`);
        if (children.content?.length > 0) lines.push(generateCodeFromBlocks(children.content, indent + 1));
        lines.push(`${spaces}}`);
        break;

      // ==================== UI COMPONENTS ====================
      case 'text': {
        const content = val('Text Content', '');
        const style = val('Style');
        const weight = val('Font Weight');
        let code = `${spaces}Text("${content}"`;
        if (style) code += `, style = MaterialTheme.typography.${style}`;
        if (weight) code += `, fontWeight = FontWeight.${weight}`;
        code += ')';
        lines.push(code);
        break;
      }
      case 'text_with_variable': {
        const content = val('Text with $variable', '');
        const style = val('Style');
        let code = `${spaces}Text("${content}"`;
        if (style) code += `, style = MaterialTheme.typography.${style}`;
        code += ')';
        lines.push(code);
        break;
      }
      case 'text_html':
        lines.push(`${spaces}Text(buildAnnotatedString { append("${val('Content')}") })`);
        break;

      case 'button':
        lines.push(`${spaces}Button(onClick = { ${val('OnClick Action')} }) {`);
        lines.push(`${spaces}    Text("${val('Button Label', 'Click')}")`);
        lines.push(`${spaces}}`);
        break;

      case 'outlined_button':
        lines.push(`${spaces}OutlinedButton(onClick = { ${val('OnClick Action')} }) {`);
        lines.push(`${spaces}    Text("${val('Button Label', 'Click')}")`);
        lines.push(`${spaces}}`);
        break;

      case 'text_button':
        lines.push(`${spaces}TextButton(onClick = { ${val('OnClick Action')} }) {`);
        lines.push(`${spaces}    Text("${val('Button Label', 'Click')}")`);
        lines.push(`${spaces}}`);
        break;

      case 'icon_button':
        lines.push(`${spaces}IconButton(onClick = { ${val('OnClick Action')} }) {`);
        lines.push(`${spaces}    Icon(Icons.Default.${val('Icon Name', 'Add')}, contentDescription = null)`);
        lines.push(`${spaces}}`);
        break;

      case 'extended_fab':
        lines.push(`${spaces}ExtendedFloatingActionButton(`);
        lines.push(`${spaces}    onClick = { ${val('OnClick Action')} },`);
        lines.push(`${spaces}    icon = { Icon(Icons.Default.${val('Icon', 'Edit')}, contentDescription = null) },`);
        lines.push(`${spaces}    text = { Text("${val('Text', 'Add')}") }`);
        lines.push(`${spaces})`);
        break;

      case 'outlined_textfield': {
        const variable = val('Value Variable', 'text');
        lines.push(`${spaces}OutlinedTextField(`);
        lines.push(`${spaces}    value = ${variable},`);
        lines.push(`${spaces}    onValueChange = { ${variable} = it },`);
        lines.push(`${spaces}    label = { Text("${val('Label')}") },`);
        lines.push(`${spaces}    placeholder = { Text("${val('Placeholder')}") },`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxWidth(),`);
        lines.push(`${spaces}    singleLine = ${val('Single Line') === 'true' ? 'true' : 'false'}`);
        lines.push(`${spaces})`);
        break;
      }

      case 'checkbox':
        lines.push(`${spaces}Row(verticalAlignment = Alignment.CenterVertically) {`);
        lines.push(`${spaces}    Checkbox(checked = ${val('Checked Variable')}, onCheckedChange = { ${val('Checked Variable')} = it })`);
        lines.push(`${spaces}    Text("${val('Label Text')}")`);
        lines.push(`${spaces}}`);
        break;

      case 'switch':
        lines.push(`${spaces}Row(`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxWidth(),`);
        lines.push(`${spaces}    horizontalArrangement = Arrangement.SpaceBetween,`);
        lines.push(`${spaces}    verticalAlignment = Alignment.CenterVertically`);
        lines.push(`${spaces}) {`);
        lines.push(`${spaces}    Text("${val('Label Text')}")`);
        lines.push(`${spaces}    Switch(checked = ${val('Checked Variable')}, onCheckedChange = { ${val('Checked Variable')} = it })`);
        lines.push(`${spaces}}`);
        break;

      case 'slider':
        lines.push(`${spaces}Slider(`);
        lines.push(`${spaces}    value = ${val('Value Variable')}.toFloat(),`);
        lines.push(`${spaces}    onValueChange = { ${val('Value Variable')} = it.toInt() },`);
        lines.push(`${spaces}    valueRange = ${num('Min Value', '0')}.toFloat()..${num('Max Value', '100')}.toFloat(),`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxWidth()`);
        lines.push(`${spaces})`);
        break;

      case 'linear_progress':
        lines.push(`${spaces}LinearProgressIndicator(`);
        lines.push(`${spaces}    progress = { ${val('Progress Variable', 'progress')} },`);
        lines.push(`${spaces}    modifier = Modifier.fillMaxWidth()`);
        lines.push(`${spaces})`);
        break;

      case 'circular_progress':
        lines.push(`${spaces}CircularProgressIndicator(`);
        lines.push(`${spaces}    progress = { ${val('Progress Variable', 'progress')} }`);
        lines.push(`${spaces})`);
        break;

      case 'divider':
        lines.push(`${spaces}HorizontalDivider(thickness = ${num('Thickness (dp)', '1')}.dp)`);
        break;

      case 'spacer':
        lines.push(`${spaces}Spacer(modifier = Modifier.height(${num('Height (dp)', '16')}.dp))`);
        break;

      case 'info_row': {
        const label = val('Label');
        const value = val('Value Expression');
        // Value expression is used as-is (no quotes) for code expressions
        // Example: InfoRow("Android SDK", Build.VERSION.SDK_INT.toString())
        lines.push(`${spaces}InfoRow("${label}", ${value})`);
        break;
      }

      // ==================== MODIFIERS ====================
      case 'modifier_padding':
        lines.push(`${spaces}.padding(${num('Padding (dp)', '16')}.dp)`);
        break;
      case 'modifier_padding_all':
        lines.push(`${spaces}.padding(horizontal = ${num('Horizontal (dp)', '16')}.dp, vertical = ${num('Vertical (dp)', '16')}.dp)`);
        break;
      case 'modifier_fill_max_size':
        lines.push(`${spaces}.fillMaxSize()`);
        break;
      case 'modifier_fill_max_width':
        lines.push(`${spaces}.fillMaxWidth()`);
        break;
      case 'modifier_fill_max_height':
        lines.push(`${spaces}.fillMaxHeight()`);
        break;
      case 'modifier_size':
        lines.push(`${spaces}.size(${num('Width (dp)', '100')}.dp, ${num('Height (dp)', '100')}.dp)`);
        break;
      case 'modifier_width':
        lines.push(`${spaces}.width(${num('Width (dp)', '200')}.dp)`);
        break;
      case 'modifier_height':
        lines.push(`${spaces}.height(${num('Height (dp)', '200')}.dp)`);
        break;
      case 'modifier_background':
        lines.push(`${spaces}.background(${val('Color', 'Color.White')})`);
        break;
      case 'modifier_clickable':
        lines.push(`${spaces}.clickable { ${val('OnClick Action')} }`);
        break;
      case 'modifier_vertical_scroll':
        lines.push(`${spaces}.verticalScroll(rememberScrollState())`);
        break;
      case 'modifier_horizontal_scroll':
        lines.push(`${spaces}.horizontalScroll(rememberScrollState())`);
        break;
      case 'modifier_border':
        lines.push(`${spaces}.border(${num('Width (dp)', '1')}.dp, ${val('Color', 'Color.Gray')}, ${val('Shape', 'RoundedCornerShape(8.dp)')})`);
        break;
      case 'modifier_shadow':
        lines.push(`${spaces}.shadow(${num('Elevation (dp)', '4')}.dp)`);
        break;
      case 'modifier_clip':
        lines.push(`${spaces}.clip(RoundedCornerShape(${num('Corner Radius (dp)', '12')}.dp))`);
        break;
      case 'modifier_alpha':
        lines.push(`${spaces}.alpha(${num('Alpha (0.0 - 1.0)', '0.5')}f)`);
        break;
      case 'modifier_rotate':
        lines.push(`${spaces}.rotate(${num('Degrees', '45')}f)`);
        break;
      case 'modifier_scale':
        lines.push(`${spaces}.scale(${num('Scale Factor', '1.5')}f)`);
        break;
      case 'modifier_offset':
        lines.push(`${spaces}.offset(x = ${num('X Offset (dp)', '0')}.dp, y = ${num('Y Offset (dp)', '0')}.dp)`);
        break;

      // ==================== EVENTS ====================
      case 'on_click_increment':
        lines.push(`${spaces}${val('Variable Name')}++`);
        break;
      case 'on_click_decrement':
        lines.push(`${spaces}${val('Variable Name')}--`);
        break;
      case 'on_click_set_value':
        lines.push(`${spaces}${val('Variable Name')} = ${val('New Value', '0')}`);
        break;
      case 'on_click_toggle':
        lines.push(`${spaces}${val('Variable Name')} = !${val('Variable Name')}`);
        break;
      case 'on_click_add_to_list':
        lines.push(`${spaces}${val('List Variable')}.add(${val('Item to Add')})`);
        break;
      case 'on_click_remove_from_list':
        lines.push(`${spaces}${val('List Variable')}.removeAt(${num('Index', '0')})`);
        break;
      case 'on_click_clear_list':
        lines.push(`${spaces}${val('List Variable')}.clear()`);
        break;
      case 'on_click_show_snackbar':
        lines.push(`${spaces}// Show snackbar: "${val('Message')}" with action "${val('Action Label')}"`);
        break;
      case 'on_click_launch_url':
        lines.push(`${spaces}// Launch URL: ${val('URL')}`);
        lines.push(`${spaces}val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${val('URL')}"))`);
        lines.push(`${spaces}context.startActivity(intent)`);
        break;
      case 'on_click_share':
        lines.push(`${spaces}// Share: "${val('Text to Share')}"`);
        lines.push(`${spaces}val intent = Intent(Intent.ACTION_SEND).apply {`);
        lines.push(`${spaces}    type = "text/plain"`);
        lines.push(`${spaces}    putExtra(Intent.EXTRA_TEXT, "${val('Text to Share')}")`);
        lines.push(`${spaces}    putExtra(Intent.EXTRA_SUBJECT, "${val('Subject')}")`);
        lines.push(`${spaces}}`);
        lines.push(`${spaces}context.startActivity(Intent.createChooser(intent, null))`);
        break;

      // ==================== LISTS ====================
      case 'lazy_column':
        lines.push(`${spaces}LazyColumn(modifier = Modifier.fillMaxSize()) {`);
        lines.push(`${spaces}    items(${val('List Variable', 'items')}) { item ->`);
        if (children.content?.length > 0) {
          const contentCode = generateCodeFromBlocks(children.content, indent + 2);
          lines.push(contentCode.replace(new RegExp(`${spaces}    `, 'g'), `${spaces}        `));
        }
        lines.push(`${spaces}    }`);
        lines.push(`${spaces}}`);
        break;

      case 'lazy_row':
        lines.push(`${spaces}LazyRow(modifier = Modifier.fillMaxWidth()) {`);
        lines.push(`${spaces}    items(${val('List Variable', 'items')}) { item ->`);
        if (children.content?.length > 0) {
          const contentCode = generateCodeFromBlocks(children.content, indent + 2);
          lines.push(contentCode.replace(new RegExp(`${spaces}    `, 'g'), `${spaces}        `));
        }
        lines.push(`${spaces}    }`);
        lines.push(`${spaces}}`);
        break;

      case 'list_item':
        // Reporter - just returns value
        lines.push(`${val('List Variable')}[${num('Index', '0')}]`);
        break;

      case 'list_size':
        lines.push(`${val('List Variable')}.size`);
        break;

      case 'list_is_empty':
        lines.push(`${val('List Variable')}.isEmpty()`);
        break;

      // ==================== ANIMATIONS ====================
      case 'animate_color_as_state':
        lines.push(`${spaces}val ${val('Variable Name')} by animateColorAsState(`);
        lines.push(`${spaces}    targetValue = if (${val('Variable Name', 'checked')}) ${val('True Color', 'Color.Green')} else ${val('False Color', 'Color.Red')}`);
        lines.push(`${spaces})`);
        break;
      case 'animate_dp_as_state':
        lines.push(`${spaces}val ${val('Variable Name')} by animateDpAsState(`);
        lines.push(`${spaces}    targetValue = if (${val('Variable Name', 'expanded')}) ${num('Expanded Size (dp)', '200')}.dp else ${num('Collapsed Size (dp)', '100')}.dp`);
        lines.push(`${spaces})`);
        break;
      case 'animate_float_as_state':
        lines.push(`${spaces}val ${val('Variable Name')} by animateFloatAsState(`);
        lines.push(`${spaces}    targetValue = ${num('Target Value', '1.0')}f`);
        lines.push(`${spaces})`);
        break;

      // ==================== DIALOGS ====================
      case 'alert_dialog':
        lines.push(`${spaces}if (${val('Show Variable', 'showDialog')}) {`);
        lines.push(`${spaces}    AlertDialog(`);
        lines.push(`${spaces}        onDismissRequest = { ${val('Show Variable')} = false },`);
        lines.push(`${spaces}        title = { Text("${val('Title', 'Confirm')}") },`);
        lines.push(`${spaces}        text = { Text("${val('Message', 'Are you sure?')}") },`);
        lines.push(`${spaces}        confirmButton = {`);
        lines.push(`${spaces}            TextButton(onClick = { ${val('Show Variable')} = false }) { Text("OK") }`);
        lines.push(`${spaces}        },`);
        lines.push(`${spaces}        dismissButton = {`);
        lines.push(`${spaces}            TextButton(onClick = { ${val('Show Variable')} = false }) { Text("Cancel") }`);
        lines.push(`${spaces}        }`);
        lines.push(`${spaces}    )`);
        lines.push(`${spaces}}`);
        break;

      // ==================== NAVIGATION ====================
      case 'navigate_to_screen':
        lines.push(`${spaces}navController.navigate("${val('Screen Name')}")`);
        break;
      case 'navigate_back':
        lines.push(`${spaces}navController.popBackStack()`);
        break;
      case 'navigate_with_args':
        lines.push(`${spaces}navController.navigate("${val('Route with Args')}")`);
        break;

      // ==================== MEDIA ====================
      case 'async_image':
        lines.push(`${spaces}AsyncImage(`);
        lines.push(`${spaces}    model = "${val('Image URL')}",`);
        lines.push(`${spaces}    contentDescription = "${val('Content Description')}",`);
        lines.push(`${spaces}    modifier = Modifier.size(${num('Width (dp)', '200')}.dp, ${num('Height (dp)', '200')}.dp)`);
        lines.push(`${spaces})`);
        break;
      case 'image_painter':
        lines.push(`${spaces}Image(`);
        lines.push(`${spaces}    painter = painterResource(${val('Resource Name')}),`);
        lines.push(`${spaces}    contentDescription = "${val('Content Description')}",`);
        lines.push(`${spaces}    modifier = Modifier.size(200.dp)`);
        lines.push(`${spaces})`);
        break;
      case 'icon_component':
        lines.push(`${spaces}Icon(Icons.Default.${val('Icon Name', 'Favorite')}, contentDescription = null, tint = ${val('Tint Color', 'MaterialTheme.colorScheme.primary')})`);
        break;

      // ==================== CONTROL FLOW ====================
      case 'if_else':
        lines.push(`${spaces}if (${val('Condition', 'true')}) {`);
        if (children.then?.length > 0) lines.push(generateCodeFromBlocks(children.then, indent + 1));
        if (children.else?.length > 0) {
          lines.push(`${spaces}} else {`);
          lines.push(generateCodeFromBlocks(children.else, indent + 1));
        }
        lines.push(`${spaces}}`);
        break;

      case 'repeat_times':
        lines.push(`${spaces}repeat(${num('Times', '5')}) {`);
        if (children.do?.length > 0) lines.push(generateCodeFromBlocks(children.do, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'while_loop':
        lines.push(`${spaces}while (${val('Condition', 'true')}) {`);
        if (children.do?.length > 0) lines.push(generateCodeFromBlocks(children.do, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'when_expression':
        lines.push(`${spaces}when (${val('Value to Check', 'status')}) {`);
        if (children.branches?.length > 0) {
          lines.push(generateCodeFromBlocks(children.branches, indent + 1));
        } else {
          lines.push(`${spaces}    // Add cases here`);
          lines.push(`${spaces}    "case1" -> {`);
          lines.push(`${spaces}        // Handle case1`);
          lines.push(`${spaces}    }`);
          lines.push(`${spaces}    else -> {`);
          lines.push(`${spaces}        // Handle default`);
          lines.push(`${spaces}    }`);
        }
        lines.push(`${spaces}}`);
        break;

      case 'try_catch':
        lines.push(`${spaces}try {`);
        if (children.try?.length > 0) lines.push(generateCodeFromBlocks(children.try, indent + 1));
        lines.push(`${spaces}} catch (e: Exception) {`);
        if (children.catch?.length > 0) {
          lines.push(generateCodeFromBlocks(children.catch, indent + 1));
        } else {
          lines.push(`${spaces}    Log.e("Error", e.message)`);
        }
        lines.push(`${spaces}}`);
        break;

      case 'launched_effect':
        lines.push(`${spaces}LaunchedEffect(${val('Key', 'Unit')}) {`);
        if (children.do?.length > 0) lines.push(generateCodeFromBlocks(children.do, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'disposable_effect':
        lines.push(`${spaces}DisposableEffect(${val('Key', 'Unit')}) {`);
        if (children.do?.length > 0) lines.push(generateCodeFromBlocks(children.do, indent + 1));
        lines.push(`${spaces}    onDispose {`);
        if (children.onDispose?.length > 0) {
          lines.push(generateCodeFromBlocks(children.onDispose, indent + 2));
        } else {
          lines.push(`${spaces}        // Cleanup code`);
        }
        lines.push(`${spaces}    }`);
        lines.push(`${spaces}}`);
        break;

      case 'side_effect':
        lines.push(`${spaces}SideEffect {`);
        if (children.do?.length > 0) lines.push(generateCodeFromBlocks(children.do, indent + 1));
        lines.push(`${spaces}}`);
        break;

      case 'produce_state':
        lines.push(`${spaces}val ${val('Variable Name', 'data')} by produceState<${val('Type', 'String?')}>(initialValue = ${val('Initial Value', 'null')}) {`);
        if (children.do?.length > 0) {
          lines.push(generateCodeFromBlocks(children.do, indent + 1));
        } else {
          lines.push(`${spaces}    value = /* load data */`);
        }
        lines.push(`${spaces}}`);
        break;

      // Custom blocks
      case 'custom_import':
        // Imports are handled separately by generateImportsFromBlocks
        break;

      case 'custom_code':
        lines.push(`${spaces}${val('Code', '// Custom code')}`);
        break;

      default:
        lines.push(`${spaces}// TODO: ${def}`);
    }
  }

  return lines.join('\n');
};

export default generateCodeFromBlocks;
