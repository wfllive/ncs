/**
 * Defaults для проектов **Java + XML** (классический Android).
 * Визуальное дерево экрана конвертируется в Android-разметку
 * (см. treeNodeToXml в javaProject.ts), а исходный код — обычный Java.
 */
import { generateId } from './generateId';
import {
  ANDROID_COMPILE_SDK, ANDROID_TARGET_SDK, ANDROID_MIN_SDK,
  PROJECTS_ROOT,
  packageSegment, slugifyProject,
} from '../config/runtime';

/** Палитра виджетов визуального редактора (маппинг в Android — в javaProject.ts). */
export const componentTypes: Record<string, any> = {
  Column: {
    type: 'Column', label: 'LinearLayout ↓', icon: 'reorder-four-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 12, gap: 8, backgroundColor: 'transparent', alignItems: 'stretch', justifyContent: 'flex-start' },
  },
  Row: {
    type: 'Row', label: 'LinearLayout →', icon: 'reorder-three-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 12, gap: 8, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'flex-start' },
  },
  Box: {
    type: 'Box', label: 'FrameLayout', icon: 'square-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 12, backgroundColor: 'transparent', alignItems: 'flex-start' },
  },
  Card: {
    type: 'Card', label: 'Card', icon: 'card-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, shadow: 2 },
  },
  ElevatedCard: {
    type: 'ElevatedCard', label: 'Elevated Card', icon: 'card-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 16, borderRadius: 12, shadow: 4, backgroundColor: '#FFFFFF' },
  },
  Text: {
    type: 'Text', label: 'TextView', icon: 'text-outline', isContainer: false,
    defaultProps: { text: 'Текст', width: 'wrap_content', height: 'wrap_content', fontSize: 16, color: '#1C1B1F', fontWeight: '400', textAlign: 'left', padding: 4 },
  },
  Button: {
    type: 'Button', label: 'Button', icon: 'radio-button-on-outline', isContainer: false,
    defaultProps: { text: 'Кнопка', width: 'wrap_content', height: 'wrap_content', fontSize: 15, color: '#FFFFFF', backgroundColor: '#6750A4', padding: 12, borderRadius: 20 },
  },
  OutlinedButton: {
    type: 'OutlinedButton', label: 'Outlined Button', icon: 'square-outline', isContainer: false,
    defaultProps: { text: 'Кнопка', width: 'wrap_content', height: 'wrap_content', fontSize: 15, color: '#6750A4', padding: 12, borderRadius: 20, borderWidth: 1 },
  },
  OutlinedTextField: {
    type: 'OutlinedTextField', label: 'EditText', icon: 'create-outline', isContainer: false,
    defaultProps: { label: 'Поле', placeholder: 'Введите текст', value: '', width: 'match_parent', height: 'wrap_content', fontSize: 16, color: '#1C1B1F' },
  },
  Image: {
    type: 'Image', label: 'ImageView', icon: 'image-outline', isContainer: false,
    defaultProps: { width: 120, height: 120, borderRadius: 12, backgroundColor: '#DDE1E6', src: '' },
  },
  Checkbox: {
    type: 'Checkbox', label: 'CheckBox', icon: 'checkbox-outline', isContainer: false,
    defaultProps: { text: 'Флажок', checked: false, width: 'wrap_content', height: 'wrap_content', fontSize: 16, color: '#1C1B1F' },
  },
  Switch: {
    type: 'Switch', label: 'Switch', icon: 'toggle-outline', isContainer: false,
    defaultProps: { text: 'Переключатель', checked: false, width: 'match_parent', height: 'wrap_content' },
  },
  LinearProgressIndicator: {
    type: 'LinearProgressIndicator', label: 'ProgressBar', icon: 'remove-outline', isContainer: false,
    defaultProps: { progress: 0.5, width: 'match_parent', height: 8, color: '#6750A4', trackColor: '#E6E0E9' },
  },
  CircularProgressIndicator: {
    type: 'CircularProgressIndicator', label: 'Progress (круг)', icon: 'sync-outline', isContainer: false,
    defaultProps: { progress: 0.7, width: 48, height: 48, color: '#6750A4', strokeWidth: 4 },
  },
  HorizontalDivider: {
    type: 'HorizontalDivider', label: 'Divider', icon: 'remove-outline', isContainer: false,
    defaultProps: { width: 'match_parent', height: 1, color: '#CAC4D0' },
  },
  Spacer: {
    type: 'Spacer', label: 'Space', icon: 'expand-outline', isContainer: false,
    defaultProps: { width: 'match_parent', height: 16 },
  },
  Icon: {
    type: 'Icon', label: 'Icon', icon: 'star-outline', isContainer: false,
    defaultProps: { iconName: 'star', size: 28, color: '#6750A4' },
  },
  TopAppBar: {
    type: 'TopAppBar', label: 'Toolbar', icon: 'chevron-down-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 56, title: 'MyApp', backgroundColor: '#6750A4', color: '#FFFFFF' },
  },
  Scaffold: {
    type: 'Scaffold', label: 'Scaffold', icon: 'layers-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'match_parent', backgroundColor: '#FCFCFC', topBar: null },
  },
  WebView: {
    type: 'WebView', label: 'WebView', icon: 'globe-outline', isContainer: false,
    defaultProps: { url: 'https://example.com', width: 'match_parent', height: 300 },
  },
  LazyColumn: {
    type: 'LazyColumn', label: 'ScrollView', icon: 'list-outline', isContainer: true,
    defaultProps: { width: 'match_parent', height: 'wrap_content', padding: 8, gap: 8, backgroundColor: 'transparent' },
  },
};

