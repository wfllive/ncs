import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { AppScreen, Field, IconButton, PrimaryButton, SectionCard, StatusPill } from '../components/AppUI';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { execute, isAvailable } from '../utils/shellExecutor';
import { PROJECTS_ROOT, getProjectDir, packageSegment, slugifyProject } from '../config/runtime';
import { createDefaultProject, createDefaultScreen } from '../utils/defaultProject';
import { raiNew } from '../utils/rai';
import { ensureProjectIntegrity } from '../utils/composeProject';
import AdsBanner from '../components/AdsBanner';
import { cn } from "../utils/cn";

// Максимальная ширина контента: на планшете сетка не расползается на весь экран
const CONTENT_MAX_WIDTH = 1180;

// Адаптивные отступы от краёв: контент никогда не липнет к грани экрана
const getGutter = (width) => {
  if (width < 360) return 14;   // очень узкие телефоны
  if (width < 430) return 16;   // телефоны
  if (width < 720) return 20;   // крупные телефоны / складные
  return 24;                    // планшеты
};

const ProjectsScreen = ({
  navigation
}) => {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const {
    colors,
    t,
    language
  } = useAppSettings();
  const {
    projects,
    deleteProject,
    openProject,
    importProject,
    isLoaded
  } = useProject();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [packageName, setPackageName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createLog, setCreateLog] = useState('');

  const compact = width < 430;
  const tiny = width < 360;
  const gutter = getGutter(width);
  // Отступы с каждой стороны не меньше safe-area (чёлка/скругления/жестовая навигация)
  const padLeft = Math.max(gutter, insets.left);
  const padRight = Math.max(gutter, insets.right);
  // Телефон — 1 колонка, планшет (>=720) — 2, большой планшет/альбомная (>=1180) — 3
  const columns = width >= 1180 ? 3 : width >= 720 ? 2 : 1;
  const cardGap = compact ? 10 : 14;
  // На узких экранах кнопки диалога ставим друг под другом во всю ширину
  const stackDialogButtons = width < 560;

  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);

  const copy = language === 'ru' ? {
    recent: 'React-проекты',
    empty: 'Создайте мобильное приложение на React + Vite + Android.',
    command: 'Структура проекта',
    longPress: 'Удерживайте карточку, чтобы удалить проект.',
    deleteTitle: 'Удалить проект?',
    deleteText: 'Метаданные будут удалены из конструктора. Файлы проекта останутся в /root/projects.',
    createFailed: 'Не удалось создать React проект',
    nativeRequired: 'Создание файлов требует доступ к /root/projects (Ubuntu/).',
    preparing: 'Создаём Vite + React проект',
    creating: 'Генерация React-приложения',
    package: 'Application ID'
  } : {
    recent: 'React projects',
    empty: 'Create a mobile app with React + Vite + Android.',
    command: 'Project structure',
    longPress: 'Long-press a card to delete it.',
    deleteTitle: 'Delete project?',
    deleteText: 'Metadata will be removed. Files remain in /root/projects.',
    createFailed: 'Could not create React project',
    nativeRequired: 'File generation requires /root/projects access.',
    preparing: 'Creating Vite + React project',
    creating: 'Generating React app',
    package: 'Application ID'
  };

  const filtered = projects.filter(project => project.name.toLowerCase().includes(search.trim().toLowerCase()));
  const slug = slugifyProject(name);
  const suggestedPackage = packageName || `com.rnstudio.${packageSegment(slug)}`;

  const open = project => {
    openProject(project);
    navigation.navigate('Editor');
    const dir = getProjectDir(project);
    // Самолечение проекта при открытии (фон): восстановить отсутствующие файлы
    // шаблона (прерванное создание, случайное удаление) — пользователь ничего
    // не замечает; затем доустановить зависимости, если node_modules нет.
    (async () => {
      try {
        await ensureProjectIntegrity(project);
      } catch (e) {}
      execute('[ -f "' + dir + '/node_modules/.bin/vite" ] || (echo "install for open..."; cd "' + dir + '" && npm install --silent --no-audit --no-fund 2>&1 | tail -10; echo OPEN_YARN_OK)', '/').catch(() => {});
    })();
  };

  const askDelete = project => Alert.alert(copy.deleteTitle, copy.deleteText, [{
    text: t('cancel'),
    style: 'cancel'
  }, {
    text: t('delete'),
    style: 'destructive',
    onPress: async () => {
      await deleteProject(project.id);
    }
  }]);

  const create = async () => {
    const cleanName = name.trim();
    if (!cleanName || creating) return;
    // Защита от повторного создания: второй проект с тем же именем затёр бы файлы первого.
    if (projects.some(p => (p.slug || slugifyProject(p.name)) === slug)) {
      Alert.alert(language === 'ru' ? 'Имя занято' : 'Name taken', language === 'ru' ? `Проект «${cleanName}» уже существует. Выберите другое имя — иначе файлы существующего проекта были бы перезаписаны.` : `A project named "${cleanName}" already exists. Pick another name — otherwise the existing project's files would be overwritten.`);
      return;
    }
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(suggestedPackage)) {
      Alert.alert('Application ID', 'Example: com.company.application');
      return;
    }
    // On device without termux, we still allow creation — project lives in AsyncStorage
    setCreating(true);
    setCreateLog(copy.preparing);
    try {
      const project = createDefaultProject({
        name: cleanName,
        slug,
        packageName: suggestedPackage,
        namespace: suggestedPackage,
        projectDir: `${PROJECTS_ROOT}/${slug}`,
        screens: [createDefaultScreen(null, 'Home')]
      });
      // Try to create files on disk (best effort)
      if (isAvailable()) {
        const raiResult = await raiNew(cleanName, suggestedPackage);
        if (!raiResult?.success) {
          // still import project even if disk write failed — user can edit in-memory
          setCreateLog(prev => prev + '\n  ⚠ ' + (raiResult?.output || '').slice(0, 300));
        } else {
          setCreateLog(prev => prev + '\n  ✓ Vite project created: ' + project.projectDir);
        }
      } else {
        setCreateLog(prev => prev + '\n  ✓ Project created (in-memory, no shell). Will be written on first save/build.');
      }
      // Сначала пишем файлы, потом ставим зависимости синхронно чтобы лог был виден
      setCreateLog(prev => prev + '\n  → npm install (1-2 мин, для vite)...');
      let yarnOk = false;
      if (isAvailable()) {
        const projDir = `${PROJECTS_ROOT}/${slug}`;
        try {
          const r = await execute('cd "' + projDir + '" && npm install --silent --no-audit --no-fund 2>&1 | tail -30; echo EXIT:$?', projDir);
          setCreateLog(prev => prev + '\n' + String(r.output || '').slice(0, 900));
          yarnOk = /EXIT:0/.test(r.output || '');
          if (yarnOk) {
            setCreateLog(prev => prev + '\n  ✓ node_modules готов — vite запустится в редакторе (Дизайн / Превью)');
          } else {
            // Повторная попытка (была сетевая ошибка?) — затем фоновая доустановка при открытии.
            const r2 = await execute('cd "' + projDir + '" && npm install --silent --no-audit --no-fund 2>&1 | tail -15; echo EXIT:$?', projDir);
            yarnOk = /EXIT:0/.test(r2.output || '');
            setCreateLog(prev => prev + (yarnOk ? '\n  ✓ node_modules готов (установлен со второй попытки)' : '\n  ⚠ npm install не завершился — проверьте сеть; при открытии проекта установка продолжится автоматически'));
          }
        } catch (e) {
          setCreateLog(prev => prev + '\n  ⚠ npm install error: ' + String(e).slice(0, 300));
        }
        // Проверка целостности: все файлы шаблона на диске (иначе восстановим).
        try {
          const integ = await ensureProjectIntegrity(project);
          setCreateLog(prev => prev + (integ?.restored?.length ? `\n  ✓ восстановлены недостающие файлы: ${integ.restored.length} шт.` : '\n  ✓ проверка файлов проекта пройдена'));
        } catch (e) {}
      } else {
        setCreateLog(prev => prev + '\n  ✓ Project created (без shell — npm install при первой сборке)');
      }
      importProject(project);
      // Даём увидеть лог 1.5 сек перед переходом
      await new Promise(res => setTimeout(res, 1500));
      setName('');
      setPackageName('');
      // Не очищаем лог — оставляем для отладки, Editor покажет
      setCreateOpen(false);
      navigation.navigate('Editor');
    } catch (error) {
      const message = error?.message || String(error);
      setCreateLog(message);
      Alert.alert(copy.createFailed, message.slice(0, 1400));
    } finally {
      setCreating(false);
    }
  };

  const renderProject = useCallback(({
    item
  }) => {
    const updated = new Date(item.updatedAt || item.createdAt);
    const updatedLabel = isNaN(updated.getTime()) ? '' : updated.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US');
    return <Pressable onPress={() => open(item)} onLongPress={() => askDelete(item)} className={cn(styles.card, 'active:border-primary')} style={{
      marginBottom: cardGap
    }}>
        <View className={styles.cardTop}>
          <View className={styles.projectIcon}><Icon name="logo-react" size={24} color={colors.primary} /></View>
          <View style={{
            flex: 1,
            minWidth: 0
          }}>
            <Text className={styles.projectName} numberOfLines={1}>{item.name}</Text>
            <Text className={styles.path} numberOfLines={1}>{getProjectDir(item)}</Text>
          </View>
          <View style={{
            flexShrink: 0,
            marginLeft: 4
          }}>
            <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
          </View>
        </View>
        <View className={styles.metaRow}>
          <StatusPill label="React + Vite" tone="success" />
          <StatusPill label="android" tone="info" />
          <View className={styles.meta}><Icon name="layers-outline" size={13} color={colors.textTertiary} /><Text className={styles.metaText}>{item.screens?.length || 0}</Text></View>
          <View className={styles.meta}><Icon name="time-outline" size={13} color={colors.textTertiary} /><Text className={styles.metaText}>{updatedLabel}</Text></View>
        </View>
      </Pressable>;
  }, [styles, colors, language, cardGap]);

  if (!isLoaded) return <AppScreen className={styles.center}><View className={styles.brand}><Icon name="logo-react" size={26} color="#FFFFFF" /></View><Text className={styles.muted}>{t('loading')}</Text></AppScreen>;

  return <AppScreen>
      <View className={styles.header} style={{
        paddingLeft: padLeft,
        paddingRight: padRight
      }}>
        {!tiny ? <View className={styles.brand}><Icon name="logo-react" size={compact ? 22 : 25} color="#FFFFFF" /></View> : null}
        <View style={{
          flex: 1,
          minWidth: 0
        }}>
          <Text className={styles.title} numberOfLines={1}>{compact ? 'NovaCompose' : 'NovaCompose Studio'}</Text>
          {width >= 520 ? <Text className={styles.subtitle} numberOfLines={1}>React + Vite · конструктор Android-приложений</Text> : null}
        </View>
        <View className={styles.actions}>{/* ВРЕМЕННО: терминал только в debug/dev-сборке. В релизе (__DEV__ === false) кнопка скрыта — чтобы не путать пользователей и избежать лишних жалоб; вернуть можно позже или вынести тумблером в настройки. */}{__DEV__ ? <IconButton name="terminal-outline" onPress={() => navigation.navigate('Terminal')} /> : null}<IconButton name="settings-outline" onPress={() => navigation.navigate('AppSettings')} />{width >= 520 ? <PrimaryButton title={t('newProject')} icon="add" onPress={() => setCreateOpen(true)} /> : <Pressable
            onPress={() => setCreateOpen(true)}
            accessibilityLabel={t('newProject')}
            accessibilityRole="button"
            hitSlop={4}
            android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
            className="bg-primary rounded-[12px] items-center justify-center"
            style={{
              width: 44,
              height: 44,
              // colors.primary может отсутствовать в теме — тогда цвет берёт класс bg-primary
              ...(colors.primary ? { backgroundColor: colors.primary } : {})
            }}>
            <Icon name="add" size={24} color="#FFFFFF" />
          </Pressable>}</View>
      </View>
      <View className={styles.searchWrap} style={{
        paddingLeft: padLeft,
        paddingRight: padRight,
        paddingTop: compact ? 10 : 14,
        maxWidth: CONTENT_MAX_WIDTH
      }}>
        <View style={{
          flexShrink: 0
        }}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
        </View>
        {/* Обёртка ограничивает Field, чтобы его внутренние отступы не вылезали за край */}
        <View style={{
          flex: 1,
          minWidth: 0
        }}>
          <Field value={search} onChangeText={setSearch} placeholder={t('searchProjects')} style={{
            width: '100%'
          }} />
        </View>
        {search ? <IconButton name="close" onPress={() => setSearch('')} style={{
          borderWidth: 0,
          backgroundColor: colors.bg
        }} /> : null}
      </View>
      {filtered.length ? <FlatList
        key={columns}
        numColumns={columns}
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderProject}
        showsVerticalScrollIndicator={false}
        style={{
          flex: 1
        }}
        columnWrapperStyle={columns > 1 ? {
          gap: cardGap
        } : undefined}
        contentContainerStyle={{
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          alignSelf: 'center',
          paddingLeft: padLeft,
          paddingRight: padRight,
          paddingTop: compact ? 10 : 14,
          // нижний отступ учитывает жестовую навигацию и баннер — последняя карточка не обрезается
          paddingBottom: 36 + insets.bottom
        }}
        ListHeaderComponent={<View style={{
          marginBottom: 12,
          gap: 3
        }}>
            {/* Заголовок и подсказка в колонку: наложение и обрезка у края исключены на любой ширине */}
            <Text className={styles.sectionTitle} numberOfLines={1}>{copy.recent}</Text>
            <Text className={styles.hint} numberOfLines={1}>{copy.longPress}</Text>
          </View>} /> : <View className={styles.empty} style={{
          paddingLeft: padLeft + 8,
          paddingRight: padRight + 8
        }}>
          <View className={styles.emptyIcon}><Icon name="logo-react" size={40} color={colors.primary} /></View>
          <Text className={styles.emptyTitle}>{t('noProjects')}</Text>
          <Text className={styles.emptyText}>{copy.empty}</Text>
          <PrimaryButton title={t('createProject')} icon="add" onPress={() => setCreateOpen(true)} style={{
            marginTop: 8
          }} />
        </View>}
      <Modal visible={createOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => !creating && setCreateOpen(false)}>
        <KeyboardAvoidingView
          className={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingLeft: padLeft,
              paddingRight: padRight,
              // модалка не залезает под статус-бар и системные кнопки даже на телефоне
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16)
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={{
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center'
          }}>
          <SectionCard className={styles.dialog} title={t('newProject')} icon="logo-react">
            <Field label={t('projectName')} value={name} onChangeText={value => {
              setName(value);
              if (!packageName) setPackageName('');
            }} autoFocus={!creating} editable={!creating} />
            <Field label={copy.package} value={suggestedPackage} onChangeText={setPackageName} autoCapitalize="none" editable={!creating} />
            <View className={styles.commandBox}>
              <Text className={styles.commandLabel}>{copy.command}</Text>
              {/* Горизонтальный скролл: длинные пути не обрезаются и не ломают вёрстку на телефоне */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text selectable className={styles.command}>{`${PROJECTS_ROOT}/${slug || 'my-app'}/\n├── package.json\n├── vite.config.js\n├── index.html\n├── src/\n│   ├── App.jsx\n│   ├── main.jsx\n│   └── screens/Home.jsx\n└── android/app/src/main/java/.../MainActivity.kt (нативная оболочка)`}</Text>
              </ScrollView>
            </View>
            {createLog ? <ScrollView nestedScrollEnabled style={{
              maxHeight: 140
            }} className={styles.logBox} keyboardShouldPersistTaps="handled">
                <Text selectable className={styles.logText}>{createLog}</Text>
              </ScrollView> : null}
            <View style={stackDialogButtons ? {
              flexDirection: 'column',
              gap: 8
            } : {
              flexDirection: 'row',
              gap: 9
            }}>
              <IconButton name="close" label={t('cancel')} disabled={creating} onPress={() => {
                setCreateOpen(false);
                setName('');
                setPackageName('');
                setCreateLog('');
              }} style={stackDialogButtons ? {
                width: '100%'
              } : {
                flex: 1
              }} />
              <PrimaryButton title={t('createProject')} icon="arrow-forward" loading={creating} disabled={!name.trim()} onPress={create} style={stackDialogButtons ? {
                width: '100%'
              } : {
                flex: 1
              }} />
            </View>
          </SectionCard>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <AdsBanner />
    </AppScreen>;
};

