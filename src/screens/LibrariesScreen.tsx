import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, Field, IconButton, PrimaryButton, SegmentedControl, StatusPill, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useAppSettings } from '../store/appSettings';
import { useProject } from '../store/projectStore';
import { execute } from '../utils/shellExecutor';
import { getProjectDir } from '../config/runtime';
import { syncComposeProject } from '../utils/composeProject';
import { cn } from "../utils/cn";
const catalog = [{
  coordinate: 'androidx.appcompat:appcompat:1.6.1',
  icon: 'phone-portrait-outline',
  category: 'UI',
  ru: 'AppCompat: совместимость старых версий',
  en: 'AppCompat: backward compatibility'
}, {
  coordinate: 'androidx.core:core:1.12.0',
  icon: 'cube-outline',
  category: 'Utils',
  ru: 'AndroidX Core: современные API',
  en: 'AndroidX Core: modern APIs'
}, {
  coordinate: 'com.google.android.material:material:1.11.0',
  icon: 'color-palette-outline',
  category: 'UI',
  ru: 'Material Components (кнопки, поля…)',
  en: 'Material Components (buttons, fields…)'
}, {
  coordinate: 'androidx.constraintlayout:constraintlayout:2.1.4',
  icon: 'grid-outline',
  category: 'UI',
  ru: 'ConstraintLayout: гибкие макеты',
  en: 'ConstraintLayout: flexible layouts'
}, {
  coordinate: 'androidx.recyclerview:recyclerview:1.3.2',
  icon: 'list-outline',
  category: 'UI',
  ru: 'RecyclerView: списки',
  en: 'RecyclerView: lists'
}, {
  coordinate: 'com.squareup.okhttp3:okhttp:4.12.0',
  icon: 'swap-horizontal-outline',
  category: 'Network',
  ru: 'OkHttp: HTTP-клиент',
  en: 'OkHttp: HTTP client'
}, {
  coordinate: 'com.google.code.gson:gson:2.10.1',
  icon: 'braces-outline',
  category: 'Utils',
  ru: 'Gson: JSON (де)сериализация',
  en: 'Gson: JSON (de)serialization'
}, {
  coordinate: 'com.yandex.android:mobileads:8.2.0',
  icon: 'megaphone-outline',
  category: 'Ads',
  ru: 'Yandex Mobile Ads (баннеры, interstitial)',
  en: 'Yandex Mobile Ads (banners, interstitial)'
}];
const categories = ['All', 'UI', 'Network', 'Utils', 'Ads'];
// Maven-координата: group:artifact[:version] (версию можно не указывать — добавим последнюю).
const validCoordinate = value => /^[a-z0-9_.-]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)?$/i.test(value.trim());
const LibrariesScreen = ({
  navigation
}) => {
  const {
    width
  } = useWindowDimensions();
  const {
    colors,
    language,
    t
  } = useAppSettings();
  const {
    currentProject,
    dispatch
  } = useProject();
  const isPhone = width < 640;
  const isSmallPhone = width < 390;
  const columns = width >= 1120 ? 3 : width >= 760 ? 2 : 1;
  const [tab, setTab] = useState('catalog');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [resolved, setResolved] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const styles = useMemo(() => createStyles(colors, {
    isPhone,
    isSmallPhone
  }), [colors, isPhone, isSmallPhone]);
  const copy = language === 'ru' ? {
    title: 'Библиотеки (Maven)',
    subtitle: 'storm.m · Storm Build',
    catalog: 'Каталог',
    installed: 'Подключены',
    search: 'Поиск библиотек',
    custom: 'group:artifact:version',
    add: 'Подключить',
    remove: 'Удалить',
    declared: 'В storm.m',
    cached: 'Загружена',
    unresolved: 'Не загружена',
    refresh: 'Проверить storm.lock',
    resolve: 'Загрузить всё (storm deps fetch)',
    invalid: 'Введите координату Maven: group:artifact или group:artifact:version',
    noProject: 'Сначала откройте проект.',
    removeTitle: 'Удалить библиотеку?',
    removeText: 'Зависимость будет удалена из storm.m.',
    empty: 'Библиотеки не подключены'
  } : {
    title: 'Libraries (Maven)',
    subtitle: 'storm.m · Storm Build',
    catalog: 'Catalog',
    installed: 'Installed',
    search: 'Search libraries',
    custom: 'group:artifact:version',
    add: 'Add',
    remove: 'Remove',
    declared: 'In storm.m',
    cached: 'Downloaded',
    unresolved: 'Not downloaded',
    refresh: 'Check storm.lock',
    resolve: 'Fetch all (storm deps fetch)',
    invalid: 'Enter Maven coordinate: group:artifact or group:artifact:version',
    noProject: 'Open a project first.',
    removeTitle: 'Remove library?',
    removeText: 'Dependency will be removed from storm.m.',
    empty: 'No libraries connected'
  };
const dir = currentProject ? getProjectDir(currentProject) : '';
  // Зависимости живут в storm.m (блок dependencies { … }); storm.lock — маркер загрузки.
  const readDeclared = useCallback(async () => {
    if (!dir) return [];
    const r = await execute(
      'awk \'/dependencies[[:space:]]*\\{/{f=1;next} f&&/\\}/{f=0} f\' storm.m 2>/dev/null | ' +
      'sed -e \'s/#.*//\' -e \'s/^[[:space:]]*implementation[[:space:]]*//\' | ' +
      'grep -E \'^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+\' || true', dir);
    return String(r?.output || '').split('\n').map(x => x.trim()).filter(Boolean);
  }, [dir]);
  const [declared, setDeclared] = useState([]);
  const declaredKey = declared.join('|');
  const checkCache = useCallback(async () => {
    if (!dir) return;
    const next = {};
    const lock = await execute('[ -f storm.lock ] && cat storm.lock 2>/dev/null || true', dir);
    const lockText = String(lock?.output || '');
    for (const dep of declared) {
      const ga = dep.split(':').slice(0, 2).join(':');
      next[dep] = lockText.includes(ga);
    }
    setResolved(next);
  }, [dir, declaredKey]); // eslint-disable-line
  useEffect(() => {
    (async () => {
      const list = await readDeclared();
      setDeclared(list);
    })();
  }, [readDeclared]);
  useEffect(() => {
    checkCache();
  }, [checkCache]);
  const syncMeta = async (nextDependencies) => {
    // Дублируем список в метаданные проекта (для офлайн-карточек).
    if (!currentProject) return;
    dispatch({
      type: 'UPDATE_PROJECT',
      payload: { ...currentProject, gradleDependencies: nextDependencies, dependencies: nextDependencies, updatedAt: Date.now() }
    });
  };
  const add = async coordinate => {
    if (!currentProject) {
      Alert.alert(copy.noProject);
      return;
    }
    const value = coordinate.trim();
    if (!validCoordinate(value)) {
      Alert.alert(copy.invalid);
      return;
    }
    if (declared.some(d => d.startsWith(value.split(':').slice(0, 2).join(':')))) return;
    setBusy(value);
    setError('');
    try {
      const r = await execute(`storm deps add ${JSON.stringify(value)} 2>&1 | tail -25; echo DEPS_EXIT:$?`, dir);
      const out = String(r?.output || '');
      if (!/DEPS_EXIT:0/.test(out)) throw new Error(out.replace(/DEPS_EXIT:\d+/, '').slice(-800) || 'storm deps add failed');
      setCustom('');
      const list = await readDeclared();
      setDeclared(list);
      await syncMeta(list);
      await checkCache();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = coordinate => Alert.alert(copy.removeTitle, `${coordinate}\n\n${copy.removeText}`, [{
    text: t('cancel'),
    style: 'cancel'
  }, {
    text: t('delete'),
    style: 'destructive',
    onPress: async () => {
      if (!currentProject) return;
      setBusy(coordinate);
      setError('');
      try {
        const ga = coordinate.split(':').slice(0, 2).join(':');
        await execute(`sed -i '\\#${ga.replace(/\./g, '\\.')}#d' storm.m 2>/dev/null || true`, dir);
        const list = await readDeclared();
        setDeclared(list);
        await syncMeta(list);
        await checkCache();
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setBusy(null);
      }
    }
  }]);
  const resolveAll = async () => {
    if (!currentProject) return;
    setBusy('resolve');
    setError('');
    try {
      const r = await execute('storm deps fetch 2>&1 | tail -30; echo DEPS_EXIT:$?', dir);
      const out = String(r?.output || '');
      if (!/DEPS_EXIT:0/.test(out)) throw new Error(out.replace(/DEPS_EXIT:\d+/, '').slice(-800) || 'storm deps fetch failed');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      await checkCache();
      setBusy(null);
    }
  };
  const filtered = catalog.filter(item => (category === 'All' || item.category === category) && `${item.coordinate} ${item[language]}`.toLowerCase().includes(query.toLowerCase()));
  const installedRows = declared.filter(item => item.toLowerCase().includes(query.toLowerCase()));
  const renderCatalogCard = ({
    item
  }) => {
    const connected = declared.includes(item.coordinate);
    const isInstalled = resolved[item.coordinate];
    return <View className={styles.card}>
        <View className={styles.cardHead}>
          <View className={styles.packageIcon}>
            <Icon name={item.icon} size={22} color={colors.primary} />
          </View>

          <View className={styles.flexBlock}>
            <Text className={styles.coordinate} numberOfLines={2}>
              {item.coordinate}
            </Text>
            <Text className={styles.description}>{item[language]}</Text>
          </View>
        </View>

        <View className={styles.cardFooter}>
          <View className={styles.cardFooterLeft}>
            {connected ? <StatusPill label={isInstalled ? copy.cached : copy.declared} tone={isInstalled ? 'success' : 'info'} /> : <StatusPill label={item.category} />}
          </View>

          {connected ? <IconButton name="trash-outline" danger onPress={() => remove(item.coordinate)} className={styles.action} /> : <Pressable onPress={() => add(item.coordinate)} className={cn(styles.addButton, 'active:opacity-70')}>
              <Icon name="add-circle-outline" size={16} color={colors.primary} />
              <Text className={styles.addText}>{copy.add}</Text>
            </Pressable>}
        </View>
      </View>;
  };
  const renderInstalledRow = ({
    item
  }) => {
    const isInstalled = resolved[item];
    return <View className={cn(styles.row, isPhone && styles.rowMobile)}>
        <View className={styles.rowMain}>
          <View className={styles.dot} style={{
          backgroundColor: isInstalled ? colors.success : colors.warning
        }} />

          <View className={styles.flexBlock}>
            <Text className={styles.coordinate} numberOfLines={2}>
              {item}
            </Text>
            <Text className={styles.description}>storm deps add {item}</Text>
          </View>
        </View>

        <View className={cn(styles.rowActions, isPhone && styles.rowActionsMobile)}>
          <StatusPill label={isInstalled ? copy.cached : copy.unresolved} tone={isInstalled ? 'success' : 'warning'} />
          <IconButton name="trash-outline" danger onPress={() => remove(item)} className={styles.action} />
        </View>
      </View>;
  };
  if (!currentProject) {
    return <AppScreen>
        <TopBar title={copy.title} onBack={() => navigation.goBack()} />
        <View className={styles.empty}>
          <Text className={styles.emptyText}>{copy.noProject}</Text>
        </View>
      </AppScreen>;
  }
  return <AppScreen>
      <TopBar title={copy.title} subtitle={isPhone ? currentProject.name : `${currentProject.name} · ${copy.subtitle}`} onBack={() => navigation.goBack()} right={<IconButton name="refresh-outline" label={width >= 760 ? copy.refresh : null} onPress={checkCache} />} />

      <View className={styles.controls}>
        <SegmentedControl value={tab} onChange={setTab} options={[{
        value: 'catalog',
        label: copy.catalog,
        icon: 'grid-outline'
      }, {
        value: 'installed',
        label: `${copy.installed} (${declared.length})`,
        icon: 'list-outline'
      }]} />

        <View className={styles.searchRow}>
          <Field value={query} onChangeText={setQuery} placeholder={copy.search} className={styles.field} />

          <View className={styles.customRow}>
            <Field value={custom} onChangeText={setCustom} placeholder={copy.custom} autoCapitalize="none" className={styles.field} />

            <PrimaryButton title={copy.add} icon="add" loading={busy === custom.trim()} disabled={!custom.trim()} onPress={() => add(custom)} className={styles.primaryButton} />
          </View>
        </View>

        {tab === 'catalog' ? <View className={styles.categoriesWrap}>
            {categories.map(item => <Pressable key={item} onPress={() => setCategory(item)} className={cn(styles.category, category === item && styles.categoryActive)}>
                <Text className={cn(styles.categoryText, category === item && styles.categoryTextActive)}>
                  {item}
                </Text>
              </Pressable>)}
          </View> : <PrimaryButton title={copy.resolve} icon="cloud-download-outline" loading={busy === 'resolve'} onPress={resolveAll} className={styles.primaryButton} />}

        {error ? <View className={styles.errorBox}>
            <Text selectable className={styles.errorText}>
              {error}
            </Text>
          </View> : null}
      </View>

      {tab === 'catalog' ? <FlatList key={columns} numColumns={columns} data={filtered} renderItem={renderCatalogCard} keyExtractor={item => item.coordinate} keyboardShouldPersistTaps="handled" columnWrapperClassName={columns > 1 ? styles.columnsWrap : undefined} contentContainerClassName={styles.list} /> : <FlatList data={installedRows} keyExtractor={item => item} keyboardShouldPersistTaps="handled" contentContainerClassName={styles.installedList} ListEmptyComponent={<View className={styles.empty}>
              <Icon name="cube-outline" size={36} color={colors.textTertiary} />
              <Text className={styles.emptyText}>{copy.empty}</Text>
            </View>} renderItem={renderInstalledRow} />}
    </AppScreen>;
};
const createStyles = (c, {
  isPhone,
  isSmallPhone
}) => ({
  flexBlock: "flex-1 min-w-0",
  controls: cn("py-[12px] gap-[12px] bg-bg-card border-b border-b-border", isPhone ? "px-[12px]" : "px-[16px]"),
  searchRow: cn("items-stretch gap-[10px]", isPhone ? "flex-col" : "flex-row"),
  customRow: "w-full min-w-0 flex-row gap-[8px] items-center",
  field: "flex-1 min-w-0 w-full",
  primaryButton: "min-h-[46px] px-[16px] shrink-0",
  categoriesWrap: "flex-row flex-wrap gap-[8px]",
  category: "px-[14px] py-[9px] rounded-[10px] bg-bg-elevated border border-border",
  categoryActive: "bg-primary-surface border-primary",
  categoryText: cn("text-text-secondary font-bold", isPhone ? "text-[13px]" : "text-[12px]"),
  categoryTextActive: "text-primary",
  errorBox: "p-[10px] rounded-[10px] bg-error-bg",
  errorText: cn("text-error-text font-mono", isPhone ? "text-[11px]" : "text-[10px]", isPhone ? "leading-[16px]" : "leading-[14px]"),
  list: cn("w-full max-w-[1180px] self-center pb-[40px]", isPhone ? "p-[12px]" : "p-[16px]"),
  columnsWrap: "gap-[12px]",
  card: cn("flex-1 min-w-0 mb-[12px] rounded-[14px] border border-border bg-bg-card", isPhone ? "p-[14px]" : "p-[16px]"),
  cardHead: cn("flex-row items-start gap-[12px]", isPhone ? "min-h-[64px]" : "min-h-[58px]"),
  packageIcon: cn("rounded-[12px] bg-primary-surface items-center justify-center", isPhone ? "w-[44px]" : "w-[42px]", isPhone ? "h-[44px]" : "h-[42px]"),
  coordinate: cn("text-text font-mono font-bold", isPhone ? "text-[14px]" : "text-[12px]", isPhone ? "leading-[20px]" : "leading-[18px]"),
  description: cn("text-text-secondary mt-[4px]", isPhone ? "text-[13px]" : "text-[11px]", isPhone ? "leading-[18px]" : "leading-[16px]"),
  cardFooter: "mt-[12px] pt-[12px] border-t border-t-border flex-row items-center justify-between gap-[10px]",
  cardFooterLeft: "shrink flex-row items-center",
  addButton: "min-h-[40px] px-[14px] rounded-[10px] bg-primary-surface flex-row items-center justify-center gap-[6px] self-end",
  addText: cn("text-primary font-bold", isPhone ? "text-[13px]" : "text-[12px]"),
  pressed: "opacity-[0.82]",
  action: "w-[44px] min-w-[44px] h-[44px] px-0",
  installedList: cn("w-full max-w-[900px] self-center pb-[40px]", isPhone ? "p-[12px]" : "p-[16px]"),
  row: cn("mb-[8px] rounded-[12px] border border-border bg-bg-card flex-row items-center gap-[10px]", isPhone ? "min-h-[78px]" : "min-h-[68px]", isPhone ? "p-[12px]" : "p-[11px]"),
  rowMobile: "flex-col items-stretch",
  rowMain: "flex-1 min-w-0 flex-row items-center gap-[10px]",
  rowActions: "flex-row items-center gap-[8px]",
  rowActionsMobile: "w-full justify-between",
  dot: "w-[10px] h-[10px] rounded-[5px]",
  empty: "flex-1 min-h-[280px] items-center justify-center gap-[10px] px-[24px]",
  emptyText: cn("text-text-secondary text-center", isPhone ? "text-[14px]" : "text-[13px]")
});
export default LibrariesScreen;
