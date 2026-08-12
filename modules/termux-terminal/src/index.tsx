import { EventEmitter, requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { View } from 'react-native';
import { cssInterop } from 'nativewind';
import React, { useRef, forwardRef, useImperativeHandle } from 'react';

let nativeModule: any = null;
try {
  nativeModule = requireNativeModule('TermuxTerminal');
} catch (e) {}

export const isAvailable = () => !!nativeModule;
export const commandEvents = nativeModule ? new EventEmitter(nativeModule) : null;

export const execute = async (command: string, workDir?: string) => {
  if (!nativeModule) return { success: false, exitCode: -1, output: 'TermuxTerminal not available' };
  return await nativeModule.execute(command, workDir || null);
};

export const checkCommand = async (command: string) => {
  if (!nativeModule) return { exists: false, path: '' };
  return await nativeModule.checkCommand(command);
};

export const getNodeVersion = async () => {
  if (!nativeModule) return { version: null, path: '' };
  return await nativeModule.getNodeVersion();
};

export const installNode = async () => {
  if (!nativeModule) return { success: false, output: 'Not available', version: null };
  return await nativeModule.installNode();
};

export interface ProotStatus {
  prootBinary: boolean;
  rootfsInstalled: boolean;
  ready: boolean;
  nativeLibDir: string;
  rootfsDir: string;
  rootfsArch?: number;
}

export const getProotStatus = async (): Promise<ProotStatus> => {
  if (!nativeModule) {
    return { prootBinary: false, rootfsInstalled: false, ready: false, nativeLibDir: '', rootfsDir: '' };
  }
  return await nativeModule.getProotStatus();
};

export interface PrepareProotResult {
  success: boolean;
  exitCode: number;
  output: string;
}

/**
 * Run the apt/dpkg self-healing step inside the proot rootfs (fixes permissions,
 * writes proot-friendly apt configuration, runs `dpkg --configure -a` and
 * `apt-get -f install -y`). Pass force=true to re-run even if already prepared.
 */
export const prepareProot = async (force = false): Promise<PrepareProotResult> => {
  if (!nativeModule) {
    return { success: false, exitCode: -1, output: 'TermuxTerminal not available' };
  }
  return await nativeModule.prepareProot(Boolean(force));
};

export interface ProotDiagnosis {
  ok: boolean;
  output: string;
  arch: string;
  prootExists: boolean;
  loaderExists: boolean;
  rootfsInstalled: boolean;
}

export const diagnoseProot = async (): Promise<ProotDiagnosis> => {
  if (!nativeModule) {
    return { ok: false, output: 'TermuxTerminal not available', arch: '', prootExists: false, loaderExists: false, rootfsInstalled: false };
  }
  return await nativeModule.diagnoseProot();
};

export const copyToClipboard = async (text: string): Promise<void> => {
  if (!nativeModule) return;
  try {
    await nativeModule.copyToClipboard(text);
  } catch (e) {}
};

// Native Terminal View (Termux TerminalView + ExtraKeys bar)
let NativeTerminalView: any = null;
try {
  NativeTerminalView = requireNativeViewManager('TermuxTerminal');
} catch (e) {}
const StyledNativeTerminalView = NativeTerminalView
  ? cssInterop(NativeTerminalView, { className: 'style' })
  : null;

export type TerminalEvent =
  | { type: 'started'; shell: string; cwd: string; pid: number; bootstrap: boolean }
  | { type: 'title'; title: string }
  | { type: 'exit'; exitCode: number };

export interface TerminalViewRef {
  /** Write raw text to the shell (no trailing newline). */
  writeText: (text: string) => void;
  /** Run a command (adds a trailing newline). */
  run: (command: string) => void;
  /** Simulate an extra key press, e.g. "ENTER", "ESC", "TAB", "UP". */
  sendKey: (key: string) => void;
  /** Restart the shell session. */
  restart: () => void;
  /** Toggle the soft keyboard. */
  toggleKeyboard: () => void;
  /** Paste the Android clipboard into the terminal. Resolves true on success. */
  pasteFromClipboard: () => Promise<boolean> | void;
  /** Copy the whole terminal transcript to the Android clipboard. Resolves true on success. */
  copyTranscriptToClipboard: () => Promise<boolean> | void;
  /** Get the whole terminal transcript (scrollback included). Resolves to text or null. */
  getTranscriptText: () => Promise<string | null> | void;
}

interface TerminalViewProps {
  className?: string;
  style?: any;
  /** Terminal font size in points (6..64). */
  fontSize?: number;
  /** Working directory for the shell. */
  workingDirectory?: string;
  /** Command executed once the shell is ready. */
  initialCommand?: string;
  /** Custom extra-keys layout (Termux JSON format). */
  extraKeys?: string;
  /** Read-only viewer: hides the extra-keys bar and blocks the soft keyboard / typing,
   * so the terminal only shows output and every action is launched by app buttons. */
  readOnly?: boolean;
  /** Terminal lifecycle events. */
  onTerminalEvent?: (event: { nativeEvent: TerminalEvent }) => void;
}

export const TerminalView = forwardRef<TerminalViewRef, TerminalViewProps>(
  ({ className, style, fontSize, workingDirectory, initialCommand, extraKeys, readOnly, onTerminalEvent }, ref) => {
    const nativeRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      writeText: (text: string) => nativeRef.current?.writeText?.(text),
      run: (command: string) => nativeRef.current?.writeText?.(command + '\n'),
      sendKey: (key: string) => nativeRef.current?.sendKey?.(key),
      restart: () => nativeRef.current?.restart?.(),
      toggleKeyboard: () => nativeRef.current?.toggleKeyboard?.(),
      pasteFromClipboard: () => nativeRef.current?.pasteFromClipboard?.(),
      copyTranscriptToClipboard: () => nativeRef.current?.copyTranscriptToClipboard?.(),
      getTranscriptText: () => nativeRef.current?.getTranscriptText?.(),
    }));

    if (!StyledNativeTerminalView) {
      return (
        <View className={`flex-1 bg-[#0D1117] ${className || ''}`} style={style}>
          <View className="flex-1 bg-[#0D1117] p-2.5" />
        </View>
      );
    }

    return (
      <StyledNativeTerminalView
        ref={nativeRef}
        className={`flex-1 ${className || ''}`}
        style={style}
        fontSize={fontSize ?? 13}
        workingDirectory={workingDirectory}
        initialCommand={initialCommand}
        extraKeys={extraKeys}
        readOnly={readOnly ?? false}
        onTerminalEvent={onTerminalEvent}
      />
    );
  }
);

TerminalView.displayName = 'TerminalView';

export default {
  isAvailable,
  execute,
  checkCommand,
  getNodeVersion,
  installNode,
  getProotStatus,
  TerminalView,
};
