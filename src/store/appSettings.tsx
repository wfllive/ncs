import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes } from '../theme/colors';

const STORAGE_KEY = '@skpro_app_settings_v2';

const messages = {
  ru: {
    appName: 'React Studio',
    appSubtitle: 'Конструктор React + Vite + Android WebView',
    projects: 'Проекты',
    newProject: 'Новый проект',
    createProject: 'Создать проект',
    projectName: 'Название проекта',
    searchProjects: 'Поиск проектов',
    noProjects: 'Проектов пока нет',
    noProjectsHint: 'Создайте React проект, чтобы начать работу.',
    settings: 'Настройки',
    appearance: 'Оформление',
    language: 'Язык',
    theme: 'Тема',
    system: 'Системная',
    light: 'Светлая',
    dark: 'Тёмная',
    russian: 'Русский',
    english: 'English',
    cancel: 'Отмена',
    save: 'Сохранить',
    delete: 'Удалить',
    close: 'Закрыть',
    retry: 'Повторить',
    back: 'Назад',
    install: 'Установить',
    continue: 'Продолжить',
    terminal: 'Терминал',
    libraries: 'Библиотеки',
    build: 'Сборка',
    editor: 'Редактор',
    design: 'Дизайн',
    logic: 'Логика',
    preview: 'Предпросмотр',
    properties: 'Свойства',
    components: 'Компоненты',
    logs: 'Журнал',
    hidden: 'Скрыт',
    half: 'Половина',
    full: 'Полный',
    screens: 'Экраны',
    addScreen: 'Добавить экран',
    loading: 'Загрузка',
    ready: 'Готово',
  },
  en: {
    appName: 'React Studio',
    appSubtitle: 'React + Vite + Android WebView builder',
    projects: 'Projects',
    newProject: 'New project',
    createProject: 'Create project',
    projectName: 'Project name',
    searchProjects: 'Search projects',
    noProjects: 'No projects yet',
    noProjectsHint: 'Create a React project to get started.',
    settings: 'Settings',
    appearance: 'Appearance',
    language: 'Language',
    theme: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    russian: 'Русский',
    english: 'English',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    close: 'Close',
    retry: 'Retry',
    back: 'Back',
    install: 'Install',
    continue: 'Continue',
    terminal: 'Terminal',
    libraries: 'Libraries',
    build: 'Build',
    editor: 'Editor',
    design: 'Design',
    logic: 'Logic',
    preview: 'Preview',
    properties: 'Properties',
    components: 'Components',
    logs: 'Logs',
    hidden: 'Hidden',
    half: 'Half',
    full: 'Full',
    screens: 'Screens',
    addScreen: 'Add screen',
    loading: 'Loading',
    ready: 'Ready',
  },
};

const AppSettingsContext = createContext(null);

// Editor defaults (persisted alongside theme/language). These drive the
// CodeMirror IDE editor; legacy keys from older versions are simply ignored.
const EDITOR_DEFAULTS = {
  tabSize: 4,
  spacesForTab: true,
  wordWrap: false,
  autoSave: true,
  autoCheck: true,
  completion: true,
  hotkeys: true,
  showStatusBar: true,
  fontSize: 15,
  designPreview: true,           // главный вкл/выкл предпросмотра дизайна
  designPreviewGuard: false,     // двойная защита: если true, preview требует подтверждения (вторая блокировка)
};

export const AppSettingsProvider = ({ children }) => {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState('system');
  const [language, setLanguageState] = useState('ru');
  const [editor, setEditorState] = useState({ ...EDITOR_DEFAULTS });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const value = JSON.parse(raw);
        if (['system', 'light', 'dark'].includes(value.themeMode)) setThemeModeState(value.themeMode);
        if (['ru', 'en'].includes(value.language)) setLanguageState(value.language);
        if (value.editor && typeof value.editor === 'object') {
          setEditorState({ ...EDITOR_DEFAULTS, ...value.editor });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const persist = (nextTheme, nextLang, nextEditor) => AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ themeMode: nextTheme, language: nextLang, editor: nextEditor }),
  ).catch(() => {});

  const setThemeMode = (value) => {
    setThemeModeState(value);
    persist(value, language, editor);
  };

  const setLanguage = (value) => {
    setLanguageState(value);
    persist(themeMode, value, editor);
  };

  const setEditorSetting = (key, value) => {
    const next = { ...editor, [key]: value };
    setEditorState(next);
    persist(themeMode, language, next);
  };

  const resolvedTheme = themeMode === 'system'
    ? (systemScheme === 'dark' ? 'dark' : 'light')
    : themeMode;
  const colors = themes[resolvedTheme];
  const t = (key) => messages[language]?.[key] || messages.ru[key] || key;

  const value = useMemo(() => ({
    loaded,
    themeMode,
    setThemeMode,
    language,
    setLanguage,
    resolvedTheme,
    colors,
    t,
    editor,
    setEditorSetting,
  }), [loaded, themeMode, language, resolvedTheme, colors, editor]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
};

export const useAppSettings = () => {
  const value = useContext(AppSettingsContext);
  if (!value) throw new Error('useAppSettings must be used inside AppSettingsProvider');
  return value;
};

export default AppSettingsContext;
