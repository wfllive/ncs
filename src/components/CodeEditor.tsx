import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppSettings } from '../store/appSettings';
import { highlightJSX } from '../utils/kotlinHighlighter';

/**
 * A professional VS Code-like monospace JSX editor.
 *
 * Rendering model (reliable on Android):
 *   - a <Text> renders the syntax-highlighted code in flow and defines the
 *     content's natural height;
 *   - an absolutely-positioned <TextInput> sits exactly on top with transparent
 *     text but a visible caret/selection.
 * Both layers share identical metrics (font, size, lineHeight,
 * includeFontPadding:false) and identical padding, so the caret stays aligned
 * with the highlighted text. A compact right-aligned gutter carries the line
 * numbers and highlights the current line.
 */
import { cn } from "../utils/cn";
const CodeEditor = ({
  value = '',
  onChange,
  placeholder,
  readOnly = false
}) => {
  const {
    colors,
    editor
  } = useAppSettings();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inputRef = useRef(null);
  const fontSize = editor.fontSize || 14;
  const tabSize = editor.tabSize || 4;
  const spacesForTab = editor.spacesForTab !== false;
  const wordWrap = editor.wordWrap === true;
  const minimap = editor.minimap !== false;
  const lineHeight = Math.round(fontSize * 1.6);
  const PAD_X = 16;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 24;
  const MINIMAP_W = 18;
  const lines = useMemo(() => {
    const count = value ? value.split('\n').length : 1;
    return Array.from({
      length: count
    }, (_, i) => i + 1);
  }, [value]);
  const highlighted = useMemo(() => highlightJSX(value), [value]);
  const stats = useMemo(() => {
    const text = value || '';
    return {
      lineCount: text ? text.split('\n').length : 0,
      chars: text.length
    };
  }, [value]);
  const [selection, setSelection] = useState({
    start: 0,
    end: 0
  });
  const [controlledSelection, setControlledSelection] = useState(null);
  const prevValueRef = useRef(value);
  const caretOverride = useRef(null);
  const pos = useMemo(() => {
    const text = value || '';
    const upTo = Math.max(0, Math.min(selection.start, text.length));
    const before = text.slice(0, upTo);
    const parts = before.split('\n');
    return {
      line: parts.length,
      col: parts[parts.length - 1].length + 1
    };
  }, [selection.start, value]);
  const currentLineIndex = pos.line - 1;
  const minimapLines = useMemo(() => {
    if (!value) return [];
    return value.split('\n').map(l => {
      const t = l.trim();
      if (!t) return 0;
      if (/^(val|var|fun|class|object|interface|@)/.test(t)) return 2;
      return 1;
    });
  }, [value]);
  const gutterWidth = useMemo(() => {
    const digits = Math.max(1, String(lines.length).length);
    return 14 + digits * 8 + 6;
  }, [lines.length]);
  const focusInput = useCallback(() => inputRef.current?.focus?.(), []);
  const indentationUnit = spacesForTab ? ' '.repeat(tabSize) : '\t';
  const applyText = useCallback((text, caret = null) => {
    prevValueRef.current = text;
    if (onChange) onChange(text);
    if (caret != null) {
      caretOverride.current = caret;
      setControlledSelection({
        start: caret,
        end: caret
      });
    }
  }, [onChange]);
  const handleChange = text => {
    const prev = prevValueRef.current;
    prevValueRef.current = text;
    if (!onChange) return;
    const appended = text.length >= prev.length ? text.slice(prev.length) : '';
    const isEnter = appended && appended[appended.length - 1] === '\n';
    if (isEnter) {
      const insertStart = text.length - appended.length;
      const before = text.slice(0, insertStart);
      const lineStart = before.lastIndexOf('\n') + 1;
      const prevLine = before.slice(lineStart);
      const indentMatch = prevLine.match(/^[ \t]*/);
      let indent = indentMatch ? indentMatch[0] : '';
      const deeper = /[{\->]\s*$/.test(prevLine) || /->\s*$/.test(prevLine);
      if (deeper) indent += indentationUnit;
      onChange(text);
      if (indent) {
        const newText = text.slice(0, insertStart + appended.length) + indent + text.slice(insertStart + appended.length);
        const caret = insertStart + appended.length + indent.length;
        prevValueRef.current = newText;
        onChange(newText);
        caretOverride.current = caret;
        setControlledSelection({
          start: caret,
          end: caret
        });
      } else {
        caretOverride.current = insertStart + appended.length;
        setControlledSelection({
          start: insertStart + appended.length,
          end: insertStart + appended.length
        });
      }
      return;
    }
    onChange(text);
  };
  const handleKeyPress = e => {
    if (e.nativeEvent.key === 'Tab') {
      e.preventDefault?.();
      const text = value || '';
      const caret = selection.start;
      const newText = text.slice(0, caret) + indentationUnit + text.slice(caret);
      applyText(newText, caret + indentationUnit.length);
    }
  };
  const codeTextStyle = {
    fontFamily: 'monospace',
    fontSize,
    lineHeight,
    includeFontPadding: false
  };
  return <View className={styles.root}>
      <ScrollView className={styles.wrap} contentContainerClassName={styles.content} scrollEventThrottle={32} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <View className={styles.body}>
          {/* Gutter with line numbers */}
          <View className={styles.gutter} style={{
          width: gutterWidth
        }} onStartShouldSetResponder={focusInput}>
            {lines.map((n, i) => {
            const isCurrent = i === currentLineIndex;
            return <View key={i} className={cn(styles.lineRow, isCurrent && styles.lineRowCurrent)} style={{
              height: lineHeight
            }}>
                  <Text className={cn(styles.lineNum, isCurrent && styles.lineNumCurrent)} style={{
                fontSize,
                lineHeight
              }} numberOfLines={1}>
                    {n}
                  </Text>
                </View>;
          })}
          </View>

          {/* Code area: the highlight <Text> is the ONLY visible layer. The
              TextInput sits on top with its text color equal to the editor
              background, so its own glyphs are invisible even if Android renders
              them — only the caret and selection show. This guarantees the code
              is never doubled or misaligned. */}
          <Pressable onPress={focusInput} className={styles.codeArea} android_disableSound>
            <View style={{
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
            paddingHorizontal: PAD_X
          }}>
              {value.length > 0 ? <Text style={codeTextStyle}>
                  {highlighted.map((span, i) => <Text key={i} style={{
                color: span.color
              }}>{span.text}</Text>)}
                </Text> : <Text className={styles.placeholder} style={{
              fontSize,
              lineHeight
            }}>{placeholder}</Text>}
            </View>

            <TextInput ref={inputRef} className={styles.input} style={{
            fontSize,
            lineHeight,
            paddingTop: PAD_TOP,
            paddingBottom: PAD_BOTTOM,
            paddingHorizontal: PAD_X,
            color: colors.terminal
          }} value={value} onChangeText={handleChange} onKeyPress={handleKeyPress} selection={controlledSelection || undefined} onSelectionChange={e => {
            setSelection(e.nativeEvent.selection || {
              start: 0,
              end: 0
            });
            if (caretOverride.current != null) {
              caretOverride.current = null;
              setControlledSelection(null);
            }
          }} multiline editable={!readOnly} autoCapitalize="none" autoCorrect={false} spellCheck={false} selectionColor={colors.primary} scrollEnabled={false} textAlignVertical="top" pointerEvents="auto" />
          </Pressable>

          {/* Minimap */}
          {minimap ? <View className={styles.minimap} style={{
          width: MINIMAP_W
        }} pointerEvents="none">
              {minimapLines.map((k, i) => <View key={i} className={cn(styles.minimapLine, i === currentLineIndex && styles.minimapLineCurrent)} style={{
            height: lineHeight
          }}>
                  <View className={styles.minimapBlock} style={{
              backgroundColor: k === 2 ? '#C586C0' : k === 1 ? '#5F6D83' : 'transparent'
            }} />
                </View>)}
            </View> : null}
        </View>
      </ScrollView>

      {editor.showStatusBar !== false ? <View className={styles.statusBar}>
          <Text className={styles.statusText}>Ln {pos.line}, Col {pos.col}</Text>
          <Text className={styles.statusText}>{stats.lineCount} lines</Text>
          <Text className={styles.statusText}>{stats.chars} chars</Text>
          <View style={{
        flex: 1
      }} />
          <Text className={styles.statusText}>{spacesForTab ? `Spaces: ${tabSize}` : 'Tabs'}</Text>
          <Text className={styles.statusText}>{wordWrap ? 'Wrap: On' : 'Wrap: Off'}</Text>
        </View> : null}
    </View>;
};
const createStyles = c => ({
  root: "flex-1 min-h-0",
  wrap: "flex-1 bg-terminal min-h-0",
  content: "grow",
  body: "flex-row grow min-h-full",
  gutter: "pr-[6px] bg-terminal-raised border-r border-r-[#1B2433]",
  lineRow: "justify-center pr-[6px]",
  lineRowCurrent: "bg-primary-surface",
  lineNum: "text-[#5A6B84] font-mono text-right",
  lineNumCurrent: "text-primary font-bold",
  codeArea: "flex-1 min-w-0 bg-terminal",
  placeholder: "text-text-tertiary font-mono",
  input: "absolute top-0 left-0 right-0 bottom-0 font-mono z-[2] bg-transparent",
  minimap: "border-l border-l-[#1B2433] bg-terminal overflow-hidden pt-0",
  minimapLine: "w-full justify-center px-[3px]",
  minimapLineCurrent: "bg-[rgba(255,255,255,0.06)]",
  minimapBlock: "h-[3px] rounded-[1px]",
  statusBar: "min-h-[26px] px-[12px] flex-row items-center gap-[14px] bg-terminal-raised border-t border-t-[#1B2433]",
  statusText: "text-[#8B98AD] text-[10px] font-mono"
});
export default CodeEditor;