const createStyles = (c, compact) => ({
  center: "items-center justify-center gap-[12px]",
  // Отступы по краям задаются инлайн (gutter + safe-area) — класс держит только оформление
  header: compact ? "min-h-[64px] py-[8px] flex-row items-center gap-[8px] bg-bg-card border-b border-b-border" : "min-h-[76px] py-[10px] flex-row items-center gap-[12px] bg-bg-card border-b border-b-border",
  brand: compact ? "w-[38px] h-[38px] rounded-[11px] items-center justify-center bg-primary shrink-0" : "w-[44px] h-[44px] rounded-[13px] items-center justify-center bg-primary shrink-0",
  title: compact ? "text-text text-[16px] font-bold" : "text-text text-[19px] font-bold",
  subtitle: "text-text-secondary text-[11px] mt-[2px]",
  actions: "flex-row items-center gap-[7px] shrink-0",
  searchWrap: "w-full self-center flex-row items-center gap-[8px]",
  sectionTitle: "text-text text-[15px] font-bold",
  hint: "text-text-tertiary text-[10px]",
  card: "flex-1 min-w-0 overflow-hidden bg-bg-card border border-border rounded-[14px] p-[15px]",
  cardTop: "flex-row items-center gap-[11px]",
  projectIcon: "w-[44px] h-[44px] items-center justify-center rounded-[12px] bg-primary-surface shrink-0",
  projectName: "text-text text-[15px] font-bold",
  path: "text-text-tertiary text-[9px] font-mono mt-[4px]",
  // gap-x/gap-y раздельно: при переносе строки пилюли не слипаются на узком экране
  metaRow: "flex-row flex-wrap items-center gap-x-[10px] gap-y-[6px] mt-[14px] pt-[12px] border-t border-t-border",
  meta: "flex-row items-center gap-[4px]",
  metaText: "text-text-secondary text-[10px]",
  empty: "flex-1 items-center justify-center py-[24px]",
  emptyIcon: "w-[76px] h-[76px] rounded-[22px] items-center justify-center bg-primary-surface mb-[16px]",
  emptyTitle: "text-text text-[20px] font-bold text-center",
  emptyText: "text-text-secondary text-[13px] leading-[20px] text-center max-w-[430px] mt-[7px]",
  muted: "text-text-secondary",
  overlay: "flex-1 bg-overlay",
  dialog: compact ? "w-full p-[14px]" : "w-full p-[20px]",
  commandBox: "rounded-[9px] p-[12px] bg-terminal overflow-hidden",
  commandLabel: "text-[#8B98AD] text-[10px] mb-[6px]",
  command: "text-[#DCE5F3] text-[10px] leading-[16px] font-mono",
  logBox: "rounded-[9px] p-[11px] bg-bg-elevated",
  logText: "text-text-secondary font-mono text-[10px]"
});

export default ProjectsScreen;
