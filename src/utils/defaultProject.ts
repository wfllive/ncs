/**
 * React + Vite + Android WebView project defaults.
 * NO Kotlin. NO Jetpack Compose. Only React JSX.
 * Visual editor tree maps to flexbox React components.
 */
import { generateId } from './generateId';
import {
  ANDROID_COMPILE_SDK, ANDROID_TARGET_SDK, ANDROID_MIN_SDK,
  PROJECTS_ROOT, REACT_VERSION, VITE_VERSION,
  packageSegment, slugifyProject,
} from '../config/runtime';

/** React components available in the visual editor (rendered as flexbox divs). */
export const componentTypes = {
  Column: {
    type: 'Column', label: 'Column (Flex)', icon: 'reorder-four-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 12, gap: 12, backgroundColor: 'transparent', alignItems: 'stretch', justifyContent: 'flex-start' },
  },
  Row: {
    type: 'Row', label: 'Row (Flex)', icon: 'reorder-three-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 12, gap: 12, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'flex-start' },
  },
  Box: {
    type: 'Box', label: 'Box', icon: 'square-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 12, backgroundColor: 'transparent', alignItems: 'flex-start' },
  },
  Card: {
    type: 'Card', label: 'Card', icon: 'card-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, shadow: 2 },
  },
  ElevatedCard: {
    type: 'ElevatedCard', label: 'Elevated Card', icon: 'card-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 16, borderRadius: 12, shadow: 4, backgroundColor: '#FFFFFF' },
  },
  Text: {
    type: 'Text', label: 'Text', icon: 'text-outline', isContainer: false,
    defaultProps: { text: 'Текст', width: 'auto', height: 'auto', fontSize: 16, color: '#111827', fontWeight: '400', textAlign: 'left', padding: 4 },
  },
  Button: {
    type: 'Button', label: 'Button', icon: 'radio-button-on-outline', isContainer: false,
    defaultProps: { text: 'Кнопка', width: 'auto', height: 'auto', fontSize: 15, color: '#FFFFFF', backgroundColor: '#4F46E5', padding: 12, borderRadius: 12 },
  },
  OutlinedButton: {
    type: 'OutlinedButton', label: 'Outlined Button', icon: 'square-outline', isContainer: false,
    defaultProps: { text: 'Кнопка', width: 'auto', height: 'auto', fontSize: 15, color: '#4F46E5', padding: 12, borderRadius: 12, borderWidth: 1 },
  },
  OutlinedTextField: {
    type: 'OutlinedTextField', label: 'Input', icon: 'create-outline', isContainer: false,
    defaultProps: { label: 'Поле', placeholder: 'Введите текст', value: '', width: '100%', height: 'auto', fontSize: 16, color: '#111827' },
  },
  Image: {
    type: 'Image', label: 'Image', icon: 'image-outline', isContainer: false,
    defaultProps: { width: 120, height: 120, borderRadius: 12, backgroundColor: '#E5E7EB', src: '' },
  },
  Checkbox: {
    type: 'Checkbox', label: 'Checkbox', icon: 'checkbox-outline', isContainer: false,
    defaultProps: { text: 'Флажок', checked: false, width: 'auto', height: 'auto', fontSize: 16, color: '#111827' },
  },
  Switch: {
    type: 'Switch', label: 'Switch', icon: 'toggle-outline', isContainer: false,
    defaultProps: { text: 'Переключатель', checked: false, width: '100%', height: 'auto' },
  },
  LinearProgressIndicator: {
    type: 'LinearProgressIndicator', label: 'Progress', icon: 'remove-outline', isContainer: false,
    defaultProps: { progress: 0.5, width: '100%', height: 8, color: '#4F46E5', trackColor: '#E5E7EB' },
  },
  CircularProgressIndicator: {
    type: 'CircularProgressIndicator', label: 'Circular Progress', icon: 'sync-outline', isContainer: false,
    defaultProps: { progress: 0.7, width: 48, height: 48, color: '#4F46E5', strokeWidth: 4 },
  },
  HorizontalDivider: {
    type: 'HorizontalDivider', label: 'Divider', icon: 'remove-outline', isContainer: false,
    defaultProps: { width: '100%', height: 1, color: '#E5E7EB' },
  },
  Spacer: {
    type: 'Spacer', label: 'Spacer', icon: 'expand-outline', isContainer: false,
    defaultProps: { width: '100%', height: 16 },
  },
  Icon: {
    type: 'Icon', label: 'Icon', icon: 'star-outline', isContainer: false,
    defaultProps: { iconName: 'star', size: 28, color: '#4F46E5' },
  },
  TopAppBar: {
    type: 'TopAppBar', label: 'Top App Bar', icon: 'chevron-down-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', title: 'MyApp', backgroundColor: '#4F46E5', color: '#FFFFFF' },
  },
  Scaffold: {
    type: 'Scaffold', label: 'Scaffold', icon: 'layers-outline', isContainer: true,
    defaultProps: { width: '100%', height: '100vh', backgroundColor: '#F8FAFC', topBar: null },
  },
  WebView: {
    type: 'WebView', label: 'WebView (iframe)', icon: 'globe-outline', isContainer: false,
    defaultProps: { url: 'https://example.com', width: '100%', height: 300 },
  },
  // React-specific extras
  LazyColumn: {
    type: 'LazyColumn', label: 'Scroll / List', icon: 'list-outline', isContainer: true,
    defaultProps: { width: '100%', height: 'auto', padding: 8, gap: 8, backgroundColor: 'transparent' },
  },
};

