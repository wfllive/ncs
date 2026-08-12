import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppSettings } from '../store/appSettings';
import { SectionCard, SegmentedControl } from './AppUI';
import { Icon } from './Icon';

/**
 * Settings panel for the CodeMirror IDE editor: font size, indentation,
 * word wrap, autocomplete, the symbol toolbar, auto-save and the status bar.
 * Everything applies live — settings are persisted via the app settings store.
 */
import { cn } from "../utils/cn";

type SettingsRowProps = {
  label: React.ReactNode;
  desc?: React.ReactNode;
  onPress?: (...args: any[]) => void;
  value?: any;
  options?: Array<{ value: string; label: string }>;
  right?: React.ReactNode;
};

const EditorSettings = ({
  onClose
}) => {
  const {
    colors,
    language,
    editor,
    setEditorSetting
  } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ru = language === 'ru';
  const t = (ruKey, enKey) => ru ? ruKey : enKey;
  const toggle = key => () => setEditorSetting(key, !editor[key]);
  const fontSize = editor.fontSize || 15;
  const setFontSize = delta => () => {
    const next = Math.max(9, Math.min(28, fontSize + delta));
    setEditorSetting('fontSize', next);
  };
  const Row = ({
    label,
    desc,
    onPress,
    value,
    options,
    right
  }: SettingsRowProps) => <Pressable onPress={onPress} className={styles.row} disabled={!onPress}>
      <View style={{
      flex: 1
    }}>
        <Text className={styles.rowLabel}>{label}</Text>
        {desc ? <Text className={styles.rowDesc}>{desc}</Text> : null}
      </View>
      {right || (options ? <SegmentedControl compact value={value} onChange={onPress} options={options} /> : <View className={cn(styles.switch, value && styles.switchOn)}><View className={cn(styles.knob, value && styles.knobOn)} /></View>)}
    </Pressable>;
  return <View className={styles.root}>
      <View className={styles.head}>
        <View className={styles.headIcon}><Icon name="options-outline" size={18} color={colors.primary} /></View>
        <Text className={styles.headTitle}>{t('Настройки редактора', 'Editor settings')}</Text>
        <View style={{
        flex: 1
      }} />
        <Pressable onPress={onClose} className={styles.close}><Icon name="close" size={20} color={colors.textSecondary} /></Pressable>
      </View>
      <ScrollView className={styles.scroll} contentContainerStyle={{
      padding: 12,
      gap: 10
    }}>
        <SectionCard title={t('Шрифт', 'Font')} icon="text-outline">
          <Row label={t('Размер шрифта', 'Font size')} desc={t('Применяется и к коду, и к номерам строк', 'Applies to code and line numbers')} right={<View className={styles.stepper}>
                <Pressable onPress={setFontSize(-1)} className={styles.stepBtn}><Icon name="remove" size={17} color={colors.text} /></Pressable>
                <Text className={styles.stepValue}>{fontSize}</Text>
                <Pressable onPress={setFontSize(1)} className={styles.stepBtn}><Icon name="add" size={17} color={colors.text} /></Pressable>
              </View>} />
        </SectionCard>

        <SectionCard title={t('Отступы', 'Indentation')} icon="code-outline">
          <Row label={t('Размер табуляции', 'Tab size')} value={String(editor.tabSize)} onPress={v => setEditorSetting('tabSize', Number(v))} options={[{
          value: '2',
          label: '2'
        }, {
          value: '4',
          label: '4'
        }, {
          value: '8',
          label: '8'
        }]} />
          <Row label={t('Пробелы вместо табуляции', 'Spaces instead of tabs')} desc={editor.spacesForTab ? t('Tab вставляет пробелы', 'Tab inserts spaces') : t('Tab вставляет символ табуляции', 'Tab inserts a tab character')} value={editor.spacesForTab} onPress={toggle('spacesForTab')} />
        </SectionCard>

        <SectionCard title={t('Вид', 'View')} icon="color-wand-outline">
          <Row label={t('Перенос длинных строк', 'Word wrap')} desc={t('Переносить строки, не помещающиеся по ширине', 'Wrap lines wider than the editor')} value={editor.wordWrap} onPress={toggle('wordWrap')} />
          <Row label={t('Панель статуса', 'Status bar')} desc={t('Строка, столбец, язык — как в VS Code', 'Line, column, language — VS Code style')} value={editor.showStatusBar} onPress={toggle('showStatusBar')} />
        </SectionCard>

        <SectionCard title={t('Редактирование', 'Editing')} icon="flash-outline">
          <Row label={t('Автодополнение', 'Autocomplete')} desc={t('Подсказки ключевых слов и JSX snippets', 'Keyword hints and Compose snippets')} value={editor.completion !== false} onPress={toggle('completion')} />
          <Row label={t('Панель инструментов', 'Symbol toolbar')} desc={t('Кнопки скобок, отмены и команд над клавиатурой', 'Bracket, undo and command keys above the keyboard')} value={editor.hotkeys !== false} onPress={toggle('hotkeys')} />
          <Row label={t('Автосохранение', 'Auto-save')} desc={t('Автоматически сохраняет код на диск', 'Automatically saves code to disk')} value={editor.autoSave} onPress={toggle('autoSave')} />
        </SectionCard>

        <SectionCard title={t('Проверка кода', 'Code analysis')} icon="shield-checkmark-outline">
          <Row label={t('Компилятор после сохранения', 'Compiler check after save')} desc={t('Фоновой запуск npm run build — ошибки сами появятся в «Проблемах», ничего запускать не нужно', 'Runs npm run build in the background — compiler errors appear in Problems automatically, nothing to run')} value={editor.autoCheck !== false} onPress={toggle('autoCheck')} />
        </SectionCard>
      </ScrollView>
    </View>;
};
const createStyles = c => ({
  root: "w-full max-h-[580px] bg-bg-card rounded-[16px] overflow-hidden",
  head: "min-h-[52px] px-[12px] flex-row items-center gap-[9px] border-b border-b-border",
  headIcon: "w-[32px] h-[32px] rounded-[8px] items-center justify-center bg-primary-surface",
  headTitle: "text-text text-[14px] font-bold",
  close: "w-[34px] h-[34px] rounded-[8px] items-center justify-center",
  scroll: "shrink",
  row: "min-h-[46px] py-[6px] flex-row items-center gap-[10px]",
  rowLabel: "text-text text-[13px] font-semibold",
  rowDesc: "text-text-tertiary text-[10px] mt-[2px] pr-[10px]",
  switch: "w-[42px] h-[24px] rounded-[12px] bg-border p-[2px]",
  switchOn: "bg-primary",
  knob: "w-[20px] h-[20px] rounded-[10px] bg-white",
  knobOn: "translate-x-[18px]",
  stepper: "flex-row items-center gap-[8px] bg-bg-elevated rounded-[9px] px-[4px] py-[3px] border border-border",
  stepBtn: "w-[28px] h-[26px] rounded-[6px] items-center justify-center bg-bg-card",
  stepValue: "text-text text-[13px] font-bold min-w-[20px] text-center font-mono"
});
export default EditorSettings;
