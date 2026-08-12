import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View, useWindowDimensions } from 'react-native';
import { AppScreen, Field, IconButton, PrimaryButton, SectionCard, SegmentedControl, TopBar } from '../components/AppUI';
import { Icon } from '../components/Icon';
import { useProject } from '../store/projectStore';
import { useAppSettings } from '../store/appSettings';
import { syncComposeProject } from '../utils/composeProject';
import { generateId } from '../utils/generateId';
import { cn } from "../utils/cn";
const ProjectSettingsScreen = ({
  navigation
}) => {
  const {
    width
  } = useWindowDimensions();
  const {
    currentProject,
    dispatch
  } = useProject();
  const {
    colors,
    language,
    t
  } = useAppSettings();
  const [tab, setTab] = useState('app');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    name: currentProject?.name || '',
    packageName: currentProject?.packageName || '',
    namespace: currentProject?.namespace || currentProject?.packageName || '',
    versionName: currentProject?.versionName || '1.0.0',
    versionCode: String(currentProject?.versionCode || 1),
    minSdk: String(currentProject?.minSdk || 24),
    iconPngPath: currentProject?.iconPngPath || '',
    targetSdk: String(currentProject?.targetSdk || 37),
    compileSdk: String(currentProject?.compileSdk || 37),
    reactVersion: currentProject?.reactVersion || '19.2.8',
    viteVersion: currentProject?.viteVersion || '5.4.0',
    primaryColor: currentProject?.theme?.primaryColor || '#4F46E5',
    secondaryColor: currentProject?.theme?.secondaryColor || '#0E7490',
    backgroundColor: currentProject?.theme?.backgroundColor || '#F8FAFC',
    isDark: Boolean(currentProject?.theme?.isDark),
    keystorePath: currentProject?.signing?.keystorePath || '',
    keyAlias: currentProject?.signing?.keyAlias || '',
    storePasswordEnv: currentProject?.signing?.storePasswordEnv || 'KEYSTORE_PASSWORD',
    keyPasswordEnv: currentProject?.signing?.keyPasswordEnv || 'KEY_PASSWORD'
  }));
  const [variable, setVariable] = useState({
    name: '',
    type: 'text',
    value: ''
  });
  const styles = useMemo(() => createStyles(colors), [colors]);
  const two = width >= 760;
  const phone = width < 600;
  const copy = language === 'ru' ? {
    title: 'Настройки React проекта',
    app: 'Приложение',
    android: 'Android-сборка',
    theme: 'Тема',
    variables: 'Состояние (React)',
    identity: 'Идентификаторы и версии',
    build: 'Сборка и SDK',
    signing: 'Подпись Release',
    name: 'Название',
    package: 'Application ID',
    namespace: 'Namespace',
    version: 'Version name',
    code: 'Version code',
    min: 'Min SDK',
    target: 'Target SDK',
    compile: 'Compile SDK',
    react: 'React',
    vite: 'Vite',
    primary: 'Primary',
    secondary: 'Secondary',
    background: 'Background',
    dark: 'Тёмная тема',
    keystore: 'Путь к .jks',
    alias: 'Key alias',
    password: 'Переменная пароля',
    keyPassword: 'Переменная ключа',
    iconLabel: 'Иконка PNG (путь)',
    iconHint: 'Квадратный PNG ≥432×432, например /sdcard/Download/icon.png. Края (~17%) попадут под маску адаптивной иконки — логотип держите по центру. Пусто — иконка генерируется из цвета темы. После смены выполните «Подготовить проект».',
    saved: 'package.json и React-файлы обновлены',
    invalid: 'Проверьте Application ID.',
    add: 'Добавить',
    stateName: 'Имя',
    remove: 'Удалить?',
    noProject: 'Проект не открыт'
  } : {
    title: 'React project settings',
    app: 'Application',
    android: 'Android WebView',
    theme: 'Theme',
    variables: 'State (React)',
    identity: 'Identifiers and versions',
    build: 'Build and SDK',
    signing: 'Release signing',
    name: 'Application name',
    package: 'Application ID',
    namespace: 'Namespace',
    version: 'Version name',
    code: 'Version code',
    min: 'Min SDK',
    target: 'Target SDK',
    compile: 'Compile SDK',
    react: 'React',
    vite: 'Vite',
    primary: 'Primary',
    secondary: 'Secondary',
    background: 'Background',
    dark: 'Dark theme',
    keystore: '.jks path',
    alias: 'Key alias',
    password: 'Store password env',
    keyPassword: 'Key password env',
    iconLabel: 'Icon PNG (path)',
    iconHint: 'Square PNG ≥432×432, e.g. /sdcard/Download/icon.png. Edges (~17%) fall under the adaptive icon mask — keep the logo centered. Empty — icon is generated from the theme color. Re-run Prepare project after changing.',
    saved: 'package.json and React files updated',
    invalid: 'Check Application ID.',
    add: 'Add state',
    stateName: 'State name',
    remove: 'Delete state?',
    noProject: 'No project is open'
  };
  if (!currentProject) return <AppScreen className={styles.center}><Text className={styles.muted}>{copy.noProject}</Text></AppScreen>;
  const set = (key, value) => setForm(current => ({
    ...current,
    [key]: value
  }));
  const save = async () => {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(form.packageName)) {
      Alert.alert(copy.invalid);
      return;
    }
    setSaving(true);
    const updated = {
      ...currentProject,
      name: form.name.trim(),
      packageName: form.packageName.trim(),
      namespace: form.namespace.trim() || form.packageName.trim(),
      versionName: form.versionName.trim(),
      versionCode: Math.max(1, parseInt(form.versionCode, 10) || 1),
      minSdk: Math.max(24, parseInt(form.minSdk, 10) || 24),
      iconPngPath: form.iconPngPath.trim(),
      targetSdk: parseInt(form.targetSdk, 10) || 37,
      compileSdk: parseInt(form.compileSdk, 10) || 37,
      reactVersion: form.reactVersion.trim(),
      viteVersion: form.viteVersion.trim(),
      theme: {
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        backgroundColor: form.backgroundColor,
        isDark: form.isDark
      },
      signing: {
        keystorePath: form.keystorePath,
        keyAlias: form.keyAlias,
        storePasswordEnv: form.storePasswordEnv,
        keyPasswordEnv: form.keyPasswordEnv
      },
      updatedAt: Date.now()
    };
    dispatch({
      type: 'UPDATE_PROJECT',
      payload: updated
    });
    const result = await syncComposeProject(updated);
    setSaving(false);
    Alert.alert(result.success ? t('ready') : 'Build', result.success ? copy.saved : result.output || 'Save failed');
  };
  const addVariable = () => {
    if (!variable.name.trim()) return;
    const value = variable.type === 'number' ? Number(variable.value) || 0 : variable.type === 'boolean' ? variable.value === 'true' : variable.value;
    dispatch({
      type: 'ADD_VARIABLE',
      payload: {
        id: generateId(),
        name: variable.name.trim(),
        type: variable.type,
        value
      }
    });
    setVariable({
      name: '',
      type: 'text',
      value: ''
    });
  };
  return <AppScreen>
    <TopBar title={copy.title} subtitle={`${currentProject.name} · ${currentProject.packageName}`} onBack={() => navigation.goBack()} right={<PrimaryButton title={width >= 560 ? t('save') : ''} icon="save-outline" loading={saving} onPress={save} />} />
    <View className={styles.tabs}>
      <ScrollView horizontal={phone} showsHorizontalScrollIndicator={false} contentContainerStyle={phone ? { width: 570 } : { width: '100%' }}>
        <View style={{ width: '100%' }}>
          <SegmentedControl value={tab} onChange={setTab} options={[{
            value: 'app',
            label: copy.app,
            icon: 'logo-react'
          }, {
            value: 'android',
            label: copy.android,
            icon: 'logo-android'
          }, {
            value: 'theme',
            label: copy.theme,
            icon: 'color-palette-outline'
          }, {
            value: 'variables',
            label: copy.variables,
            icon: 'code-working-outline'
          }]} />
        </View>
      </ScrollView>
    </View>
    <ScrollView contentContainerClassName={styles.page} keyboardShouldPersistTaps="handled"><View className={styles.column}>
      {tab === 'app' ? <SectionCard title={copy.identity} icon="finger-print-outline"><View className={two ? styles.grid : null}><Field label={copy.name} value={form.name} onChangeText={v => set('name', v)} className={styles.field} /><Field label={copy.package} value={form.packageName} onChangeText={v => set('packageName', v)} autoCapitalize="none" className={styles.field} /><Field label={copy.namespace} value={form.namespace} onChangeText={v => set('namespace', v)} autoCapitalize="none" className={styles.field} /><Field label={copy.version} value={form.versionName} onChangeText={v => set('versionName', v)} className={styles.field} /><Field label={copy.code} value={form.versionCode} onChangeText={v => set('versionCode', v)} keyboardType="number-pad" className={styles.field} /></View><Field label={copy.iconLabel} value={form.iconPngPath} onChangeText={v => set('iconPngPath', v)} autoCapitalize="none" placeholder="/sdcard/Download/icon.png" className={styles.field} /><Text style={{
            color: colors.textSecondary,
            fontSize: 11,
            marginTop: 8,
            lineHeight: 16
          }}>{copy.iconHint}</Text></SectionCard> : null}
      {tab === 'android' ? <><SectionCard title={copy.build} icon="hammer-outline"><View className={two ? styles.grid : null}><Field label={copy.min} value={form.minSdk} onChangeText={v => set('minSdk', v)} keyboardType="number-pad" className={styles.field} /><Field label={copy.target} value={form.targetSdk} onChangeText={v => set('targetSdk', v)} keyboardType="number-pad" className={styles.field} /><Field label={copy.compile} value={form.compileSdk} onChangeText={v => set('compileSdk', v)} keyboardType="number-pad" className={styles.field} /><Field label={copy.react} value={form.reactVersion} onChangeText={v => set('reactVersion', v)} className={styles.field} /><Field label={copy.vite} value={form.viteVersion} onChangeText={v => set('viteVersion', v)} className={styles.field} /></View><Text style={{
              color: colors.textSecondary,
              fontSize: 11,
              marginTop: 8,
              lineHeight: 16
            }}>{language === 'ru' ? 'Нативная Android-оболочка на минимальном SDK. Интерфейс собирается полностью на React и встраивается в приложение локально (dist/index.html).' : 'Thin native Android shell on the minimal SDK. The UI is built fully in React and embedded locally (dist/index.html).'}</Text></SectionCard><SectionCard title={copy.signing} icon="key-outline"><Field label={copy.keystore} value={form.keystorePath} onChangeText={v => set('keystorePath', v)} autoCapitalize="none" /><Field label={copy.alias} value={form.keyAlias} onChangeText={v => set('keyAlias', v)} /><View className={two ? styles.grid : null}><Field label={copy.password} value={form.storePasswordEnv} onChangeText={v => set('storePasswordEnv', v)} className={styles.field} /><Field label={copy.keyPassword} value={form.keyPasswordEnv} onChangeText={v => set('keyPasswordEnv', v)} className={styles.field} /></View></SectionCard></> : null}
      {tab === 'theme' ? <SectionCard title={copy.theme} icon="color-palette-outline"><Toggle label={copy.dark} value={form.isDark} onChange={v => set('isDark', v)} colors={colors} styles={styles} /><ColorField label={copy.primary} value={form.primaryColor} onChange={v => set('primaryColor', v)} styles={styles} /><ColorField label={copy.secondary} value={form.secondaryColor} onChange={v => set('secondaryColor', v)} styles={styles} /><ColorField label={copy.background} value={form.backgroundColor} onChange={v => set('backgroundColor', v)} styles={styles} /><View className={styles.preview} style={{
            backgroundColor: form.backgroundColor
          }}><View className={styles.previewBar} style={{
              backgroundColor: form.primaryColor
            }}><Text className={styles.previewTitle}>{form.name}</Text></View><View className={styles.previewButton} style={{
              backgroundColor: form.primaryColor
            }} /><View className={styles.previewAccent} style={{
              backgroundColor: form.secondaryColor
            }} /></View></SectionCard> : null}
      {tab === 'variables' ? <SectionCard title={`${copy.variables} (${currentProject.variables?.length || 0})`} icon="code-working-outline"><View className={styles.variableForm} style={!two && {
            flexDirection: 'column',
            alignItems: 'stretch'
          }}><Field placeholder={copy.stateName} value={variable.name} onChangeText={v => setVariable(c => ({
              ...c,
              name: v
            }))} style={{
              flex: 2
            }} /><SegmentedControl value={variable.type} onChange={v => setVariable(c => ({
              ...c,
              type: v
            }))} options={[{
              value: 'text',
              label: 'String'
            }, {
              value: 'number',
              label: 'Int'
            }, {
              value: 'boolean',
              label: 'Boolean'
            }]} /><Field placeholder="Initial value" value={variable.value} onChangeText={v => setVariable(c => ({
              ...c,
              value: v
            }))} style={{
              flex: 1
            }} /><PrimaryButton title={copy.add} icon="add" disabled={!variable.name.trim()} onPress={addVariable} /></View>{(currentProject.variables || []).map(item => <View key={item.id} className={styles.variableRow}><View className={styles.variableIcon}><Icon name="code-slash-outline" size={16} color={colors.primary} /></View><View style={{
              flex: 1
            }}><Text className={styles.variableName}>{item.name}</Text><Text className={styles.variableMeta}>{item.type} · {String(item.value)}</Text></View><IconButton name="trash-outline" danger onPress={() => Alert.alert(copy.remove, '', [{
              text: t('cancel')
            }, {
              text: t('delete'),
              style: 'destructive',
              onPress: () => dispatch({
                type: 'DELETE_VARIABLE',
                payload: item.id
              })
            }])} /></View>)}</SectionCard> : null}
    </View></ScrollView>
  </AppScreen>;
};
const Toggle = ({
  label,
  value,
  onChange,
  colors,
  styles
}) => <View className={styles.toggle}><Text className={styles.toggleText}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{
    false: colors.borderLight,
    true: colors.primary
  }} thumbColor="#FFFFFF" /></View>;
