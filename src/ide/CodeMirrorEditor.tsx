import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { cssInterop } from 'nativewind';
import { EDITOR_HTML } from './editorHtml';
import CodeEditor from '../components/CodeEditor';

/**
 * Professional VS Code-like code editor: a CodeMirror 6 editor running inside
 * an offline WebView (no network needed — the whole IDE editor is bundled in
 * editorHtml.js).
 *
 * The component mirrors the old CodeEditor's contract (value / onChange /
 * readOnly) so screens can switch without changing their data flow, and adds:
 *   - config: { themeMode, fontSize, tabSize, spacesForTab, wordWrap, completion }
 *   - diagnostics: [{ line, col, message, severity }] rendered as squiggles
 *   - onCursor: ({ line, col, lines, canUndo, canRedo })
 *   - ref.insert(text) / ref.command(name, arg) — toolbar integration
 *
 * If the WebView itself fails to load (e.g. a broken system WebView), the old
 * native editor is rendered as an automatic fallback.
 */
const StyledWebView: any = cssInterop(WebView, { className: 'style' });

type EditorConfig = {
  themeMode?: 'light' | 'dark' | string;
  fontSize?: number;
  tabSize?: number;
  spacesForTab?: boolean;
  wordWrap?: boolean;
  completion?: boolean;
};

export type CodeMirrorEditorHandle = {
  insert: (text: string) => void;
  command: (name: string, arg?: any) => void;
  focus: () => void;
  reload: () => void;
};

type CodeMirrorEditorProps = {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  config?: EditorConfig;
  diagnostics?: any[];
  onCursor?: (cursor: any) => void;
  onReady?: () => void;
  fallbackTitle?: string;
};

const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor({
  value = '',
  onChange,
  readOnly = false,
  placeholder,
  config = {},
  diagnostics = [],
  onCursor,
  onReady,
  fallbackTitle
}, ref) {
  const webRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const lastFromWebRef = useRef(null);
  const lastSentConfigRef = useRef('');
  const lastSentDiagRef = useRef('');
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onCursorRef.current = onCursor;
  }, [onCursor]);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const {
    themeMode = 'dark',
    fontSize = 15,
    tabSize = 4,
    spacesForTab = true,
    wordWrap = false,
    completion = true
  } = config;
  const post = useCallback(msg => {
    // Double JSON-encoding makes the payload immune to any special characters.
    const line = `window.__rn && window.__rn(${JSON.stringify(JSON.stringify(msg))});true;`;
    if (readyRef.current && webRef.current) {
      webRef.current.injectJavaScript(line);
    } else {
      queueRef.current.push(line);
    }
  }, []);

  // Push a new document when it changed outside the editor (file switch,
  // hydration, generate-from-design...). Typing echoes are filtered by the
  // lastFromWeb marker so the caret never jumps while editing.
  useEffect(() => {
    const text = value == null ? '' : String(value);
    if (text === lastFromWebRef.current) return;
    lastFromWebRef.current = text;
    post({
      type: 'set',
      value: text
    });
  }, [value, post]);

  // Editor configuration.
  useEffect(() => {
    const cfg = {
      theme: themeMode === 'light' ? 'light' : 'dark',
      fontSize,
      tabSize,
      spacesForTab,
      wordWrap,
      completion,
      readOnly
    };
    const key = JSON.stringify(cfg);
    if (key === lastSentConfigRef.current) return;
    lastSentConfigRef.current = key;
    post({
      type: 'config',
      config: cfg
    });
  }, [themeMode, fontSize, tabSize, spacesForTab, wordWrap, completion, readOnly, post]);

  // Lint diagnostics → inline squiggles.
  useEffect(() => {
    const items = (Array.isArray(diagnostics) ? diagnostics : []).slice(0, 200);
    const key = JSON.stringify(items);
    if (key === lastSentDiagRef.current) return;
    lastSentDiagRef.current = key;
    post({
      type: 'diagnostics',
      items
    });
  }, [diagnostics, post]);
  useImperativeHandle(ref, () => ({
    insert: text => post({
      type: 'insert',
      text: String(text)
    }),
    command: (name, arg) => post({
      type: 'command',
      name,
      arg
    }),
    focus: () => post({
      type: 'command',
      name: 'focus'
    }),
    reload: () => webRef.current?.reload?.()
  }), [post]);
  const handleMessage = useCallback(event => {
    let msg = null;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ready') {
      readyRef.current = true;
      setReady(true);
      const queued = queueRef.current;
      queueRef.current = [];
      queued.forEach(line => webRef.current?.injectJavaScript(line));
      if (onReadyRef.current) onReadyRef.current();
    } else if (msg.type === 'change') {
      const text = typeof msg.value === 'string' ? msg.value : '';
      lastFromWebRef.current = text;
      if (onChangeRef.current) onChangeRef.current(text);
    } else if (msg.type === 'cursor') {
      if (onCursorRef.current) onCursorRef.current(msg);
    }
  }, []);

  // The source object must keep a stable identity: a new object on each
  // render would be seen as a source change and could reload the page.
  const webSource = useMemo(() => ({
    html: EDITOR_HTML,
    baseUrl: 'about:blank'
  }), []);

  // If the page loads but the editor script never comes up (a badly broken
  // WebView runtime), fall back to the native editor instead of spinning forever.
  const [pageLoaded, setPageLoaded] = useState(false);
  useEffect(() => {
    if (!pageLoaded || readyRef.current) return undefined;
    const timer = setTimeout(() => {
      if (!readyRef.current) setFailed(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, [pageLoaded]);
  if (failed) {
    return <View className={styles.fallbackWrap}>
        {fallbackTitle ? <Text className={styles.fallbackNote}>{fallbackTitle}</Text> : null}
        <CodeEditor value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly} />
      </View>;
  }
  return <View className={styles.root}>
      <StyledWebView ref={webRef} originWhitelist={['*']} source={webSource} className={styles.web} style={{
      backgroundColor: themeMode === 'light' ? '#FFFFFF' : '#1E1E1E'
    }} onMessage={handleMessage} onLoadEnd={() => setPageLoaded(true)} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} javaScriptEnabled domStorageEnabled={false} keyboardDisplayRequiresUserAction={false} textZoom={100} setSupportMultipleWindows={false} overScrollMode="never" androidLayerType="hardware" scrollEnabled={false} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} />
      {!ready ? <View className={styles.loading} style={{
      backgroundColor: themeMode === 'light' ? '#FFFFFF' : '#1E1E1E'
    }} pointerEvents="none">
          <ActivityIndicator color="#569CD6" />
        </View> : null}
    </View>;
});
const styles = {
  root: "flex-1 min-h-0",
  web: "flex-1",
  loading: "absolute inset-0 items-center justify-center",
  fallbackWrap: "flex-1 min-h-0",
  fallbackNote: "text-[#8B98AD] text-[11px] text-center py-[6px] bg-[#111827]"
};
export default CodeMirrorEditor;
export const editorHtmlBytes = EDITOR_HTML.length;