export const createDefaultScreen = (id, name) => ({
  id: id || generateId(),
  name: name || 'Home',
  fileName: `${name || 'Home'}.jsx`,
  // Default tree is a simple Column with a Text + Button to show React immediately
  rootComponent: {
    id: generateId(), type: 'Column',
    props: { width: '100%', height: 'auto', padding: 16, gap: 16, backgroundColor: '#F8FAFC' },
    children: [
      { id: generateId(), type: 'Text', props: { text: `Экран ${name || 'Home'}`, fontSize: 22, color: '#111827', fontWeight: '700' }, children: [] },
      { id: generateId(), type: 'Text', props: { text: 'Сделано на React + Vite + WebView', fontSize: 14, color: '#64748B' }, children: [] },
      { id: generateId(), type: 'Button', props: { text: 'Нажми меня', backgroundColor: '#4F46E5', color: '#FFFFFF' }, children: [] },
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
    platform: 'android-react-webview',
    name,
    slug,
    projectDir: options.projectDir || `${PROJECTS_ROOT}/${slug}`,
    createdWith: options.createdWith || 'React + Vite (Android)',
    packageName: options.packageName || `com.rnstudio.${packageSegment(slug)}`,
    namespace: options.namespace || options.packageName || `com.rnstudio.${packageSegment(slug)}`,
    versionName: options.versionName || '1.0.0',
    versionCode: options.versionCode || 1,
    minSdk: options.minSdk || ANDROID_MIN_SDK,
    targetSdk: options.targetSdk || ANDROID_TARGET_SDK,
    compileSdk: options.compileSdk || ANDROID_COMPILE_SDK,
    reactVersion: options.reactVersion || REACT_VERSION,
    viteVersion: options.viteVersion || VITE_VERSION,
    gradleDependencies: [],
    signing: options.signing || { keystorePath: '', keyAlias: '', storePasswordEnv: 'KEYSTORE_PASSWORD', keyPasswordEnv: 'KEY_PASSWORD' },
    createdAt: options.createdAt || Date.now(),
    updatedAt: Date.now(),
    icon: 'logo-react',
    theme: { primaryColor: '#4F46E5', secondaryColor: '#0E7490', backgroundColor: '#F8FAFC', isDark: false, ...(options.theme || {}) },
    screens: options.screens || [],
    variables: options.variables || [
      { id: generateId(), name: 'counter', type: 'number', value: 0 },
      { id: generateId(), name: 'username', type: 'text', value: '' },
    ],
    lists: options.lists || [],
    components: options.components || [],
  };
};

const legacyTypes = {
  ScrollView: 'LazyColumn', CardView: 'Card', TextView: 'Text', EditText: 'OutlinedTextField',
  ImageView: 'Image', CheckBox: 'Checkbox', ProgressBar: 'LinearProgressIndicator', Divider: 'HorizontalDivider',
  MapView: 'Box',
};
const migrateNode = (node) => {
  if (!node) return node;
  const type = node.type === 'LinearLayout'
    ? (node.props?.orientation === 'horizontal' ? 'Row' : 'Column')
    : (legacyTypes[node.type] || node.type);
  const props = { ...(componentTypes[type]?.defaultProps || {}), ...(node.props || {}) };
  // convert old dp numeric props to CSS px
  if (props.width === 'match_parent') props.width = '100%';
  if (props.width === 'wrap_content') props.width = 'auto';
  if (props.height === 'match_parent') props.height = '100%';
  if (props.height === 'wrap_content') props.height = 'auto';
  return { ...node, type, props, children: (node.children || []).map(migrateNode) };
};

export const migrateToComposeProject = (project) => {
  if (project?.platform === 'android-react-webview') return project;
  // Migrate old Compose project to React
  const base = createDefaultProject({
    ...project,
    name: project?.name || 'Android App',
    projectDir: `${PROJECTS_ROOT}/${project?.slug || slugifyProject(project?.name || 'android-app')}`,
    packageName: project?.packageName || `com.rnstudio.${packageSegment(project?.slug || project?.name)}`,
    screens: (project?.screens || []).map((screen) => ({
      ...screen,
      fileName: screen.fileName?.replace(/Activity\.kt$/, '.jsx') || `${screen.name || 'Screen'}.jsx`,
      rootComponent: migrateNode(screen.rootComponent),
    })),
  });
  return { ...base, id: project.id || base.id, createdAt: project.createdAt || base.createdAt, updatedAt: Date.now(), platform: 'android-react-webview' };
};

export default createDefaultProject;
