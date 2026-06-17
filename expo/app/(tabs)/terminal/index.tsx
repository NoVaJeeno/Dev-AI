import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Animated, Platform, KeyboardAvoidingView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Terminal, Send, Trash2, Copy, ChevronRight, Circle,
  Zap, Clock, Cpu, HardDrive, Code,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useStorage } from '@/providers/StorageProvider';
import { executeCommand } from '@/utils/sandboxEngine';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system' | 'info';
  text: string;
  timestamp: number;
}

export default function TerminalScreen() {
  const { currentProject, state } = useStorage();
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const addLine = useCallback((type: TerminalLine['type'], text: string) => {
    const line: TerminalLine = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type, text, timestamp: Date.now(),
    };
    setLines(prev => [...prev.slice(-300), line]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  const getProjectFiles = useCallback((): Record<string, string> => {
    if (!currentProject) return {};
    const files: Record<string, string> = {};
    for (const f of currentProject.files) {
      if (f.type === 'file') files[f.path] = f.content;
    }
    return files;
  }, [currentProject]);

  const executeTerminalCommand = useCallback(async (command: string) => {
    if (!command.trim() || isExecuting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    addLine('input', `$ ${command}`);
    setInput('');
    setIsExecuting(true);

    const newHistory = [command, ...commandHistory.filter(c => c !== command)].slice(0, 50);
    setCommandHistory(newHistory);
    setHistoryIndex(-1);

    try {
      const files = getProjectFiles();
      const env: Record<string, string> = {
        PROJECT_NAME: currentProject?.name || 'no-project',
        PROJECT_TYPE: currentProject?.type || '',
        PLATFORM: Platform.OS,
        NODE_ENV: 'development',
        SHELL: '/bin/devai',
        USER: 'developer',
        HOME: '/project',
      };

      const result = await executeCommand(command, files, env);

      if (result.error) {
        addLine('error', result.output);
      } else if (result.output.startsWith('\x1b[2J')) {
        setLines([]);
        addLine('system', 'Terminal gelöscht.');
      } else {
        const outputLines = result.output.split('\n');
        for (const line of outputLines) {
          if (line.trim()) addLine('output', line);
        }
        if (result.truncated) {
          addLine('info', `(Output bei ${result.output.length} Zeichen gekürzt)`);
        }
        addLine('info', `⏱ ${Math.round(result.duration)}ms`);
      }
    } catch (e) {
      addLine('error', `Internal Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExecuting(false);
    }
  }, [isExecuting, addLine, getProjectFiles, currentProject, commandHistory]);

  const handleSubmit = useCallback(() => {
    executeTerminalCommand(input.trim());
  }, [input, executeTerminalCommand]);

  const clearTerminal = useCallback(() => {
    setLines([]);
    addLine('system', 'Terminal gelöscht.');
  }, [addLine]);

  const copyOutput = useCallback(async () => {
    const text = lines.map(l => {
      if (l.type === 'input') return l.text;
      return l.text;
    }).join('\n');
    try {
      await Clipboard.setStringAsync(text);
      addLine('system', 'Output in Zwischenablage kopiert.');
    } catch {
      addLine('error', 'Kopieren fehlgeschlagen.');
    }
  }, [lines, addLine]);

  const getLineColor = (type: TerminalLine['type']): string => {
    switch (type) {
      case 'input': return theme.colors.primary;
      case 'output': return theme.colors.codeText;
      case 'error': return theme.colors.error;
      case 'system': return theme.colors.accent;
      case 'info': return theme.colors.textSecondary;
      default: return theme.colors.text;
    }
  };

  // Quick command chips
  const quickCommands = useMemo(() => [
    { cmd: 'ls -l', desc: 'Dateien' },
    { cmd: 'tree', desc: 'Struktur' },
    { cmd: 'env', desc: 'Env' },
    { cmd: 'du', desc: 'Größen' },
    { cmd: 'stats', desc: 'Stats' },
    { cmd: 'help', desc: 'Hilfe' },
    { cmd: 'eval 2+2', desc: 'JS Eval' },
    { cmd: 'curl https://httpbin.org/json', desc: 'HTTP' },
  ], []);

  const stats = useMemo(() => {
    const files = getProjectFiles();
    const keys = Object.keys(files);
    let totalLines = 0;
    let totalSize = 0;
    for (const content of Object.values(files)) {
      totalLines += content.split('\n').length;
      totalSize += content.length;
    }
    return { files: keys.length, lines: totalLines, size: totalSize };
  }, [getProjectFiles]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Terminal size={20} color={theme.colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Dev Terminal</Text>
            <View style={styles.statusRow}>
              <Animated.View style={[styles.statusDot, { opacity: pulseAnim }]} />
              <Text style={styles.statusText}>Live · {currentProject?.name || 'Kein Projekt'}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={copyOutput} activeOpacity={0.7}>
            <Copy size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={clearTerminal} activeOpacity={0.7}>
            <Trash2 size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {!currentProject && (
        <View style={styles.noProjectBanner}>
          <HardDrive size={16} color={theme.colors.warning} />
          <Text style={styles.noProjectText}>Kein Projekt ausgewählt. Erstelle oder wähle ein Projekt für Datei-Operationen.</Text>
        </View>
      )}

      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Code size={12} color={theme.colors.primary} />
          <Text style={styles.statValue}>{stats.files}</Text>
          <Text style={styles.statLabel}>Dateien</Text>
        </View>
        <View style={styles.statItem}>
          <Zap size={12} color={theme.colors.warning} />
          <Text style={styles.statValue}>{stats.lines}</Text>
          <Text style={styles.statLabel}>Zeilen</Text>
        </View>
        <View style={styles.statItem}>
          <HardDrive size={12} color={theme.colors.accent} />
          <Text style={styles.statValue}>{(stats.size / 1024).toFixed(1)}K</Text>
          <Text style={styles.statLabel}>Größe</Text>
        </View>
        <View style={styles.statItem}>
          <Cpu size={12} color={theme.colors.secondary} />
          <Text style={styles.statValue}>{state.projects.length}</Text>
          <Text style={styles.statLabel}>Projekte</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.terminalArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.terminalOutput}
          contentContainerStyle={styles.terminalOutputContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
        >
          {lines.length === 0 && (
            <View style={styles.emptyTerminal}>
              <Terminal size={48} color={theme.colors.textTertiary} />
              <Text style={styles.emptyTitle}>DevAI Terminal v2.0</Text>
              <Text style={styles.emptySubtitle}>Echte Befehlsausführung · Kein Simulator</Text>
              <View style={styles.quickCmdRow}>
                {quickCommands.map((qc, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.quickCmdChip}
                    onPress={() => executeTerminalCommand(qc.cmd)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.quickCmdText}>{qc.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {lines.map((line) => (
            <View key={line.id} style={styles.terminalLine}>
              {line.type === 'input' && (
                <ChevronRight size={12} color={theme.colors.primary} style={{ marginTop: 3 }} />
              )}
              {line.type === 'system' && (
                <Circle size={6} color={theme.colors.accent} style={{ marginTop: 6 }} />
              )}
              {line.type === 'error' && (
                <Circle size={6} color={theme.colors.error} style={{ marginTop: 6 }} />
              )}
              {line.type === 'info' && (
                <Clock size={10} color={theme.colors.textTertiary} style={{ marginTop: 4 }} />
              )}
              <Text
                style={[
                  styles.terminalText,
                  { color: getLineColor(line.type) },
                  line.type === 'input' && styles.terminalTextBold,
                ]}
                selectable
              >
                {line.text}
              </Text>
            </View>
          ))}
          {isExecuting && (
            <View style={styles.terminalLine}>
              <ActivityIndicator size="small" color={theme.colors.warning} style={{ marginRight: 8 }} />
              <Text style={[styles.terminalText, { color: theme.colors.warning }]}>Wird ausgeführt...</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputBar}>
          <Text style={styles.promptChar}>$</Text>
          <TextInput
            ref={inputRef}
            style={styles.terminalInput}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSubmit}
            placeholder={isExecuting ? 'Befehl wird ausgeführt...' : 'Befehl eingeben...'}
            placeholderTextColor={theme.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isExecuting}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || isExecuting) && styles.sendBtnDisabled]}
            onPress={handleSubmit}
            disabled={!input.trim() || isExecuting}
            activeOpacity={0.7}
          >
            {isExecuting ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Send size={16} color={input.trim() ? theme.colors.primary : theme.colors.textTertiary} />
            )}
          </TouchableOpacity>
        </View>

        {commandHistory.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.historyBar}
            contentContainerStyle={styles.historyBarContent}
            keyboardShouldPersistTaps="always"
          >
            {commandHistory.slice(0, 15).map((cmd, idx) => (
              <TouchableOpacity
                key={`${cmd}_${idx}`}
                style={styles.historyChip}
                onPress={() => { setInput(cmd); inputRef.current?.focus(); }}
                activeOpacity={0.7}
              >
                <Text style={styles.historyChipText} numberOfLines={1}>{cmd}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.primaryMuted, borderWidth: 1, borderColor: theme.colors.primary + '30', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.accent },
  statusText: { fontSize: 11, color: theme.colors.textSecondary },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  noProjectBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: theme.colors.warning + '10', borderBottomWidth: 1, borderBottomColor: theme.colors.warning + '20' },
  noProjectText: { flex: 1, fontSize: 12, color: theme.colors.warning },
  statsBar: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.backgroundSecondary },
  statItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 12, fontWeight: '700', color: theme.colors.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  statLabel: { fontSize: 10, color: theme.colors.textTertiary, marginLeft: 2 },
  terminalArea: { flex: 1 },
  terminalOutput: { flex: 1 },
  terminalOutputContent: { padding: 12, paddingBottom: 12 },
  emptyTerminal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.text, marginTop: 16 },
  emptySubtitle: { fontSize: 13, color: theme.colors.accent, marginTop: 4 },
  quickCmdRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 20, paddingHorizontal: 16 },
  quickCmdChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  quickCmdText: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '500' },
  terminalLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 3, paddingRight: 8 },
  terminalText: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 17, flexShrink: 1 },
  terminalTextBold: { fontWeight: '700' },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.backgroundSecondary },
  promptChar: { fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.accent, marginRight: 8, fontWeight: '700' },
  terminalInput: { flex: 1, color: theme.colors.text, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', paddingVertical: 8 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.3 },
  historyBar: { maxHeight: 38, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.backgroundSecondary },
  historyBarContent: { paddingHorizontal: 10, paddingVertical: 6, gap: 6, flexDirection: 'row' },
  historyChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, maxWidth: 150 },
  historyChipText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.textSecondary },
});