/** Экран по умолчанию: колонка с заголовком и кнопкой. */
export const createDefaultScreen = (id: string | null, name: string) => ({
  id: id || generateId(),
  name: name || 'Home',
  fileName: `activity_${String(name || 'Home').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'home'}.xml`,
  rootComponent: {
    id: generateId(), type: 'Column',
    props: { width: 'match_parent', height: 'match_parent', padding: 24, gap: 16, backgroundColor: '#FCFCFC', alignItems: 'center', justifyContent: 'center' },
    children: [
      { id: generateId(), type: 'Text', props: { text: `Экран ${name || 'Home'}`, fontSize: 24, color: '#1C1B1F', fontWeight: '700', textAlign: 'center' }, children: [] },
      { id: generateId(), type: 'Text', props: { text: 'Java + XML · кастомная сборка без Gradle', fontSize: 14, color: '#666E7B', textAlign: 'center' }, children: [] },
      { id: generateId(), type: 'Button', props: { text: 'Нажми меня', backgroundColor: '#6750A4', color: '#FFFFFF' }, children: [] },
    ],
  },
  blocks: [],
});

export const createDefaultProject = (nameOrOptions: string | Record<string, any> = 'Новый проект') => {
  const options: Record<string, any> = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions || {});
  const name = options.name || 'Новый проект';
  const slug = options.slug || slugifyProject(name);
  return {
    id: options.id || generateId(),
    platform: 'android-java-xml',
    name,
    slug,
    projectDir: options.projectDir || `${PROJECTS_ROOT}/${slug}`,
    createdWith: options.createdWith || 'Java + XML (кастомная сборка)',
    packageName: options.packageName || `com.rnstudio.${packageSegment(slug)}`,
    namespace: options.namespace || options.packageName || `com.rnstudio.${packageSegment(slug)}`,
    versionName: options.versionName || '1.0.0',
    versionCode: options.versionCode || 1,
    minSdk: options.minSdk || ANDROID_MIN_SDK,
    targetSdk: options.targetSdk || ANDROID_TARGET_SDK,
    compileSdk: options.compileSdk || ANDROID_COMPILE_SDK,
    gradleDependencies: [], // оставлено для совместимости настроек; зависимости не используются
    signing: options.signing || { keystorePath: '', keyAlias: '', storePasswordEnv: 'KEYSTORE_PASSWORD', keyPasswordEnv: 'KEY_PASSWORD' },
    createdAt: options.createdAt || Date.now(),
    updatedAt: Date.now(),
    icon: 'logo-android',
    theme: { primaryColor: '#6750A4', secondaryColor: '#0E7490', backgroundColor: '#FCFCFC', isDark: false, ...(options.theme || {}) },
    screens: options.screens || [],
    variables: options.variables || [],
    lists: options.lists || [],
    components: options.components || [],
  };
};

/* ----------------------------------------------------------- миграция */

const legacyTypes: Record<string, string> = {
  ScrollView: 'LazyColumn', CardView: 'Card', TextView: 'Text', EditText: 'OutlinedTextField',
  ImageView: 'Image', CheckBox: 'Checkbox', ProgressBar: 'LinearProgressIndicator', Divider: 'HorizontalDivider',
  MapView: 'Box',
};

const migrateNode = (node: any): any => {
  if (!node) return node;
  const type = node.type === 'LinearLayout'
    ? (node.props?.orientation === 'horizontal' ? 'Row' : 'Column')
    : (legacyTypes[node.type] || node.type);
  const props = { ...(componentTypes[type]?.defaultProps || {}), ...(node.props || {}) };
  if (props.width === '100%') props.width = 'match_parent';
  if (props.width === 'auto') props.width = 'wrap_content';
  if (props.height === '100%') props.height = 'match_parent';
  if (props.height === 'auto') props.height = 'wrap_content';
  return { ...node, type, props, children: (node.children || []).map(migrateNode) };
};

/**
 * Миграция проектов старых платформ (Kotlin/Compose, React+WebView) на Java + XML.
 * Имя экспорта сохранено для совместимости с projectStore.
 */
export const migrateToComposeProject = (project: any) => {
  if (project?.platform === 'android-java-xml') return project;
  const base = createDefaultProject({
    ...project,
    name: project?.name || 'Android App',
    projectDir: `${PROJECTS_ROOT}/${project?.slug || slugifyProject(project?.name || 'android-app')}`,
    packageName: project?.packageName || `com.rnstudio.${packageSegment(project?.slug || project?.name)}`,
    screens: (project?.screens || []).map((screen: any) => ({
      ...screen,
      // Старые сохранённые исходники (Kotlin/JSX) больше не подходят —
      // перегенерируем из дерева; пользовательский код будет создан заново.
      source: undefined,
      layoutXml: undefined,
      fileName: `activity_${String(screen.name || 'Screen').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'screen'}.xml`,
      rootComponent: migrateNode(screen.rootComponent),
    })),
  });
  return {
    ...base,
    id: project?.id || base.id,
    createdAt: project?.createdAt || base.createdAt,
    updatedAt: Date.now(),
    platform: 'android-java-xml',
  };
};

export default createDefaultProject;
