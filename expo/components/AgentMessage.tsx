import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Platform, Alert } from 'react-native';
import { Haptics } from '@/utils/haptics';
import {
  Bot,
  User,
  Terminal,
  CheckCircle,
  AlertCircle,
  Loader,
  FileCode,
  FolderPlus,
  Trash2,
  Search,
  Package,
  Eye,
  Download,
  Play,
  Globe,
  ImagePlus,
  LayoutTemplate,
  Copy,
  ClipboardCopy,
  Check,
  BarChart3,
  Zap,
  Braces,
  Key,
  Clock,
  Regex,
  Hash,
  Lock,
  Palette,
  Type,
  Calculator,
  Ruler,
  Database,
  Brain,
  History,
  BookOpen,
  Sparkles,
  ArrowUpDown,
  BarChart,
  CaseSensitive,
  Code2,
  FileQuestion,
  GitBranch,
  Minimize2,
  Settings2,
  WrapText,
  ScanEye,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';

interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface AgentMessageType {
  id: string;
  role: string;
  parts: MessagePart[];
}

interface AgentMessageProps {
  message: AgentMessageType;
  isLatest?: boolean;
  onPreviewProject?: (projectName: string) => void;
  onSaveProject?: (projectName: string) => void;
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  createProject: <FolderPlus size={13} color={theme.colors.accent} />,
  writeFile: <FileCode size={13} color={theme.colors.primary} />,
  readFile: <FileCode size={13} color={theme.colors.secondary} />,
  deleteFile: <Trash2 size={13} color={theme.colors.error} />,
  renameFile: <FileCode size={13} color={theme.colors.warning} />,
  createFolder: <FolderPlus size={13} color={theme.colors.accent} />,
  listFiles: <Search size={13} color={theme.colors.textSecondary} />,
  grep: <Search size={13} color={theme.colors.warning} />,
  findReplace: <Search size={13} color={theme.colors.primary} />,
  installPackage: <Package size={13} color={theme.colors.accent} />,
  uninstallPackage: <Package size={13} color={theme.colors.error} />,
  listProjects: <Search size={13} color={theme.colors.textSecondary} />,
  selectProject: <FolderPlus size={13} color={theme.colors.primary} />,
  getProjectInfo: <Search size={13} color={theme.colors.secondary} />,
  updateProjectStatus: <FileCode size={13} color={theme.colors.warning} />,
  previewProject: <Eye size={13} color={theme.colors.primary} />,
  analyzeCode: <Terminal size={13} color={theme.colors.accent} />,
  duplicateFile: <FileCode size={13} color={theme.colors.secondary} />,
  getAppStructure: <FolderPlus size={13} color={theme.colors.primary} />,
  bulkWriteFiles: <FileCode size={13} color={theme.colors.accent} />,
  webFetch: <Globe size={13} color={theme.colors.primary} />,
  generateImage: <ImagePlus size={13} color={theme.colors.secondary} />,
  scaffoldProject: <LayoutTemplate size={13} color={theme.colors.accent} />,
  cloneProject: <Copy size={13} color={theme.colors.warning} />,
  deleteProject: <Trash2 size={13} color={theme.colors.error} />,
  exportFile: <Download size={13} color={theme.colors.accent} />,
  getProjectStats: <BarChart3 size={13} color={theme.colors.primary} />,
  httpRequest: <Globe size={13} color={theme.colors.accent} />,
  mergeFiles: <Copy size={13} color={theme.colors.secondary} />,
  appendToFile: <FileCode size={13} color={theme.colors.primary} />,
  insertInFile: <FileCode size={13} color={theme.colors.warning} />,
  generateComponent: <Zap size={13} color={theme.colors.accent} />,
  generateScreen: <Zap size={13} color={theme.colors.primary} />,
  generateHook: <Zap size={13} color={theme.colors.warning} />,
  generateApiRoute: <Globe size={13} color={theme.colors.accent} />,
  generateModel: <BarChart3 size={13} color={theme.colors.secondary} />,
  getEnvironmentInfo: <Terminal size={13} color={theme.colors.textSecondary} />,
  validateJson: <Braces size={13} color={theme.colors.accent} />,
  generateUuid: <Key size={13} color={theme.colors.secondary} />,
  convertTimestamp: <Clock size={13} color={theme.colors.warning} />,
  testRegex: <Regex size={13} color={theme.colors.primary} />,
  encodeDecodeText: <Hash size={13} color={theme.colors.accent} />,
  hashText: <Hash size={13} color={theme.colors.secondary} />,
  generatePassword: <Lock size={13} color={theme.colors.error} />,
  diffTexts: <Copy size={13} color={theme.colors.warning} />,
  formatCode: <FileCode size={13} color={theme.colors.primary} />,
  calculateExpression: <Calculator size={13} color={theme.colors.accent} />,
  colorConvert: <Palette size={13} color={theme.colors.secondary} />,
  loremIpsum: <Type size={13} color={theme.colors.textSecondary} />,
  generateMockData: <Database size={13} color={theme.colors.primary} />,
  convertUnits: <Ruler size={13} color={theme.colors.warning} />,
  rememberNote: <Brain size={13} color={theme.colors.secondary} />,
  recallNote: <Brain size={13} color={theme.colors.primary} />,
  recallAllMemory: <BookOpen size={13} color={theme.colors.secondary} />,
  deleteNote: <Trash2 size={13} color={theme.colors.warning} />,
  getConversationHistory: <History size={13} color={theme.colors.textSecondary} />,
  analyzeWithAI: <ScanEye size={13} color={theme.colors.accent} />,
  generateTextAI: <Sparkles size={13} color={theme.colors.secondary} />,
  sortLines: <ArrowUpDown size={13} color={theme.colors.primary} />,
  countStats: <BarChart size={13} color={theme.colors.warning} />,
  convertCase: <CaseSensitive size={13} color={theme.colors.accent} />,
  generateTypeFromJson: <Code2 size={13} color={theme.colors.primary} />,
  generateReadme: <FileQuestion size={13} color={theme.colors.secondary} />,
  compareFiles: <GitBranch size={13} color={theme.colors.warning} />,
  extractImports: <Search size={13} color={theme.colors.accent} />,
  generateGitignore: <GitBranch size={13} color={theme.colors.textSecondary} />,
  wrapCode: <WrapText size={13} color={theme.colors.primary} />,
  minifyJson: <Minimize2 size={13} color={theme.colors.accent} />,
  generateEnvTemplate: <Settings2 size={13} color={theme.colors.warning} />,
};

const TOOL_LABELS: Record<string, string> = {
  createProject: 'Projekt erstellen',
  writeFile: 'Datei schreiben',
  readFile: 'Datei lesen',
  deleteFile: 'Datei löschen',
  renameFile: 'Datei umbenennen',
  createFolder: 'Ordner erstellen',
  listFiles: 'Dateien auflisten',
  grep: 'Suche',
  findReplace: 'Suchen & Ersetzen',
  installPackage: 'Paket installieren',
  uninstallPackage: 'Paket entfernen',
  listProjects: 'Projekte auflisten',
  selectProject: 'Projekt wählen',
  getProjectInfo: 'Projektinfo',
  updateProjectStatus: 'Status ändern',
  previewProject: 'Vorschau',
  analyzeCode: 'Code analysieren',
  duplicateFile: 'Datei duplizieren',
  getAppStructure: 'App-Struktur',
  bulkWriteFiles: 'Dateien schreiben',
  webFetch: 'Web abrufen',
  generateImage: 'Bild generieren',
  scaffoldProject: 'Template erstellen',
  cloneProject: 'Projekt klonen',
  deleteProject: 'Projekt löschen',
  exportFile: 'Datei exportieren',
  getProjectStats: 'Statistiken',
  httpRequest: 'HTTP Request',
  mergeFiles: 'Dateien zusammenführen',
  appendToFile: 'An Datei anhängen',
  insertInFile: 'In Datei einfügen',
  generateComponent: 'Komponente generieren',
  generateScreen: 'Screen generieren',
  generateHook: 'Hook generieren',
  generateApiRoute: 'API Route generieren',
  generateModel: 'Model generieren',
  getEnvironmentInfo: 'Umgebungsinfo',
  validateJson: 'JSON validieren',
  generateUuid: 'UUID generieren',
  convertTimestamp: 'Timestamp konvertieren',
  testRegex: 'Regex testen',
  encodeDecodeText: 'Encode/Decode',
  hashText: 'Text hashen',
  generatePassword: 'Passwort generieren',
  diffTexts: 'Text vergleichen',
  formatCode: 'Code formatieren',
  calculateExpression: 'Berechnen',
  colorConvert: 'Farbe konvertieren',
  loremIpsum: 'Lorem Ipsum',
  generateMockData: 'Mock-Daten',
  convertUnits: 'Einheiten konvertieren',
  rememberNote: 'Erinnerung speichern',
  recallNote: 'Erinnerung abrufen',
  recallAllMemory: 'Alle Erinnerungen',
  deleteNote: 'Erinnerung löschen',
  getConversationHistory: 'Chat-Verlauf',
  analyzeWithAI: 'KI-Analyse',
  generateTextAI: 'KI-Textgenerierung',
  sortLines: 'Zeilen sortieren',
  countStats: 'Textstatistik',
  convertCase: 'Schreibweise konvertieren',
  generateTypeFromJson: 'Types aus JSON',
  generateReadme: 'README generieren',
  compareFiles: 'Dateien vergleichen',
  extractImports: 'Imports extrahieren',
  generateGitignore: '.gitignore generieren',
  wrapCode: 'Code umschließen',
  minifyJson: 'JSON minifizieren',
  generateEnvTemplate: '.env Template',
};

interface ActivityLine {
  text: string;
  type: 'cmd' | 'info' | 'done' | 'err';
}

function getToolActivityLines(toolName: string, input: unknown): ActivityLine[] {
  const p = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  switch (toolName) {
    case 'createProject': return [
      { text: `⚡ mkdir "${p.name || 'project'}"`, type: 'cmd' },
      { text: `→ Typ: ${p.type || '?'}`, type: 'info' },
      { text: '✓ Projekt initialisiert', type: 'done' },
    ];
    case 'writeFile': return [
      { text: `⚡ write ${p.path || '?'}`, type: 'cmd' },
      { text: `→ ${((p.content as string)?.length || 0)} bytes`, type: 'info' },
      { text: '✓ gespeichert', type: 'done' },
    ];
    case 'bulkWriteFiles': {
      const files = (p.files as Array<{ path: string }>) || [];
      return [
        { text: `⚡ batch-write ${files.length} files`, type: 'cmd' },
        ...files.slice(0, 4).map(f => ({ text: `→ ${f.path}`, type: 'info' as const })),
        ...(files.length > 4 ? [{ text: `→ +${files.length - 4} more`, type: 'info' as const }] : []),
        { text: `✓ ${files.length} files written`, type: 'done' },
      ];
    }
    case 'installPackage': {
      const pkgs = (p.packages as string[]) || [];
      return [
        { text: `⚡ bun add ${pkgs.join(' ')}`, type: 'cmd' },
        ...pkgs.map(pk => ({ text: `→ ${pk}@latest`, type: 'info' as const })),
        { text: `✓ installed`, type: 'done' },
      ];
    }
    case 'scaffoldProject': return [
      { text: `⚡ scaffold ${p.template || '?'}`, type: 'cmd' },
      { text: `→ name: ${p.name || '?'}`, type: 'info' },
      { text: '→ generating files...', type: 'info' },
      { text: '✓ scaffold complete', type: 'done' },
    ];
    case 'webFetch': return [
      { text: `⚡ fetch ${p.url || '?'}`, type: 'cmd' },
      { text: '→ sending...', type: 'info' },
      { text: '✓ response received', type: 'done' },
    ];
    case 'httpRequest': return [
      { text: `⚡ ${p.method || 'GET'} ${p.url || '?'}`, type: 'cmd' },
      { text: '✓ done', type: 'done' },
    ];
    case 'grep': return [
      { text: `⚡ grep "${p.pattern || '?'}"`, type: 'cmd' },
      { text: '✓ search complete', type: 'done' },
    ];
    case 'analyzeCode': return [
      { text: '⚡ analyze-code', type: 'cmd' },
      { text: '→ checking types...', type: 'info' },
      { text: '✓ analysis done', type: 'done' },
    ];
    default: return [
      { text: `⚡ ${toolName}`, type: 'cmd' },
      { text: '✓ done', type: 'done' },
    ];
  }
}

function extractProjectName(parts: MessagePart[]): string | null {
  for (const part of parts) {
    if (part.toolName === 'createProject' && part.state === 'output-available' && part.input) {
      const input = part.input as Record<string, unknown>;
      return (input.name as string) || null;
    }
    if (part.toolName === 'updateProjectStatus' && part.state === 'output-available' && part.input) {
      const input = part.input as Record<string, unknown>;
      if (input.status === 'completed') return '__current__';
    }
  }
  return null;
}

function hasCompletedWrites(parts: MessagePart[]): boolean {
  return parts.some(p => p.toolName === 'writeFile' && p.state === 'output-available');
}

const ToolActivityAnimation: React.FC<{ lines: ActivityLine[]; isRunning: boolean }> = React.memo(
  ({ lines, isRunning }) => {
    const [visibleCount, setVisibleCount] = useState(0);

    useEffect(() => {
      if (isRunning && visibleCount < lines.length) {
        const timer = setTimeout(() => {
          setVisibleCount(prev => prev + 1);
        }, 200 + Math.random() * 150);
        return () => clearTimeout(timer);
      }
      if (!isRunning) {
        setVisibleCount(lines.length);
      }
    }, [isRunning, visibleCount, lines.length]);

    if (lines.length === 0) return null;

    return (
      <View style={activityStyles.container}>
        {lines.slice(0, visibleCount).map((line, i) => (
          <ActivityLineItem key={i} line={line} />
        ))}
        {isRunning && visibleCount < lines.length && (
          <View style={activityStyles.cursorRow}>
            <CursorBlink />
          </View>
        )}
      </View>
    );
  }
);

const ActivityLineItem: React.FC<{ line: ActivityLine }> = React.memo(({ line }) => {
  const slideAnim = useRef(new Animated.Value(6)).current;
  const opAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 150, friction: 15, useNativeDriver: true }),
      Animated.timing(opAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
  }, [slideAnim, opAnim]);

  const color = {
    cmd: theme.colors.text,
    info: theme.colors.primary,
    done: theme.colors.success,
    err: theme.colors.error,
  }[line.type];

  return (
    <Animated.View style={{ opacity: opAnim, transform: [{ translateX: slideAnim }] }}>
      <Text style={[activityStyles.lineText, { color }]}>{line.text}</Text>
    </Animated.View>
  );
});