const ColorField = ({
  label,
  value,
  onChange,
  styles
}) => <View className={styles.colorRow}><View className={styles.swatch} style={{
    backgroundColor: value
  }} /><Field label={label} value={value} onChangeText={onChange} autoCapitalize="characters" style={{
    flex: 1
  }} /></View>;
const createStyles = c => ({
  center: "items-center justify-center",
  muted: "text-text-secondary",
  tabs: "p-[8px] bg-bg-card border-b border-b-border",
  page: "p-[14px] pb-[50px]",
  column: "w-full max-w-[900px] self-center gap-[13px]",
  grid: "flex-row flex-wrap gap-[12px]",
  field: "w-[48%] min-w-[230px] grow",
  toggle: "min-h-[48px] flex-row items-center justify-between",
  toggleText: "text-text text-[13px] font-semibold",
  colorRow: "flex-row items-end gap-[9px]",
  swatch: "w-[46px] h-[46px] rounded-[10px] border border-border-light",
  preview: "h-[190px] rounded-[14px] overflow-hidden border border-border items-center gap-[13px]",
  previewBar: "w-full h-[50px] justify-center px-[14px]",
  previewTitle: "text-white text-[15px] font-bold",
  previewButton: "w-[130px] h-[38px] rounded-[19px]",
  previewAccent: "w-[80px] h-[8px] rounded-[4px]",
  variableForm: "flex-row items-end gap-[8px]",
  variableRow: "min-h-[58px] px-[10px] rounded-[10px] border border-border bg-bg flex-row items-center gap-[10px]",
  variableIcon: "w-[34px] h-[34px] rounded-[9px] bg-primary-surface items-center justify-center",
  variableName: "text-text font-mono text-[12px] font-bold",
  variableMeta: "text-text-secondary text-[9px] mt-[3px]"
});
export default ProjectSettingsScreen;
