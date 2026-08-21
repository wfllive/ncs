import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppScreen, IconButton, PrimaryButton, SectionCard, SegmentedControl, TopBar } from '../components/AppUI';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import CodeMirrorEditor from '../ide/CodeMirrorEditor';
import WidgetRenderer from '../components/WidgetRenderer';
import FileExplorer from '../components/FileExplorer';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { generateScreenJSX, writeScreenSource, syncComposeProject } from '../utils/composeProject';
import { findMissingImports, addMissingImports, fileStats } from '../utils/importManager';
import { analyzeKotlin as analyzeJS, summarizeProblems } from '../utils/kotlinAnalyzer';
import { readProjectFile, writeProjectFile, listProjectFiles } from '../utils/projectFiles';
import { execute } from '../utils/shellExecutor';
import { getProjectDir } from '../config/runtime';
import { layoutFileName } from '../utils/javaProject';
import { renderScreenPreviewHtml, validateLayout } from '../utils/layoutPreview';
import EditorSettings from '../components/EditorSettings';
import { WebView } from 'react-native-webview';
import { cn } from "../utils/cn";
const fileIcon = ext => {
  switch (ext) {
    case 'java':
      return {
        name: 'logo-android',
        color: '#E76F00'
      };
    case 'xml':
      return {
        name: 'code-outline',
        color: '#4DB337'
      };
    case 'jsx':
      return {
        name: 'logo-react',
        color: '#61DAFB'
      };
    case 'js':
      return {
        name: 'logo-javascript',
        color: '#F7DF1E'
      };
    case 'tsx':
      return {
        name: 'logo-react',
        color: '#61DAFB'
      };
    case 'ts':
      return {
        name: 'logo-javascript',
        color: '#3178C6'
      };
    case 'css':
      return {
        name: 'color-palette-outline',
        color: '#1572B6'
      };
    case 'html':
      return {
        name: 'code-outline',
        color: '#E34F26'
      };
    case 'json':
      return {
        name: 'braces-outline',
        color: '#F7C948'
      };
    case 'md':
      return {
        name: 'document-text-outline',
        color: '#7FB8E8'
      };
    default:
      return {
        name: 'document-outline',
        color: '#8B98AD'
      };
  }
};
const SYMBOL_KEYS = ['{', '}', '(', ')', '[', ']', '<', '>', '=', ';', ':', '.', ',', '"', '\'', '`', '$', '_', '|', '&', '?', '!', '/', '-', '+', '*', '%', '#', '@'];
const PREVIEW_DEVICES = [{
  id: 'compact',
  label: '360×800',
  widthDp: 360,
  heightDp: 800
}, {
  id: 'standard',
  label: '412×915',
  widthDp: 412,
  heightDp: 915
}, {
  id: 'tablet',
  label: '768×1024',
  widthDp: 768,
  heightDp: 1024
}];
const EditorScreen = ({
  navigation
}) => {
  const {
    width,
    height
  } = useWindowDimensions();
  const {
    currentProject,
    currentScreenId,
    setCurrentScreen,
    addScreen,
    deleteScreen,
    duplicateScreen,
    workspaceLogs,
    clearWorkspaceLogs,
    addWorkspaceLog,
    closeProject,
    dispatch,
    updateScreen
  } = useProject();
  const {
    colors,
    language,
    t,
    editor,
    setEditorSetting,
    resolvedTheme
  } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  const narrow = width < 600; // компактный режим на телефонах
  const editorTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const ide = useMemo(() => editorTheme === 'light' ? {
    editorBg: '#FFFFFF',
    panel: '#F3F3F3',
    panelBorder: '#D4D4D4',
    panelText: '#424242',
    panelTextDim: '#6E6E6E',
    status: '#007ACC'
  } : {
    editorBg: '#1E1E1E',
    panel: '#252526',
    panelBorder: '#3C3C3C',
    panelText: '#CCCCCC',
    panelTextDim: '#858585',
    status: '#007ACC'
  }, [editorTheme]);
  const [activeTab, setActiveTab] = useState('editor'); // editor | preview | design
  const [previewDeviceId, setPreviewDeviceId] = useState('compact');
  const [previewChrome, setPreviewChrome] = useState(true);
  const [previewMode, setPreviewMode] = useState('webview'); // webview (реальный код) | visual (mockup дерева)
  const [yarnDevRunning, setYarnDevRunning] = useState(false);
  const [yarnDevLog, setYarnDevLog] = useState('');
  const [webViewError, setWebViewError] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0); // bump → WebView перезагружается (свежий код)
  const viteProcRef = useRef(null); // holds the non-awaited Vite execute (keeps proot+vite alive)
  useEffect(() => {
    setWebViewError(false);
  }, [previewMode, activeTab, currentScreenId]);
  // (preview/vite effect перенесён ниже — после объявления previewVisible, чтобы не было TDZ)

  const [screenMenu, setScreenMenu] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [newScreenOpen, setNewScreenOpen] = useState(false);
  const [newScreenName, setNewScreenName] = useState('');
  const [logMode, setLogMode] = useState('hidden');
  const [dockTab, setDockTab] = useState('output');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [activeFile, setActiveFile] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [dirtyByPath, setDirtyByPath] = useState({});
  const [missingList, setMissingList] = useState([]);
  const [lintProblems, setLintProblems] = useState([]);
  const [cursorInfo, setCursorInfo] = useState({
    line: 1,
    col: 1,
    lines: 0,
    canUndo: false,
    canRedo: false
  });
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoValue, setGotoValue] = useState('');
  const [build, setBuild] = useState({
    running: false,
    ok: false,
    output: '',
    at: 0
  });
  const [previewGuardUnlocked, setPreviewGuardUnlocked] = useState(false);
  useEffect(() => {
    setPreviewGuardUnlocked(false);
  }, [activeTab, currentScreenId]);
  const previewEnabled = editor.designPreview !== false;
  const guardOn = !!editor.designPreviewGuard;
  const previewVisible = previewEnabled && (!guardOn || previewGuardUnlocked);

  // HOT RELOAD предпросмотр: никакого сервера нет — макет рендерится встроенным
  // движком (layoutPreview) прямо в WebView из текущего кода. «Запуск» мгновенный.
  const startVite = useCallback(async () => {
    setYarnDevLog(language === 'ru' ? 'hot reload: рендер из кода (офлайн)' : 'hot reload: rendered from code (offline)');
    return true;
  }, [language]);

  // «Готовность» превью при входе во вкладку — мгновенно (нет сервера).
  useEffect(() => {
    if (activeTab !== 'design' || !previewVisible || previewMode !== 'webview') return;
    setYarnDevRunning(true);
    setYarnDevLog(language === 'ru' ? 'hot reload: рендер из кода (офлайн)' : 'hot reload: rendered from code (offline)');
    setWebViewError(false);
  }, [activeTab, previewVisible, previewMode, currentProject?.id, language]);

  // Сам горячий рендер: при каждом изменении черновика/сохранении пересобираем
  // HTML-копию макета. Если активен файл макета — берём прямо из редактора
  // (превью показывает ровно то, что набрано), иначе — сохранённый макет экрана.
  const [previewHtml, setPreviewHtml] = useState('');
  useEffect(() => {
    if (activeTab !== 'design' || !previewVisible || previewMode !== 'webview') return;
    const proj = latestProjectRef.current || currentProject;
    if (!proj || !currentScreen) return;
    let cancelled = false;
    const activeIsLayout = Boolean(activeFile?.isScreen) || String(activeFile?.path || '').startsWith('app/res/layout/');
    const xml = activeIsLayout
      ? draft
      : (currentScreen.layoutXml || generateScreenJSX(currentScreen, proj));
    const layoutPath = activeFile?.path || `app/res/layout/${layoutFileName(currentScreen, Math.max(0, (proj.screens || []).findIndex(s => s.id === currentScreen.id)))}`;
    renderScreenPreviewHtml(proj, xml, {
      fileName: layoutPath,
      title: currentScreen.name,
      widthDp: previewDevice.widthDp,
      heightDp: previewDevice.heightDp,
    }).then(h => {
      if (!cancelled) setPreviewHtml(h);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab, previewVisible, previewMode, draft, previewNonce, currentScreenId, previewDeviceId, activeFile?.path]); // eslint-disable-line
  const editorApi = useRef(null);
  const draftRef = useRef('');
  const savedRef = useRef({});
  const dirtyRef = useRef({});
  const closingRef = useRef(false);
  const saveTimerRef = useRef(null);
  const lintTimerRef = useRef(null);
  const latestProjectRef = useRef(currentProject);
  useEffect(() => {
    latestProjectRef.current = currentProject;
  }, [currentProject]);
  const currentScreen = currentProject?.screens?.find(s => s.id === currentScreenId);
  const previewDevice = PREVIEW_DEVICES.find(x => x.id === previewDeviceId) || PREVIEW_DEVICES[0];
  // Масштаб рамки устройства под доступное место (края не обрезаются).
  const previewScale = useMemo(() => {
    const availW = (width || 360) - 32;
    const availH = (height || 640) - 215; // topBar + workspaceBar + previewHead + logDock
    return Math.max(0.3, Math.min(availW / (previewDevice.widthDp || 360), availH / (previewDevice.heightDp || 800), 1));
  }, [width, height, previewDevice]);
  const ru = language === 'ru';
  // Экран в модели Java + XML — это его XML-макет (код — источник истины).
  const screenIndex = useMemo(() => Math.max(0, (currentProject?.screens || []).findIndex(s => s.id === currentScreen?.id)), [currentProject, currentScreen]);
  const screenFilePath = useMemo(() => {
    if (!currentProject || !currentScreen) return null;
    return `app/res/layout/${layoutFileName(currentScreen, screenIndex)}`;
  }, [currentProject, currentScreen, screenIndex]);
  const copy = ru ? {
    noProject: 'Проект не открыт',
    screenName: 'Название экрана',
    deleteScreen: 'Удалить экран?',
    lastScreen: 'Нельзя удалить единственный экран.',
    consoleReady: 'Редактор готов. Откройте файл слева или сохраните макет.',
    clear: 'Очистить',
    output: 'Вывод',
    problems: 'Проблемы',
    noProblems: 'Проблем не найдено',
    closing: 'Сохраняем и закрываем…',
    save: 'Сохранить',
    saving: 'Сохранение…',
    saved: 'Файл записан',
    saveFailed: 'Ошибка сохранения',
    codePlaceholder: '<!-- Макет экрана Android -->\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:orientation="vertical">\n\n    <TextView\n        android:layout_width="wrap_content"\n        android:layout_height="wrap_content"\n        android:text="Привет, мир!" />\n\n</LinearLayout>',
    design: 'Дизайн',
    editor: 'Код',
    preview: 'Превью',
    readOnly: 'Только чтение',
    unsaved: 'Несохранённые изменения',
    unsavedHint: 'Сохранить перед переключением?',
    discard: 'Не сохранять',
    unsavedSave: 'Сохранить',
    gotoLine: 'Перейти к строке',
    lineNumber: 'Номер строки',
    goto: 'Перейти',
    openFile: 'Открыть файл',
    fallback: 'Предпросмотр недоступен — простой редактор',
    importsFix: 'Добавить импорт React',
    checkCode: 'Проверить (макеты + build.sh)',
    checkRunning: 'Сборка…',
    checkOk: 'Сборка успешна',
    checkFailed: 'Сборка упала'
  } : {
    noProject: 'No project open',
    screenName: 'Screen name',
    deleteScreen: 'Delete screen?',
    lastScreen: 'Cannot delete the only screen.',
    consoleReady: 'Editor ready. Open a file or save the layout.',
    clear: 'Clear',
    output: 'Output',
    problems: 'Problems',
    noProblems: 'No problems',
    closing: 'Saving and closing…',
    save: 'Save',
    saving: 'Saving…',
    saved: 'File written',
    saveFailed: 'Save failed',
    codePlaceholder: '<!-- Android screen layout -->\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:orientation="vertical">\n\n    <TextView\n        android:layout_width="wrap_content"\n        android:layout_height="wrap_content"\n        android:text="Hello, world!" />\n\n</LinearLayout>',
    design: 'Design',
    editor: 'Code',
    preview: 'Preview',
    readOnly: 'Read only',
    unsaved: 'Unsaved changes',
    unsavedHint: 'Save before switching?',
    discard: "Don't save",
    unsavedSave: 'Save',
    gotoLine: 'Go to line',
    lineNumber: 'Line number',
    goto: 'Go',
    openFile: 'Open file',
    fallback: 'Preview unavailable — fallback editor',
    importsFix: 'Add React import',
    checkCode: 'Check (layouts + build.sh)',
    checkRunning: 'Building…',
    checkOk: 'Build succeeded',
    checkFailed: 'Build failed'
  };
  const setDirtyState = useCallback((path, flag) => {
    dirtyRef.current = {
      ...dirtyRef.current,
      [path]: flag
    };
    setDirtyByPath(prev => ({
      ...prev,
      [path]: flag
    }));
  }, []);
  useEffect(() => {
    if (!currentScreen || !screenFilePath) return;
    // Макет экрана: сохранённый пользователем либо сгенерированный из дерева.
    let source = currentScreen.layoutXml || '';
    if (!source || !source.trim()) {
      try {
        source = generateScreenJSX(currentScreen, currentProject);
      } catch (e) {
        source = `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent" />\n`;
      }
    }
    const tab = {
      path: screenFilePath,
      name: `${currentScreen.name}.xml`,
      isScreen: true
    };
    savedRef.current[screenFilePath] = source;
    draftRef.current = source;
    setDraft(source);
    setActiveFile(tab);
    setOpenTabs(prev => [tab, ...prev.filter(t => !t.isScreen)]);
    setDirtyState(screenFilePath, false);
  }, [currentScreen?.id]); // eslint-disable-line

  useEffect(() => {
    if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    lintTimerRef.current = setTimeout(() => {
      // Живая проверка по типу активного файла:
      //  .xml — разбор макета (мгновенно, без компиляции);
      //  прочие (Java и др.) — без статического анализа, ошибки покажет сборка.
      const path = activeFile?.path || '';
      if (path.endsWith('.xml')) {
        const errs = validateLayout(draft);
        setLintProblems(errs.map(e => ({ line: e.line || 1, col: 1, severity: 'error', message: e.message })));
      } else {
        setLintProblems([]);
      }
      setMissingList([]);
    }, 300);
    return () => {
      if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    };
  }, [draft, activeFile?.path]);
  const handleEditorChange = useCallback(text => {
    draftRef.current = text;
    setDraft(text);
    const path = activeFile?.path;
    if (path) setDirtyState(path, text !== (savedRef.current[path] ?? ''));
  }, [activeFile?.path, setDirtyState]);
  const applyMissingImports = useCallback(() => {
    const withImp = addMissingImports(draftRef.current, missingList);
    if (withImp !== draftRef.current) {
      draftRef.current = withImp;
      setDraft(withImp);
      setMissingList([]);
      addWorkspaceLog(ru ? `Добавлен импорт React` : `Added React import`, 'success');
    }
  }, [missingList, addWorkspaceLog, ru]);
  const doSave = useCallback(async (silent = false) => {
    if (!currentProject) return {
      success: false
    };
    const content = draftRef.current;
    if (activeFile && activeFile.isScreen && currentScreen) {
      const result = await writeScreenSource(latestProjectRef.current || currentProject, currentScreen, content);
      if (result?.success) {
        // Сохранённый макет — источник истины для превью и для сборки.
        updateScreen({
          ...currentScreen,
          layoutXml: content
        });
        savedRef.current[activeFile.path] = content;
        setDirtyState(activeFile.path, false);
        setPreviewNonce(n => n + 1);
        if (!silent) addWorkspaceLog(`${copy.saved} · ${activeFile.path}`, 'success');
      } else if (!silent) addWorkspaceLog(result?.output || copy.saveFailed, 'error');
      return result;
    }
    if (activeFile) {
      const result = await writeProjectFile(latestProjectRef.current || currentProject, activeFile.path, content);
      if (result?.success) {
        savedRef.current[activeFile.path] = content;
        setDirtyState(activeFile.path, false);
        setPreviewNonce(n => n + 1);
        if (!silent) addWorkspaceLog(`${copy.saved} · ${activeFile.name}`, 'success');
      } else if (!silent) addWorkspaceLog(result?.output || copy.saveFailed, 'error');
      return result;
    }
    return {
      success: false
    };
  }, [currentProject, currentScreen, activeFile, updateScreen, addWorkspaceLog, copy.saved, copy.saveFailed, setDirtyState]);
  useEffect(() => {
    if (!editor.autoSave || !currentProject) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      doSave(true);
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, editor.autoSave, activeFile?.path]);
  const guardUnsaved = useCallback(next => {
    const path = activeFile?.path;
    if (!path || !dirtyRef.current[path]) {
      next();
      return;
    }
    if (editor.autoSave) {
      doSave(true).finally(next);
      return;
    }
    Alert.alert(copy.unsaved, copy.unsavedHint, [{
      text: t('cancel'),
      style: 'cancel'
    }, {
      text: copy.discard,
      style: 'destructive',
      onPress: () => {
        setDirtyState(path, false);
        next();
      }
    }, {
      text: copy.unsavedSave,
      onPress: async () => {
        await doSave(true);
        next();
      }
    }]);
  }, [activeFile?.path, editor.autoSave, doSave, t, copy.unsaved, copy.unsavedHint, copy.discard, copy.unsavedSave, setDirtyState]);
  const openFileByPath = useCallback(async path => {
    if (!currentProject) return;
    if (activeFile?.path === path) return;
    try {
      const read = await readProjectFile(currentProject, path);
      const name = path.split('/').pop() || path;
      const text = read.output || '';
      const tab = {
        path,
        name,
        isScreen: false
      };
      savedRef.current[path] = text;
      draftRef.current = text;
      setDraft(text);
      setActiveFile(tab);
      setOpenTabs(prev => prev.some(t => t.path === path) ? prev : [...prev, tab]);
      setDirtyState(path, false);
      addWorkspaceLog(`${ru ? 'Открыт файл' : 'Opened'}: ${path}`, 'info');
    } catch (e) {
      addWorkspaceLog(`Open failed: ${e?.message || String(e)}`, 'error');
    }
  }, [currentProject, activeFile?.path, addWorkspaceLog, ru]);
  const onOpenFile = useCallback(path => {
    if (activeFile?.path === path) return;
    guardUnsaved(() => {
      openFileByPath(path);
    });
  }, [activeFile?.path, guardUnsaved, openFileByPath]);
  const activateScreenTab = useCallback(tab => {
    const project = latestProjectRef.current;
    const screen = (project?.screens || []).find(s => `${s.name}.xml` === tab.name);
    if (!screen) return;
    if (screen.id !== currentScreenId) {
      setCurrentScreen(screen.id);
      return;
    }
    let source = screen.layoutXml || '';
    if (!source) try {
      source = generateScreenJSX(screen, project);
    } catch (e) {
      source = `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent" />\n`;
    }
    savedRef.current[tab.path] = source;
    draftRef.current = source;
    setDraft(source);
    setActiveFile(tab);
    setDirtyState(tab.path, false);
  }, [currentScreenId, setCurrentScreen, setDirtyState]);
  const activateTab = useCallback(tab => {
    if (!tab || tab.path === activeFile?.path) return;
    guardUnsaved(() => {
      if (tab.isScreen) activateScreenTab(tab);else openFileByPath(tab.path);
    });
  }, [activeFile?.path, guardUnsaved, activateScreenTab, openFileByPath]);
  const closeTab = useCallback(tab => {
    if (tab.isScreen) return;
    const finish = () => {
      const rest = openTabs.filter(t => t.path !== tab.path);
      setOpenTabs(rest);
      if (activeFile?.path === tab.path) {
        const next = rest.find(t => !t.isScreen) || rest[0];
        if (next && !next.isScreen) openFileByPath(next.path);else if (next) activateScreenTab(next);
      }
    };
    if (dirtyRef.current[tab.path]) guardUnsaved(finish);else finish();
  }, [activeFile?.path, openTabs, guardUnsaved, openFileByPath, activateScreenTab]);
  // Быстрая проверка БЕЗ сборки: синхронизация исходников на диск +
  // разбор всех макетов + синтаксис build.sh. Полная проверка — на экране «Сборка».
  const runBuildCheck = useCallback(async () => {
    if (build.running || !currentProject) return;
    setBuild(c => ({
      ...c,
      running: true
    }));
    addWorkspaceLog(ru ? 'Проверка: макеты + build.sh' : 'Check: layouts + build.sh', 'info');
    try {
      await doSave(true);
      const cwd = getProjectDir(latestProjectRef.current || currentProject);
      const sync = await syncComposeProject(latestProjectRef.current || currentProject);
      addWorkspaceLog(sync.output || 'sync done', 'info');
      const result = await execute(
        'rc=0; for f in res/layout/*.xml; do [ -f "$f" ] || continue; head -c 1 "$f" >/dev/null || { echo "FAIL: $f"; rc=1; }; done; ' +
        'bash -n build.sh 2>&1 || { echo "FAIL: build.sh"; rc=1; }; ' +
        '[ -f AndroidManifest.xml ] || { echo "FAIL: AndroidManifest.xml отсутствует"; rc=1; }; ' +
        'echo "CHECK_EXIT:$rc"', cwd);
      const out = result?.output || '';
      const failed = /FAIL:/.test(out) || /CHECK_EXIT:1/.test(out);
      setBuild({
        running: false,
        ok: !failed,
        output: out,
        at: Date.now()
      });
      addWorkspaceLog(failed ? copy.checkFailed : copy.checkOk, failed ? 'error' : 'success');
      if (failed) setLogMode('half');
    } catch (e) {
      setBuild(c => ({
        ...c,
        running: false,
        ok: false,
        output: String(e)
      }));
      addWorkspaceLog(`${copy.checkFailed}: ${e?.message || String(e)}`, 'error');
    }
  }, [build.running, currentProject, doSave, addWorkspaceLog, copy.checkOk, copy.checkFailed, ru]);
  const saveNow = useCallback(async () => {
    if (saving || !currentProject) return;
    setSaving(true);
    try {
      const r = await doSave(false);
      if (!r?.success) addWorkspaceLog(copy.saveFailed, 'error');
    } catch (e) {
      addWorkspaceLog(`${copy.saveFailed}: ${e?.message || String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
    if (editor.autoCheck !== false) runBuildCheck();
  }, [saving, currentProject, doSave, addWorkspaceLog, copy.saveFailed, editor.autoCheck, runBuildCheck]);
  const closeAndExit = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (currentProject) {
      addWorkspaceLog(copy.closing, 'info');
      try {
        await doSave(false);
      } catch (e) {}
    }
    try {
      await closeProject();
    } catch (e) {}
    navigation.reset({
      index: 0,
      routes: [{
        name: 'Projects'
      }]
    });
  }, [currentProject, closeProject, navigation, copy.closing, addWorkspaceLog, doSave]);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeAndExit();
      return true;
    });
    return () => sub.remove();
  }, [closeAndExit]));

  // При открытии вкладки Превью — сохранить черновик в файл, чтобы Vite (и WebView)
  // показали свежий код. doSave читает draftRef.current (актуальный текст).
  useEffect(() => {
    if (activeTab === 'design' && currentProject) {
      doSave(true);
    }
  }, [activeTab]); // eslint-disable-line
  useEffect(() => navigation.addListener('beforeRemove', e => {
    if (closingRef.current) return;
    e.preventDefault();
    closeAndExit();
  }), [navigation, closeAndExit]);
  if (!currentProject) {
    return <AppScreen className={styles.center}><Icon name="folder-open-outline" size={42} color={colors.textTertiary} /><Text className={styles.emptyText}>{copy.noProject}</Text><PrimaryButton title={t('projects')} icon="arrow-back" onPress={() => navigation.navigate('Projects')} /></AppScreen>;
  }
  const tabs = [{
    key: 'editor',
    label: copy.editor,
    icon: 'code-slash-outline',
    action: () => setActiveTab('editor')
  }, {
    key: 'design',
    label: copy.design + ' / ' + copy.preview,
    icon: 'phone-portrait-outline',
    action: () => setActiveTab('design')
  }];
  const createScreen = async () => {
    const name = newScreenName.trim();
    if (!name) return;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return Alert.alert(ru ? 'Некорректное имя' : 'Invalid name', ru ? 'Только латиница/цифры' : 'Use Latin letters');
    if ((currentProject.screens || []).some(s => s.name === name)) return Alert.alert(ru ? 'Такой экран уже есть' : 'Exists');
    addScreen(name);
    setNewScreenName('');
    setNewScreenOpen(false);
    addWorkspaceLog(`${ru ? 'Создан экран' : 'Screen created'}: ${name}.jsx`, 'info');
  };
  const removeScreen = id => {
    if (currentProject.screens.length <= 1) return Alert.alert(copy.lastScreen);
    const target = currentProject.screens.find(s => s.id === id);
    if (!target) return;
    Alert.alert(copy.deleteScreen, `${target.name}.jsx`, [{
      text: t('cancel'),
      style: 'cancel'
    }, {
      text: t('delete'),
      style: 'destructive',
      onPress: () => {
        deleteScreen(id);
        addWorkspaceLog(`${ru ? 'Удалён' : 'Removed'}: ${target.name}.jsx`, 'info');
      }
    }]);
  };
  const runGoto = useCallback(() => {
    const n = parseInt(gotoValue, 10);
    setGotoOpen(false);
    setGotoValue('');
    if (Number.isFinite(n)) editorApi.current?.command('gotoLine', n);
  }, [gotoValue]);
  const insertSymbol = useCallback(s => {
    editorApi.current?.insert(s);
  }, []);
  const logHeight = logMode === 'full' ? Math.max(280, Math.round(height * 0.5)) : logMode === 'half' ? Math.min(220, Math.round(height * 0.3)) : 34;
  const logs = workspaceLogs.length ? workspaceLogs : [{
    id: 'ready',
    level: 'info',
    text: copy.consoleReady,
    time: Date.now()
  }];
  const activeProblems = lintProblems;
  const totalErrors = lintProblems.filter(p => p.severity === 'error').length;
  const totalWarnings = lintProblems.filter(p => p.severity === 'warning').length;
  const activeDirty = activeFile ? dirtyByPath[activeFile.path] === true : false;
  const breadcrumb = (activeFile?.path || '').split('/').filter(Boolean);
  const crumbShown = breadcrumb.length > 3 && width < 520 ? ['…', ...breadcrumb.slice(-2)] : breadcrumb;
  const hotkeysOn = editor.hotkeys !== false;
  const statusOn = editor.showStatusBar !== false;
  const ToolKey = ({
    label,
    icon,
    onPress,
    disabled,
    accent
  }: { label?: string; icon?: string; onPress: () => void; disabled?: boolean; accent?: boolean }) => <Pressable disabled={disabled} onPress={onPress} style={({
    pressed
  }) => [{
    minWidth: narrow ? 28 : 34,
    height: narrow ? 30 : 34,
    paddingHorizontal: narrow ? 4 : 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pressed ? editorTheme === 'light' ? '#E0E0E0' : '#37373D' : 'transparent',
    opacity: disabled ? 0.35 : 1
  }]}>
      {icon ? <Icon name={icon} size={narrow ? 15 : 17} color={accent ? '#569CD6' : ide.panelText} /> : <Text style={{
      color: accent ? '#569CD6' : ide.panelText,
      fontSize: narrow ? 13 : 15,
      fontFamily: 'monospace',
      fontWeight: '600'
    }}>{label}</Text>}
    </Pressable>;
  return <AppScreen>
      <TopBar compact title={currentProject.name} subtitle={width >= 700 ? currentProject.projectDir : null} onBack={closeAndExit} right={narrow ? <>
        <IconButton name="save-outline" onPress={saveNow} active={activeDirty} />
        <IconButton name="hammer-outline" active onPress={() => navigation.navigate('Build')} />
      </> : <>
        <IconButton name="folder-open-outline" active={explorerOpen} onPress={() => setExplorerOpen(v => !v)} />
        <IconButton name="options-outline" active={settingsOpen} onPress={() => setSettingsOpen(v => !v)} />
        <IconButton name="save-outline" label={width >= 700 ? copy.save : null} onPress={saveNow} active={activeDirty} />
        <IconButton name="cube-outline" onPress={() => navigation.navigate('Libraries')} />
        <IconButton name="hammer-outline" label={width >= 880 ? t('build') : null} active onPress={() => navigation.navigate('Build')} />
      </>} />

      {narrow ? <View className={styles.phoneActions}>
        <IconButton name="folder-open-outline" label={ru ? 'Файлы' : 'Files'} active={explorerOpen} onPress={() => setExplorerOpen(v => !v)} className="flex-1" />
        <IconButton name="options-outline" label={ru ? 'Редактор' : 'Editor'} active={settingsOpen} onPress={() => setSettingsOpen(v => !v)} className="flex-1" />
        <IconButton name="cube-outline" label={ru ? 'Пакеты' : 'Packages'} onPress={() => navigation.navigate('Libraries')} className="flex-1" />
      </View> : null}

      <View className={styles.workspaceBar}>
        <Pressable onPress={() => setScreenMenu(true)} className={styles.screenSelect}><Icon name="logo-android" size={15} color={colors.primary} /><Text className={styles.screenText} numberOfLines={1}>{currentScreen?.name || 'Screen'}</Text><Icon name="chevron-down" size={13} color={colors.textTertiary} /></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName={styles.modeTabs}>
          {tabs.map(tab => <Pressable key={tab.key} onPress={tab.action} className={cn(styles.modeTab, tab.key === activeTab && styles.modeTabActive)}><Icon name={tab.icon} size={15} color={tab.key === activeTab ? colors.primary : colors.textSecondary} /><Text className={cn(styles.modeTabText, tab.key === activeTab && styles.modeTabTextActive)}>{tab.label}</Text></Pressable>)}
        </ScrollView>
      </View>

      <View className={styles.main}>
        {explorerOpen && wide ? <View className={styles.explorerWrap}><FileExplorer project={currentProject} activePath={activeFile?.path} onOpenFile={onOpenFile} onClose={() => setExplorerOpen(false)} width={270} /></View> : null}
        <View className={styles.content}>
          {activeTab === 'design' ? <View className={styles.previewWrap}>
              <View className={styles.previewHead}>
                <Icon name={previewMode === 'webview' ? 'globe-outline' : 'color-palette-outline'} size={15} color={colors.primary} />
                <Text className={styles.previewTitle}>{ru ? 'Дизайн / Превью' : 'Design / Preview'} · {currentScreen?.name || ''}</Text>
                <View style={{
              flex: 1
            }} />
                <Pressable onPress={() => setEditorSetting('designPreview', !previewEnabled)} className={styles.previewControl} style={!previewEnabled && {
              opacity: 0.5
            }}><Icon name={previewEnabled ? 'eye-outline' : 'eye-off-outline'} size={13} color={previewEnabled ? colors.primary : colors.textTertiary} /><Text className={styles.previewControlText} style={!previewEnabled && {
                color: colors.textTertiary
              }}>{previewEnabled ? ru ? 'Вкл' : 'On' : ru ? 'Выкл' : 'Off'}</Text></Pressable>
                <Pressable onPress={() => setPreviewDeviceId(c => PREVIEW_DEVICES[(PREVIEW_DEVICES.findIndex(x => x.id === c) + 1) % PREVIEW_DEVICES.length].id)} className={styles.previewControl}><Icon name="phone-portrait-outline" size={13} color={colors.primary} /><Text className={styles.previewControlText}>{previewDevice.label}</Text></Pressable>
              </View>
              {previewMode === 'webview' && previewVisible ? <View style={{
            padding: 6,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: yarnDevRunning ? '#ECFDF5' : '#FEF3C7',
            borderBottomWidth: 1,
            borderBottomColor: colors.border
          }}>
                  <Icon name={yarnDevRunning ? 'checkmark-circle' : 'time-outline'} size={14} color={yarnDevRunning ? colors.success : colors.warning} />
                  <Text style={{
              flex: 1,
              fontSize: 11,
              color: colors.textSecondary
            }} numberOfLines={1}>{ru ? 'hot reload: превью из кода — обновляется при наборе и сохранении' : 'hot reload: preview rendered from code — updates as you type and save'}</Text>
                  <Pressable onPress={() => setPreviewNonce(n => n + 1)} className={styles.previewControl} style={{
              height: 26
            }}><Icon name="refresh-outline" size={12} color={colors.primary} /><Text className={styles.previewControlText}>{ru ? 'Обновить' : 'Reload'}</Text></Pressable>
                </View> : null}
              {!previewVisible ? <View style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            backgroundColor: colors.bg
          }}>
                  <Icon name={previewEnabled ? "shield-checkmark-outline" : "eye-off-outline"} size={42} color={previewEnabled ? colors.primary : colors.textTertiary} />
                  <Text style={{
              color: colors.text,
              fontSize: 14,
              fontWeight: '700',
              textAlign: 'center'
            }}>{previewEnabled ? guardOn ? 'Двойная защита: предпросмотр заблокирован' : 'Предпросмотр выключен' : 'Предпросмотр отключён в настройках'}</Text>
                  <Text style={{
              color: colors.textSecondary,
              fontSize: 12,
              textAlign: 'center',
              lineHeight: 16
            }}>{previewEnabled ? guardOn ? 'Нажмите «Показать», чтобы временно разблокировать. Отключается при смене экрана.' : 'Включите двойную защиту в Настройки → Дизайн предпросмотр.' : 'Включите: Настройки → Дизайн предпросмотр → Вкл'}</Text>
                  {guardOn && previewEnabled ? <PrimaryButton title="Показать предпросмотр" icon="eye-outline" onPress={() => setPreviewGuardUnlocked(true)} /> : null}
                  {!previewEnabled ? <PrimaryButton title="Открыть настройки" icon="settings-outline" onPress={() => navigation.navigate('AppSettings')} /> : null}
                </View> :
          // WebView монтируется ТОЛЬКО когда Vite подтвердил готовность
          // (HTTP 200). Поэтому стандартная страница ошибки браузера НИКОГДА
          // не показывается — пока Vite не готов, видна аккуратная заглушка.
          yarnDevRunning ? <View style={{
            flex: 1,
            backgroundColor: colors.canvas,
            alignItems: 'center',
            padding: 8
          }}>
                    <View style={{
              flex: 1,
              width: '100%',
              maxWidth: previewDevice.widthDp + 8,
              borderRadius: 20,
              overflow: 'hidden',
              backgroundColor: 'transparent',
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 12,
              shadowOffset: {
                width: 0,
                height: 2
              },
              elevation: 6
            }}>
                      {/* Горячий предпросмотр: HTML-копия макета, пересобирается
                          при каждом изменении кода (см. previewHtml). */}
                      <WebView key={'webview-' + String(previewNonce) + '-' + previewDeviceId + '-' + String(currentScreenId)} source={{
                html: previewHtml || '<!DOCTYPE html><html><body></body></html>',
                baseUrl: 'about:blank'
              }} style={{
                flex: 1,
                backgroundColor: 'transparent'
              }} originWhitelist={['*']} startInLoadingState renderLoading={() => <View style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#fff'
              }}><ActivityIndicator color={colors.primary} /></View>} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} />
                    </View>
                  </View> : <View style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            backgroundColor: colors.bg
          }}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={{
              color: colors.text,
              fontSize: 14,
              fontWeight: '700',
              textAlign: 'center'
                    }}>{yarnDevLog || (ru ? 'Готовлю предпросмотр…' : 'Preparing preview…')}</Text>
                    <Text style={{
              color: colors.textSecondary,
              fontSize: 11,
              textAlign: 'center',
              lineHeight: 15
            }}>{ru ? 'Макет рендерится прямо из кода — без сервера и эмулятора.' : 'The layout is rendered straight from code — no server, no emulator.'}</Text>
                    <View style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 6
            }}>
                      <PrimaryButton title={ru ? 'Перезапустить' : 'Restart'} icon="refresh-outline" onPress={async () => {
                setYarnDevRunning(false);
                const ok = await startVite();
                setYarnDevRunning(ok);
                if (ok) setWebViewError(false);
                setPreviewNonce(n => n + 1);
              }} />
                    </View>
                  </View>}
            </View> : <View className={styles.codeWrap} style={{
          backgroundColor: ide.editorBg
        }}>
              <View className={styles.tabStrip} style={{
            backgroundColor: ide.panel,
            borderBottomColor: ide.panelBorder,
            height: narrow ? 30 : 35
          }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
              alignItems: 'stretch'
            }}>
                  {openTabs.map(tab => {
                const active = tab.path === activeFile?.path;
                const dirty = dirtyByPath[tab.path] === true;
                const ext = tab.name.includes('.') ? tab.name.split('.').pop() : '';
                const fi = fileIcon(ext);
                return <Pressable key={tab.path} onPress={() => activateTab(tab)} className={styles.fileTab} style={[{
                  borderRightColor: ide.panelBorder,
                  height: narrow ? 30 : 35
                }, active && {
                  backgroundColor: ide.editorBg,
                  borderTopColor: '#569CD6'
                }]}>
                        <Icon name={fi.name} size={13} color={active ? fi.color : ide.panelTextDim} /><Text numberOfLines={1} className={styles.fileTabText} style={[{
                    color: active ? ide.panelText : ide.panelTextDim
                  }, active && {
                    fontWeight: '700'
                  }]}>{tab.name}</Text>
                        {tab.isScreen ? dirty ? <View className={styles.dirtyDot} /> : null : <Pressable hitSlop={8} onPress={e => {
                    e.stopPropagation?.();
                    closeTab(tab);
                  }} className={styles.fileTabClose}>{dirty ? <View className={styles.dirtyDot} /> : <Icon name="close" size={13} color={ide.panelTextDim} />}</Pressable>}
                      </Pressable>;
              })}
                  <Pressable onPress={() => setExplorerOpen(v => !v)} className={styles.fileTabAdd}><Icon name="add" size={17} color={ide.panelTextDim} /></Pressable>
                </ScrollView>
              </View>
              <View className={styles.crumbs} style={{
            backgroundColor: ide.editorBg,
            borderBottomColor: ide.panelBorder,
            minHeight: narrow ? 24 : 30
          }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{
              alignItems: 'center',
              gap: 2
            }}>
                  {crumbShown.map((part, i) => <React.Fragment key={`${part}-${i}`}>{i > 0 ? <Icon name="chevron-forward" size={11} color={ide.panelTextDim} /> : null}<Text className={styles.crumb} style={{
                  color: i === crumbShown.length - 1 ? ide.panelText : ide.panelTextDim
                }}>{part}</Text></React.Fragment>)}
                </ScrollView>
                <View style={{
              flex: 1
            }} />
                {build.running ? <View className={styles.problemsBtn}><ActivityIndicator size={12} color="#569CD6" /><Text className={styles.checkingText}>{copy.checkRunning}</Text></View> : null}
                {!build.running && (totalErrors > 0 || totalWarnings > 0) ? <Pressable onPress={() => {
              setDockTab('problems');
              setLogMode('half');
            }} className={styles.problemsBtn}>{totalErrors > 0 ? <><Icon name="close-circle" size={13} color="#F14C4C" /><Text className={styles.problemsCount}>{totalErrors}</Text></> : null}{totalWarnings > 0 ? <><Icon name="warning" size={12} color="#CCA700" style={{
                  marginLeft: totalErrors > 0 ? 4 : 0
                }} /><Text className={styles.warningsCount}>{totalWarnings}</Text></> : null}</Pressable> : null}
                {missingList.length > 0 ? <Pressable onPress={applyMissingImports} className={styles.importBtn}><Icon name="flash-outline" size={13} color="#C586C0" /><Text className={styles.importBtnText}>{missingList.length}</Text></Pressable> : null}
                <ToolKey icon="refresh-outline" accent onPress={runBuildCheck} disabled={build.running} />
                <ToolKey icon="save-outline" accent={activeDirty} onPress={saveNow} />
              </View>
              {missingList.length > 0 ? <Pressable onPress={applyMissingImports} className={styles.importBar}><Icon name="flash-outline" size={14} color="#C586C0" /><Text className={styles.importText}>{copy.importsFix} ({missingList.length})</Text><Icon name="chevron-forward" size={13} color="#C586C0" /></Pressable> : null}
              <CodeMirrorEditor ref={editorApi} value={draft} onChange={handleEditorChange} readOnly={false} placeholder={copy.codePlaceholder} fallbackTitle={copy.fallback} config={{
            themeMode: editorTheme,
            fontSize: editor.fontSize || 15,
            tabSize: editor.tabSize || 4,
            spacesForTab: editor.spacesForTab !== false,
            wordWrap: editor.wordWrap === true,
            completion: editor.completion !== false,
            lang: (activeFile?.name || '').endsWith('.xml') ? 'xml' : (activeFile?.name || '').endsWith('.java') ? 'java' : 'jsx'
          }} diagnostics={activeProblems} onCursor={setCursorInfo} />
              {hotkeysOn ? <View className={styles.toolbar} style={{
            backgroundColor: ide.panel,
            borderTopColor: ide.panelBorder,
            height: narrow ? 34 : 42
          }}><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{
              alignItems: 'center',
              paddingHorizontal: 4,
              gap: 1
            }}>{SYMBOL_KEYS.map(s => <ToolKey key={s} label={s} onPress={() => insertSymbol(s)} />)}<View className={styles.toolbarSep} style={{
                backgroundColor: ide.panelBorder
              }} /><ToolKey icon="chevron-back-outline" onPress={() => editorApi.current?.command('left')} /><ToolKey icon="chevron-forward-outline" onPress={() => editorApi.current?.command('right')} /></ScrollView></View> : null}
              {statusOn ? <View className={styles.statusBar} style={{
            backgroundColor: ide.status,
            minHeight: narrow ? 20 : 24
          }}><Pressable onPress={() => {
              setDockTab('problems');
              setLogMode('half');
            }} className={styles.statusItem}><Icon name="close-circle" size={12} color="#fff" /><Text className={styles.statusText}>{totalErrors}</Text></Pressable><Pressable onPress={() => {
              setDockTab('problems');
              setLogMode('half');
            }} className={styles.statusItem}><Icon name="warning-outline" size={12} color="#fff" /><Text className={styles.statusText}>{totalWarnings}</Text></Pressable><Pressable onPress={() => setLogMode(logMode === 'hidden' ? 'half' : 'hidden')} className={styles.statusItem}><Icon name="terminal-outline" size={12} color="#fff" /><Text className={styles.statusText}>{logs.length}</Text></Pressable>{build.running ? <View className={styles.statusItem}><ActivityIndicator size={11} color="#fff" /><Text className={styles.statusText}>check</Text></View> : null}<View style={{
              flex: 1
            }} /><Text className={styles.statusText}>Ln {cursorInfo.line}, Col {cursorInfo.col}</Text>{!narrow ? <Text className={styles.statusText}>{editor.spacesForTab !== false ? `Spaces: ${editor.tabSize || 4}` : `Tab Size: ${editor.tabSize || 4}`}</Text> : null}{!narrow ? <Text className={styles.statusText}>UTF-8</Text> : null}<Text className={styles.statusText}>{(activeFile?.name || '').endsWith('.xml') ? 'XML' : (activeFile?.name || '').endsWith('.java') ? 'Java' : 'Text'}</Text></View> : null}
            </View>}
        </View>
      </View>

      <View className={styles.logDock} style={{
      height: logHeight,
      backgroundColor: ide.panel,
      borderTopColor: ide.panelBorder
    }}>
        <View className={styles.logHead} style={{
        backgroundColor: ide.panel
      }}>
          <Pressable onPress={() => setDockTab('output')} className={styles.dockTab}><Text className={cn(styles.dockTabText, dockTab === 'output' && styles.dockTabActive)} style={{
            color: dockTab === 'output' ? ide.panelText : ide.panelTextDim
          }}>{copy.output.toUpperCase()}</Text></Pressable>
          <Pressable onPress={() => setDockTab('problems')} className={styles.dockTab}><Text className={cn(styles.dockTabText, dockTab === 'problems' && styles.dockTabActive)} style={{
            color: dockTab === 'problems' ? totalErrors ? '#F14C4C' : ide.panelText : ide.panelTextDim
          }}>{`${copy.problems.toUpperCase()}${totalErrors + totalWarnings ? ` (${totalErrors + totalWarnings})` : ''}`}</Text></Pressable>
          <View style={{
          flex: 1
        }} />
          {logMode !== 'hidden' && dockTab === 'output' ? <Pressable onPress={clearWorkspaceLogs} className={styles.logAction}><Icon name="trash-outline" size={13} color={ide.panelTextDim} /><Text className={styles.logActionText} style={{
            color: ide.panelTextDim
          }}>{copy.clear}</Text></Pressable> : null}
          <SegmentedControl compact value={logMode} onChange={setLogMode} options={[{
          value: 'hidden',
          label: '',
          icon: 'chevron-down-outline',
          flex: false
        }, {
          value: 'half',
          label: '',
          icon: 'remove-outline',
          flex: false
        }, {
          value: 'full',
          label: '',
          icon: 'chevron-up-outline',
          flex: false
        }]} />
        </View>
        {logMode !== 'hidden' ? dockTab === 'problems' ? <ScrollView className={styles.logs} contentContainerStyle={{
        padding: 8
      }}>
              <Pressable onPress={runBuildCheck} className={styles.checkBanner} style={{
          borderColor: ide.panelBorder,
          backgroundColor: editorTheme === 'light' ? '#FFFFFF' : '#2D2D30'
        }} disabled={build.running}>
                {build.running ? <ActivityIndicator size={14} color="#569CD6" /> : <Icon name={build.ok ? 'checkmark-circle' : 'alert-circle-outline'} size={15} color={build.ok ? '#4EC9B0' : '#F14C4C'} />}
                <Text style={{
            flex: 1,
            color: ide.panelTextDim,
            fontSize: 10.5,
            fontFamily: 'monospace'
          }} numberOfLines={2}>{build.running ? 'check …' : build.at ? `${build.ok ? copy.checkOk : copy.checkFailed} · ${new Date(build.at).toLocaleTimeString()}` : 'Нажмите чтобы проверить макеты и build.sh'}</Text>
                {!build.running ? <Icon name="refresh" size={14} color="#569CD6" /> : null}
              </Pressable>
              {activeProblems.map((p, i) => <Pressable key={i} className={styles.logRow} onPress={() => editorApi.current?.command('gotoLine', p.line)}>
                  <Icon name={p.severity === 'warning' ? 'warning' : 'close-circle'} size={13} color={p.severity === 'warning' ? '#CCA700' : '#F14C4C'} />
                  <Text className={styles.logText} style={{
            color: ide.panelText
          }}>{p.message}</Text><Text className={styles.logTime} style={{
            width: 'auto'
          }}>{p.line}:{p.col}</Text>
                </Pressable>)}
              {activeProblems.length === 0 ? <View className={styles.noProblems}><Icon name="checkmark-circle-outline" size={15} color="#4EC9B0" /><Text className={styles.logText} style={{
            color: ide.panelTextDim
          }}>{copy.noProblems}</Text></View> : null}
              {build.output ? <View style={{
          marginTop: 8,
          padding: 8,
          backgroundColor: editorTheme === 'light' ? '#FFFFFF' : '#1E1E1E',
          borderRadius: 6
        }}><Text selectable style={{
            color: ide.panelTextDim,
            fontFamily: 'monospace',
            fontSize: 9
          }}>{build.output.slice(0, 6000)}</Text></View> : null}
            </ScrollView> : <ScrollView className={styles.logs} contentContainerStyle={{
        padding: 8
      }}>
              {logs.map(log => <View key={log.id} className={styles.logRow}><Text className={styles.logTime}>{new Date(log.time).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}</Text><Icon name={log.level === 'success' ? 'checkmark-circle-outline' : log.level === 'error' ? 'alert-circle-outline' : 'information-circle-outline'} size={13} color={log.level === 'success' ? '#4EC9B0' : log.level === 'error' ? '#F14C4C' : '#569CD6'} /><Text selectable className={styles.logText} style={{
            color: ide.panelText
          }}>{log.text}</Text></View>)}
            </ScrollView> : null}
      </View>

      {explorerOpen && !wide ? <Modal visible transparent animationType="fade" onRequestClose={() => setExplorerOpen(false)}><Pressable className={styles.explorerOverlay} onPress={() => setExplorerOpen(false)}><Pressable className={styles.explorerDrawer} style={{
          width: Math.min(width * 0.82, 340),
          paddingTop: insets.top,
          paddingBottom: insets.bottom
        }} onPress={e => e.stopPropagation?.()}><FileExplorer project={currentProject} activePath={activeFile?.path} onOpenFile={path => {
            onOpenFile(path);
            if (!wide) setExplorerOpen(false);
          }} onClose={() => setExplorerOpen(false)} /></Pressable></Pressable></Modal> : null}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}><KeyboardAvoidingView className={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View className={styles.settingsCard}><EditorSettings onClose={() => setSettingsOpen(false)} /></View></KeyboardAvoidingView></Modal>
      <Modal visible={gotoOpen} transparent animationType="fade" onRequestClose={() => setGotoOpen(false)}><KeyboardAvoidingView className={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><SectionCard className={styles.gotoDialog} title={copy.gotoLine} icon="return-down-forward-outline"><TextInput autoFocus value={gotoValue} onChangeText={setGotoValue} onSubmitEditing={() => {
            const n = parseInt(gotoValue, 10);
            setGotoOpen(false);
            setGotoValue('');
            if (Number.isFinite(n)) editorApi.current?.command('gotoLine', n);
          }} placeholder={`${copy.lineNumber} (1-${Math.max(cursorInfo.lines || 1, 0)})`} placeholderTextColor={colors.textTertiary} keyboardType="number-pad" className={styles.input} /><View style={{
            flexDirection: 'row',
            gap: 8
          }}><IconButton name="close" label={t('cancel')} onPress={() => setGotoOpen(false)} style={{
              flex: 1
            }} /><PrimaryButton title={copy.goto} icon="arrow-forward" disabled={!gotoValue.trim()} onPress={() => {
              const n = parseInt(gotoValue, 10);
              setGotoOpen(false);
              setGotoValue('');
              if (Number.isFinite(n)) editorApi.current?.command('gotoLine', n);
            }} style={{
              flex: 1
            }} /></View></SectionCard></KeyboardAvoidingView></Modal>
      <Modal visible={screenMenu} transparent animationType="fade" onRequestClose={() => setScreenMenu(false)}><Pressable className={styles.overlay} onPress={() => setScreenMenu(false)}><SectionCard className={styles.screenDialog} title={t('screens')} icon="layers-outline"><ScrollView style={{ maxHeight: height * 0.55 }} keyboardShouldPersistTaps="handled">{currentProject.screens.map(screen => <View key={screen.id} className={cn(styles.screenRow, screen.id === currentScreenId && styles.screenRowActive)}><Pressable className={styles.screenRowMain} onPress={() => {
              setScreenMenu(false);
              guardUnsaved(() => setCurrentScreen(screen.id));
            }}><Icon name="logo-android" size={16} color={screen.id === currentScreenId ? colors.primary : colors.textSecondary} /><Text className={styles.screenRowText}>{screen.name}</Text></Pressable><IconButton name="copy-outline" onPress={() => duplicateScreen(screen.id)} className={styles.rowButton} /><IconButton name="trash-outline" danger onPress={() => removeScreen(screen.id)} className={styles.rowButton} /></View>)}</ScrollView><PrimaryButton title={t('addScreen')} icon="add" onPress={() => {
            setScreenMenu(false);
            setNewScreenOpen(true);
          }} /></SectionCard></Pressable></Modal>
      <Modal visible={newScreenOpen} transparent animationType="fade" onRequestClose={() => setNewScreenOpen(false)}><KeyboardAvoidingView className={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><SectionCard className={styles.newDialog} title={t('addScreen')} icon="logo-android"><TextInput autoFocus value={newScreenName} onChangeText={setNewScreenName} onSubmitEditing={createScreen} placeholder={copy.screenName} placeholderTextColor={colors.textTertiary} className={styles.input} /><View style={{
            flexDirection: 'row',
            gap: 8
          }}><IconButton name="close" label={t('cancel')} onPress={() => setNewScreenOpen(false)} style={{
              flex: 1
            }} /><PrimaryButton title={t('addScreen')} icon="add" disabled={!newScreenName.trim()} onPress={createScreen} style={{
              flex: 1
            }} /></View></SectionCard></KeyboardAvoidingView></Modal>
    </AppScreen>;
};
const createStyles = c => ({
  center: "flex-1 items-center justify-center gap-[12px] p-[20px]",
  emptyText: "text-text-secondary text-[14px] text-center px-[24px]",
  phoneActions: "min-h-[48px] flex-row items-center gap-[6px] px-[8px] py-[4px] bg-bg-card border-b border-b-border",
  workspaceBar: "min-h-[44px] flex-row items-center px-[8px] gap-[6px] bg-bg-card border-b border-b-border",
  screenSelect: "min-w-[104px] max-w-[200px] shrink h-[32px] px-[9px] flex-row items-center gap-[6px] rounded-[7px] bg-bg-elevated border border-border",
  screenText: "text-text text-[11px] font-semibold flex-1",
  modeTabs: "px-[4px] gap-[2px] items-center",
  modeTab: "h-[33px] px-[11px] rounded-[7px] flex-row items-center gap-[6px]",
  modeTabActive: "bg-primary-surface",
  modeTabText: "text-text-secondary text-[11px] font-semibold",
  modeTabTextActive: "text-primary font-bold",
  main: "flex-1 flex-row min-h-0",
  explorerWrap: "border-r border-r-border",
  content: "flex-1 min-w-0",
  previewWrap: "flex-1 min-h-0 bg-canvas",
  previewHead: "h-[40px] px-[14px] flex-row items-center gap-[8px] bg-bg-card border-b border-b-border",
  previewTitle: "text-text text-[12px] font-bold",
  previewControl: "h-[28px] px-[8px] rounded-[7px] flex-row items-center gap-[4px] bg-primary-surface border border-border",
  previewControlText: "text-primary text-[10px] font-mono font-bold",
  deviceFrame: "bg-white rounded-[28px] overflow-hidden border-[7px] border-[#111827] shadow-lg shadow-lg",
  deviceHead: "h-[28px] px-[14px] flex-row items-center justify-between bg-[#fff]",
  deviceFoot: "h-[28px] items-center justify-center bg-[#fff]",
  previewScroll: "p-[14px] pb-[40px] items-center",
  codeWrap: "flex-1 min-h-0",
  tabStrip: "h-[35px] border-b",
  fileTab: "h-[35px] px-[10px] flex-row items-center gap-[6px] max-w-[200px] border-r border-t-[2px] border-t-transparent",
  fileTabText: "text-[11.5px] font-medium shrink",
  fileTabClose: "w-[18px] h-[18px] rounded-[4px] items-center justify-center",
  fileTabAdd: "w-[34px] h-[35px] items-center justify-center",
  dirtyDot: "w-[8px] h-[8px] rounded-[4px] bg-[#569CD6]",
  crumbs: "min-h-[30px] px-[8px] flex-row items-center gap-[5px] border-b",
  crumb: "text-[10.5px] font-mono",
  readOnlyChip: "flex-row items-center gap-[3px] px-[6px] h-[20px] rounded-[9px] bg-[rgba(133,133,133,0.18)]",
  readOnlyChipText: "text-[9px] font-semibold",
  savingText: "text-[10px] mx-[4px]",
  problemsBtn: "flex-row items-center gap-[3px] px-[7px] h-[22px] rounded-[6px]",
  problemsCount: "text-[#F14C4C] text-[11px] font-bold",
  warningsCount: "text-[#CCA700] text-[11px] font-bold",
  checkingText: "text-[#569CD6] text-[10.5px] font-semibold ml-[3px]",
  checkBanner: "flex-row items-center gap-[8px] px-[10px] py-[7px] rounded-[8px] border mb-[7px]",
  importBtn: "flex-row items-center gap-[3px] px-[7px] h-[22px] rounded-[6px]",
  importBtnText: "text-[#C586C0] text-[11px] font-bold",
  importBar: "min-h-[30px] px-[12px] flex-row items-center gap-[8px] bg-[rgba(197,134,192,0.12)] border-b border-b-[rgba(197,134,192,0.25)]",
  importText: "text-[#C586C0] text-[11.5px] font-semibold flex-1",
  toolbar: "h-[42px] border-t",
  toolbarSep: "w-[1px] h-[22px] mx-[5px]",
  statusBar: "min-h-[24px] px-[8px] flex-row items-center gap-[12px]",
  statusItem: "flex-row items-center gap-[4px] min-h-[24px]",
  statusText: "text-white text-[10.5px] font-mono",
  logDock: "border-t overflow-hidden",
  logHead: "h-[34px] px-[6px] flex-row items-center gap-[4px]",
  dockTab: "px-[9px] h-[34px] justify-center",
  dockTabText: "text-[10px] font-bold tracking-[0.6px]",
  dockTabActive: "border-b-[2px] border-b-[#569CD6]",
  logAction: "flex-row items-center gap-[4px] px-[7px]",
  logActionText: "text-[9px]",
  logs: "flex-1",
  logRow: "min-h-[22px] flex-row items-start gap-[7px]",
  logTime: "text-[#858585] text-[9px] font-mono w-[55px] mt-[1px]",
  logText: "text-[10.5px] leading-[15px] font-mono flex-1",
  noProblems: "flex-row items-center gap-[7px] py-[4px]",
  overlay: "flex-1 justify-center p-[18px] bg-overlay",
  settingsCard: "w-full max-w-[460px] max-h-[85%] self-center rounded-[16px] overflow-hidden bg-bg-card shrink",
  explorerOverlay: "flex-1 bg-[rgba(0,0,0,0.5)] flex-row",
  explorerDrawer: "h-full bg-bg-card overflow-hidden",
  screenDialog: "w-full max-w-[500px] self-center",
  newDialog: "w-full max-w-[430px] self-center",
  gotoDialog: "w-full max-w-[380px] self-center",
  screenRow: "min-h-[48px] flex-row items-center rounded-[9px] border border-transparent",
  screenRowActive: "bg-primary-surface border-primary",
  screenRowMain: "flex-1 min-h-[46px] flex-row items-center gap-[9px] px-[11px]",
  screenRowText: "text-text text-[12px] font-semibold",
  rowButton: "w-[36px] min-w-[36px] h-[36px] border-[0px] bg-transparent",
  input: "min-h-[46px] rounded-[10px] px-[12px] bg-bg-input border border-border-light text-text text-[13px]"
});
export default EditorScreen;