const CursorBlink: React.FC = () => {
  const blinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    ).start();
  }, [blinkAnim]);
  return (
    <Animated.Text style={[activityStyles.cursor, { opacity: blinkAnim }]}>▊</Animated.Text>
  );
};

const activityStyles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.codeBackground,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
  },
  lineText: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
  },
  cursorRow: {
    height: 15,
  },
  cursor: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.colors.primary,
  },
});

export const AgentMessage: React.FC<AgentMessageProps> = React.memo(
  ({ message, isLatest, onPreviewProject, onSaveProject }) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(16)).current;
    const [copied, setCopied] = useState(false);
    const copyScaleAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      if (isLatest) {
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
        ]).start();
      } else {
        fadeAnim.setValue(1);
        slideAnim.setValue(0);
      }
    }, [isLatest, fadeAnim, slideAnim]);

    const isUser = message.role === 'user';
    const projectName = !isUser ? extractProjectName(message.parts) : null;
    const showActions = !isUser && (projectName || hasCompletedWrites(message.parts));

    const getFullText = useCallback((): string => {
      if (!message.parts || !Array.isArray(message.parts)) return '';
      return message.parts
        .filter(p => p.type === 'text' && p.text)
        .map(p => p.text)
        .join('\n');
    }, [message.parts]);

    const copyToClipboard = useCallback(async (text: string) => {
      if (Platform.OS === 'web') {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return true;
        }
      } else {
        try {
          const ExpoClipboard = require('expo-clipboard');
          await ExpoClipboard.setStringAsync(text);
          return true;
        } catch {
          Alert.alert('Text kopiert', text.length > 300 ? text.substring(0, 300) + '...' : text);
          return true;
        }
      }
    }, []);

    const handleCopyMessage = useCallback(async () => {
      try {
        const text = getFullText();
        if (!text) return;
        await copyToClipboard(text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCopied(true);
        Animated.sequence([
          Animated.timing(copyScaleAnim, { toValue: 1.3, duration: 100, useNativeDriver: true }),
          Animated.spring(copyScaleAnim, { toValue: 1, tension: 200, friction: 10, useNativeDriver: true }),
        ]).start();
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error('[AgentMessage] Copy error:', e);
      }
    }, [getFullText, copyScaleAnim, copyToClipboard]);

    const handleCopyCodeBlock = useCallback(async (code: string) => {
      try {
        await copyToClipboard(code);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        console.error('[AgentMessage] Copy code error:', e);
      }
    }, [copyToClipboard]);

    const renderTextContent = (text: string, key: string) => {
      const parts = text.split(/```(\w+)?\n([\s\S]*?)```/g);
      const elements: React.ReactNode[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) {
          if (parts[i]) {
            const boldParts = parts[i].split(/\*\*(.*?)\*\*/g);
            elements.push(
              <Text key={`${key}-t-${i}`} style={styles.messageText}>
                {boldParts.map((part, j) =>
                  j % 2 === 1 ? (
                    <Text key={`${key}-b-${j}`} style={styles.boldText}>{part}</Text>
                  ) : part
                )}
              </Text>
            );
          }
        } else if (i % 3 === 2) {
          const codeContent = parts[i];
          elements.push(
            <View key={`${key}-c-${i}`} style={styles.codeBlock}>
              <TouchableOpacity
                style={styles.codeBlockCopyBtn}
                onPress={() => handleCopyCodeBlock(codeContent)}
                activeOpacity={0.6}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <ClipboardCopy size={11} color={theme.colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.codeText} selectable>{codeContent}</Text>
            </View>
          );
        }
      }
      return elements;
    };

    const renderToolPart = (part: MessagePart, key: string) => {
      const toolName = part.toolName || 'unknown';
      const label = TOOL_LABELS[toolName] || toolName;
      const icon = TOOL_ICONS[toolName] || <Terminal size={13} color={theme.colors.primary} />;
      const isRunning = part.state === 'input-streaming' || part.state === 'input-available';
      const isDone = part.state === 'output-available';
      const isError = part.state === 'output-error';

      let statusColor = theme.colors.textTertiary;
      if (isDone) statusColor = theme.colors.success;
      else if (isError) statusColor = theme.colors.error;
      else if (isRunning) statusColor = theme.colors.warning;

      const inputSummary = part.input != null ? getToolInputSummary(toolName, part.input) : null;
      const outputText = isDone && part.output
        ? typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
        : null;

      const activityLines = getToolActivityLines(toolName, part.input);

      return (
        <View key={key} style={[styles.toolCard, isError && styles.toolCardError, isDone && styles.toolCardDone]}>
          <View style={styles.toolHeader}>
            {icon}
            <Text style={[styles.toolLabel, { color: statusColor }]}>{label}</Text>
            <View style={styles.toolStatusWrap}>
              {isDone && <CheckCircle size={12} color={theme.colors.success} />}
              {isError && <AlertCircle size={12} color={theme.colors.error} />}
              {isRunning && <RunningIndicator />}
            </View>
          </View>
          {inputSummary && <Text style={styles.toolInput} numberOfLines={2}>{inputSummary}</Text>}

          {(isRunning || isDone) && (
            <ToolActivityAnimation lines={activityLines} isRunning={isRunning} />
          )}

          {outputText && !isRunning && (
            <Text style={styles.toolOutput} numberOfLines={4}>{outputText}</Text>
          )}
          {isError && part.errorText && <Text style={styles.toolError} numberOfLines={2}>{part.errorText}</Text>}
        </View>
      );
    };

    const renderParts = () => {
      if (!message.parts || !Array.isArray(message.parts)) return null;
      return message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        switch (part.type) {
          case 'text':
            return part.text ? <View key={key}>{renderTextContent(part.text, key)}</View> : null;
          case 'tool':
            return renderToolPart(part, key);
          default:
            return null;
        }
      });
    };

    return (
      <Animated.View
        style={[
          styles.container,
          isUser ? styles.userContainer : styles.assistantContainer,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={[styles.avatar, isUser ? styles.userAvatar : styles.assistantAvatar]}>
          {isUser ? (
            <User size={16} color={theme.colors.text} />
          ) : (
            <Bot size={16} color="#fff" />
          )}
        </View>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          {renderParts()}
          <View style={styles.messageCopyRow}>
            <TouchableOpacity
              style={styles.copyMessageBtn}
              onPress={handleCopyMessage}
              activeOpacity={0.6}
              testID="copy-message-button"
            >
              <Animated.View style={{ transform: [{ scale: copyScaleAnim }] }}>
                {copied ? (
                  <Check size={13} color={theme.colors.success} />
                ) : (
                  <ClipboardCopy size={13} color={theme.colors.textTertiary} />
                )}
              </Animated.View>
              <Text style={[styles.copyText, copied && { color: theme.colors.success }]}>
                {copied ? 'Kopiert' : 'Kopieren'}
              </Text>
            </TouchableOpacity>
          </View>
          {showActions && (
            <View style={styles.actionBar}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onPreviewProject?.(projectName || '__current__')}
                testID="preview-button"
              >
                <Play size={12} color={theme.colors.primary} />
                <Text style={styles.actionText}>Vorschau</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonAccent]}
                onPress={() => onSaveProject?.(projectName || '__current__')}
                testID="save-button"
              >
                <Download size={12} color={theme.colors.accent} />
                <Text style={[styles.actionText, { color: theme.colors.accent }]}>Speichern</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Animated.View>
    );
  }
);

