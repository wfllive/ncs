import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Pressable, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppSettings } from '../store/appSettings';
import { Icon } from './Icon';
import { listProjectFiles, buildFileTree } from '../utils/projectFiles';
import { cn } from "../utils/cn";
const fileIcon = ext => {
  switch (ext) {
    case 'kt':
      return {
        name: 'logo-android',
        color: '#7C5CFF'
      };
    case 'kts':
      return {
        name: 'settings-outline',
        color: '#7C5CFF'
      };
    case 'xml':
      return {
        name: 'code-outline',
        color: '#E8863A'
      };
    case 'jsx':
    case 'js':
      return {
        name: 'logo-javascript',
        color: '#F0DB4F'
      };
    case 'json':
      return {
        name: 'braces-outline',
        color: '#F7C948'
      };
    case 'properties':
      return {
        name: 'settings-outline',
        color: '#7FB8E8'
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

/**
 * A VS Code-style file explorer sidebar. Lists the project's source files as a
 * collapsible tree; tapping a file opens it in the editor.
 */
const FileExplorer = ({
  project,
  activePath,
  onOpenFile,
  onClose,
  width
}: { project: any; activePath?: string; onOpenFile: (path: string) => void; onClose?: () => void; width?: number }) => {
  const {
    colors,
    language
  } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tree, setTree] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(['android', 'android/app', 'src', 'src/screens']));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const files = await listProjectFiles(project);
      setTree(buildFileTree(files));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [project]);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = path => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);else next.add(path);
      return next;
    });
  };
  const renderNode = (node, depth) => {
    const isDir = node.isDir;
    if (isDir) {
      const isOpen = expanded.has(node.path);
      return <View key={node.path || 'root'}>
          {node.path !== '' ? <Pressable onPress={() => toggle(node.path)} className={styles.row} style={{
          paddingLeft: 6 + depth * 14
        }}>
              <Icon name={isOpen ? 'chevron-down-outline' : 'chevron-forward-outline'} size={12} color={colors.textTertiary} />
              <Icon name="folder-outline" size={15} color="#E8A33D" />
              <Text className={styles.dirName} numberOfLines={1}>{node.name}</Text>
            </Pressable> : null}
          {isOpen ? node.children.map(c => renderNode(c, depth + 1)) : null}
        </View>;
    }
    const active = activePath === node.path;
    const icon = fileIcon(node.ext);
    return <Pressable key={node.path} onPress={() => onOpenFile(node.path)} className={cn(styles.row, active && styles.rowActive)} style={{
      paddingLeft: 22 + depth * 14
    }}>
        <Icon name={icon.name} size={14} color={active ? colors.primary : icon.color} />
        <Text className={cn(styles.fileName, active && styles.fileNameActive)} numberOfLines={1}>{node.name}</Text>
      </Pressable>;
  };
  return <SafeAreaView edges={['top', 'bottom']} className={styles.root} style={width ? {
    width
  } : null}>
      <View className={styles.head}>
        <Icon name="folder-open-outline" size={15} color={colors.primary} />
        <Text className={styles.headTitle}>{language === 'ru' ? 'Файлы проекта' : 'Project files'}</Text>
        <View style={{
        flex: 1
      }} />
        <Pressable onPress={onClose} className={styles.close}><Icon name="close" size={18} color={colors.textSecondary} /></Pressable>
      </View>
      {loading ? <View className={styles.center}><ActivityIndicator color={colors.primary} /></View> : error ? <View className={styles.center}><Text className={styles.error}>{error}</Text></View> : tree && tree.children.length ? <ScrollView className={styles.scroll} contentContainerStyle={{
      paddingBottom: 24
    }}>
          {tree.children.map(c => renderNode(c, 0))}
        </ScrollView> : <View className={styles.center}><Text className={styles.error}>{language === 'ru' ? 'Файлы не найдены' : 'No files found'}</Text></View>}
    </SafeAreaView>;
};
const createStyles = c => ({
  root: "flex-1 bg-bg-card border-r border-r-border",
  head: "min-h-[44px] px-[10px] flex-row items-center gap-[8px] border-b border-b-border",
  headTitle: "text-text text-[12px] font-bold",
  close: "w-[30px] h-[30px] rounded-[7px] items-center justify-center",
  scroll: "flex-1",
  row: "min-h-[32px] flex-row items-center gap-[6px] pr-[8px]",
  rowActive: "bg-primary-surface",
  dirName: "text-text text-[12px] font-semibold flex-1",
  fileName: "text-text-secondary text-[12px] flex-1",
  fileNameActive: "text-primary font-bold",
  center: "flex-1 items-center justify-center p-[20px]",
  error: "text-text-secondary text-[11px] text-center"
});
export default FileExplorer;