const RunningIndicator: React.FC = () => {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  return (
    <Animated.View style={{ opacity: pulseAnim }}>
      <Loader size={12} color={theme.colors.warning} />
    </Animated.View>
  );
};

function getToolInputSummary(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const p = input as Record<string, unknown>;
  switch (toolName) {
    case 'createProject': return `${p.name} (${p.type})`;
    case 'writeFile': return `${p.path}`;
    case 'readFile': return `${p.path}`;
    case 'deleteFile': return `${p.path}`;
    case 'renameFile': return `${p.oldPath} → ${p.newPath}`;
    case 'grep': return `"${p.pattern}"${p.path ? ` in ${p.path}` : ''}`;
    case 'findReplace': return `"${p.find}" → "${p.replace}"`;
    case 'installPackage': return Array.isArray(p.packages) ? p.packages.join(', ') : String(p.packages);
    case 'uninstallPackage': return Array.isArray(p.packages) ? p.packages.join(', ') : String(p.packages);
    case 'selectProject': return `ID: ${p.projectId}`;
    case 'createFolder': return `${p.path}`;
    case 'duplicateFile': return `${p.sourcePath} → ${p.targetPath}`;
    case 'bulkWriteFiles': return Array.isArray(p.files) ? `${p.files.length} Dateien` : null;
    case 'webFetch': return `${p.url}`;
    case 'httpRequest': return `${p.method || 'GET'} ${p.url}`;
    case 'scaffoldProject': return `${p.template} → ${p.name}`;
    case 'cloneProject': return `${p.newName}`;
    case 'deleteProject': return `ID: ${p.projectId}`;
    case 'exportFile': return `${p.path}`;
    default: return null;
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 6,
    paddingHorizontal: 14,
    maxWidth: '100%',
  },
  userContainer: {
    flexDirection: 'row-reverse',
  },
  assistantContainer: {
    flexDirection: 'row',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatar: {
    backgroundColor: theme.colors.surfaceLight,
    marginLeft: 8,
  },
  assistantAvatar: {
    backgroundColor: theme.colors.primary,
    marginRight: 8,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    padding: 14,
  },
  userBubble: {
    backgroundColor: theme.colors.surface,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  messageText: {
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 21,
  } as const,
  boldText: {
    fontWeight: '700' as const,
    color: theme.colors.primary,
  },
  codeBlock: {
    backgroundColor: theme.colors.codeBackground,
    borderRadius: 10,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: theme.colors.codeText,
    lineHeight: 18,
  },
  codeBlockCopyBtn: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    zIndex: 2,
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: theme.colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  toolCard: {
    backgroundColor: theme.colors.backgroundTertiary,
    borderRadius: 10,
    padding: 10,
    marginVertical: 3,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
  },
  toolCardError: {
    borderLeftColor: theme.colors.error,
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
  },
  toolCardDone: {
    borderLeftColor: theme.colors.success,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    flex: 1,
  },
  toolStatusWrap: {
    width: 16,
    alignItems: 'center',
  },
  toolInput: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  toolOutput: {
    color: theme.colors.accent,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  toolError: {
    color: theme.colors.error,
    fontSize: 11,
    marginTop: 4,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: theme.colors.primaryMuted,
    borderWidth: 1,
    borderColor: theme.colors.primary + '30',
  },
  actionButtonAccent: {
    backgroundColor: theme.colors.accentGlow,
    borderColor: theme.colors.accent + '30',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.primary,
  },
  messageCopyRow: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    marginTop: 6,
  },
  copyMessageBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  copyText: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    fontWeight: '500' as const,
  },
});
