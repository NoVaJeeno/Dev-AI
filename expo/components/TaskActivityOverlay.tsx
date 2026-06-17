import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '@/constants/theme';

interface TaskLine {
  text: string;
  type: 'info' | 'success' | 'warning' | 'command' | 'output' | 'access';
}

interface TaskActivityOverlayProps {
  toolName: string;
  toolInput: Record<string, unknown> | null;
  isActive: boolean;
}

const TOOL_ACTIVITY_MAP: Record<string, (input: Record<string, unknown> | null) => TaskLine[]> = {
  createProject: (input) => [
    { text: `⚡ Initialisiere Projekt "${input?.name || 'new'}"...`, type: 'command' },
    { text: `→ Typ: ${input?.type || 'unknown'}`, type: 'info' },
    { text: '→ Erstelle Projektstruktur...', type: 'info' },
    { text: '→ Konfiguriere Workspace...', type: 'info' },
    { text: '🔐 Schreibrechte: Vollzugriff', type: 'access' },
    { text: '✓ Projekt erstellt', type: 'success' },
  ],
  writeFile: (input) => [
    { text: `⚡ Schreibe ${input?.path || 'datei'}...`, type: 'command' },
    { text: `→ ${((input?.content as string)?.length || 0)} Bytes`, type: 'info' },
    { text: '🔐 Dateisystem: Schreibzugriff', type: 'access' },
    { text: '✓ Datei gespeichert', type: 'success' },
  ],
  bulkWriteFiles: (input) => {
    const files = (input?.files as Array<{ path: string }>) || [];
    const lines: TaskLine[] = [
      { text: `⚡ Batch-Write: ${files.length} Dateien...`, type: 'command' },
    ];
    files.slice(0, 4).forEach(f => {
      lines.push({ text: `→ ${f.path}`, type: 'info' });
    });
    if (files.length > 4) lines.push({ text: `→ ...und ${files.length - 4} weitere`, type: 'info' });
    lines.push({ text: '🔐 Batch-Schreibrechte aktiv', type: 'access' });
    lines.push({ text: `✓ ${files.length} Dateien geschrieben`, type: 'success' });
    return lines;
  },
  readFile: (input) => [
    { text: `⚡ Lese ${input?.path || 'datei'}...`, type: 'command' },
    { text: '🔐 Lesezugriff: Projekt', type: 'access' },
    { text: '✓ Datei geladen', type: 'success' },
  ],
  deleteFile: (input) => [
    { text: `⚡ Lösche ${input?.path || 'datei'}...`, type: 'command' },
    { text: '⚠ Löschvorgang wird ausgeführt', type: 'warning' },
    { text: '✓ Datei entfernt', type: 'success' },
  ],
  installPackage: (input) => {
    const pkgs = (input?.packages as string[]) || [];
    return [
      { text: `⚡ bun add ${pkgs.join(' ')}`, type: 'command' },
      ...pkgs.map(p => ({ text: `→ Installiere ${p}...`, type: 'info' as const })),
      { text: '🔐 Package Registry: Zugriff', type: 'access' },
      { text: `✓ ${pkgs.length} Pakete installiert`, type: 'success' },
    ];
  },
  scaffoldProject: (input) => [
    { text: `⚡ Scaffold: ${input?.template || 'template'}`, type: 'command' },
    { text: `→ Projekt: ${input?.name || 'new'}`, type: 'info' },
    { text: '→ Generiere Template-Dateien...', type: 'info' },
    { text: '→ Konfiguriere Dependencies...', type: 'info' },
    { text: '🔐 Template Engine: Vollzugriff', type: 'access' },
    { text: '✓ Projekt aus Template erstellt', type: 'success' },
  ],
  webFetch: (input) => [
    { text: `⚡ fetch ${input?.url || '...'}`, type: 'command' },
    { text: '→ Sende Request...', type: 'info' },
    { text: '🔐 Netzwerk: HTTP-Zugriff', type: 'access' },
    { text: '→ Empfange Daten...', type: 'info' },
    { text: '✓ Response empfangen', type: 'success' },
  ],
  httpRequest: (input) => [
    { text: `⚡ ${input?.method || 'GET'} ${input?.url || '...'}`, type: 'command' },
    { text: '→ Sende Request...', type: 'info' },
    { text: '🔐 API: HTTP-Zugriff', type: 'access' },
    { text: '✓ Response empfangen', type: 'success' },
  ],
  grep: (input) => [
    { text: `⚡ grep "${input?.pattern || '...'}"`, type: 'command' },
    { text: '→ Durchsuche Dateien...', type: 'info' },
    { text: '✓ Suche abgeschlossen', type: 'success' },
  ],
  analyzeCode: () => [
    { text: '⚡ Code-Analyse starten...', type: 'command' },
    { text: '→ Prüfe Typen...', type: 'info' },
    { text: '→ Prüfe TODOs/FIXMEs...', type: 'info' },
    { text: '🔐 Analyse-Engine: Vollzugriff', type: 'access' },
    { text: '✓ Analyse abgeschlossen', type: 'success' },
  ],
  findReplace: (input) => [
    { text: `⚡ Suche: "${input?.find || '...'}"`, type: 'command' },
    { text: `→ Ersetze mit: "${input?.replace || '...'}"`, type: 'info' },
    { text: '🔐 Schreibrechte: Multi-Datei', type: 'access' },
    { text: '✓ Ersetzung durchgeführt', type: 'success' },
  ],
  rememberNote: (input) => [
    { text: `⚡ Memory: Speichere "${input?.key || '...'}"`, type: 'command' },
    { text: '🔐 Memory-System: Schreibzugriff', type: 'access' },
    { text: '✓ Erinnerung gespeichert', type: 'success' },
  ],
  recallNote: (input) => [
    { text: `⚡ Memory: Abrufe "${input?.key || '...'}"`, type: 'command' },
    { text: '🔐 Memory-System: Lesezugriff', type: 'access' },
    { text: '✓ Erinnerung geladen', type: 'success' },
  ],
  recallAllMemory: () => [
    { text: '⚡ Memory: Lade alle Erinnerungen...', type: 'command' },
    { text: '🔐 Memory-System: Vollzugriff', type: 'access' },
    { text: '✓ Alle Erinnerungen geladen', type: 'success' },
  ],
  analyzeWithAI: (input) => [
    { text: '⚡ KI-Analyse gestartet...', type: 'command' },
    { text: `→ Prompt: "${(input?.prompt as string)?.substring(0, 40) || '...'}"`, type: 'info' },
    { text: '🔐 AI Engine: Vollzugriff', type: 'access' },
    { text: '→ Verarbeite mit LLM...', type: 'info' },
    { text: '✓ Analyse abgeschlossen', type: 'success' },
  ],
  generateTextAI: (input) => [
    { text: '⚡ KI-Textgenerierung...', type: 'command' },
    { text: `→ "${(input?.prompt as string)?.substring(0, 40) || '...'}"`, type: 'info' },
    { text: '🔐 AI Engine: Generierung', type: 'access' },
    { text: '✓ Text generiert', type: 'success' },
  ],
  generateComponent: (input) => [
    { text: `⚡ Generiere Komponente: ${input?.name || '...'}`, type: 'command' },
    { text: '→ Erstelle TypeScript Interface...', type: 'info' },
    { text: '→ Generiere JSX...', type: 'info' },
    { text: '🔐 Code-Generator: Vollzugriff', type: 'access' },
    { text: '✓ Komponente erstellt', type: 'success' },
  ],
  generateScreen: (input) => [
    { text: `⚡ Generiere Screen: ${input?.name || '...'}`, type: 'command' },
    { text: '→ Erstelle Navigation...', type: 'info' },
    { text: '🔐 Code-Generator: Vollzugriff', type: 'access' },
    { text: '✓ Screen erstellt', type: 'success' },
  ],
  generateHook: (input) => [
    { text: `⚡ Generiere Hook: use${input?.name || '...'}`, type: 'command' },
    { text: '🔐 Code-Generator: Hook-Engine', type: 'access' },
    { text: '✓ Hook erstellt', type: 'success' },
  ],
  generateApiRoute: (input) => [
    { text: `⚡ Generiere API Route: ${input?.name || '...'}`, type: 'command' },
    { text: `→ Methoden: ${(input?.methods as string[])?.join(', ') || 'GET'}`, type: 'info' },
    { text: '🔐 API-Generator: Vollzugriff', type: 'access' },
    { text: '✓ API Route erstellt', type: 'success' },
  ],
  generateModel: (input) => [
    { text: `⚡ Generiere Model: ${input?.name || '...'}`, type: 'command' },
    { text: '→ Erstelle Interface + CRUD Types...', type: 'info' },
    { text: '✓ Model erstellt', type: 'success' },
  ],
  cloneProject: (input) => [
    { text: `⚡ Klone Projekt...`, type: 'command' },
    { text: `→ Ziel: ${input?.newName || '...'}`, type: 'info' },
    { text: '→ Kopiere Dateien...', type: 'info' },
    { text: '🔐 Projekt-Engine: Vollzugriff', type: 'access' },
    { text: '✓ Projekt geklont', type: 'success' },
  ],
  renameFile: (input) => [
    { text: `⚡ Umbenennen: ${input?.oldPath || '...'}`, type: 'command' },
    { text: `→ Neu: ${input?.newPath || '...'}`, type: 'info' },
    { text: '✓ Datei umbenannt', type: 'success' },
  ],
  duplicateFile: (input) => [
    { text: `⚡ Dupliziere: ${input?.sourcePath || '...'}`, type: 'command' },
    { text: '✓ Datei dupliziert', type: 'success' },
  ],
  listFiles: () => [
    { text: '⚡ Liste Dateien auf...', type: 'command' },
    { text: '✓ Dateiliste geladen', type: 'success' },
  ],
  listProjects: () => [
    { text: '⚡ Liste Projekte auf...', type: 'command' },
    { text: '✓ Projektliste geladen', type: 'success' },
  ],
  getProjectInfo: () => [
    { text: '⚡ Lade Projektinfos...', type: 'command' },
    { text: '✓ Projektinfos geladen', type: 'success' },
  ],
  getAppStructure: () => [
    { text: '⚡ Lade App-Struktur...', type: 'command' },
    { text: '🔐 System: Strukturzugriff', type: 'access' },
    { text: '✓ Struktur geladen', type: 'success' },
  ],
  getEnvironmentInfo: () => [
    { text: '⚡ Lade Umgebungsinfos...', type: 'command' },
    { text: '🔐 System: Environment-Zugriff', type: 'access' },
    { text: '✓ Umgebungsinfos geladen', type: 'success' },
  ],
  validateJson: () => [
    { text: '⚡ Validiere JSON...', type: 'command' },
    { text: '✓ Validierung abgeschlossen', type: 'success' },
  ],
  generateMockData: (input) => [
    { text: `⚡ Generiere Mock-Daten: ${input?.type || '...'}`, type: 'command' },
    { text: `→ Anzahl: ${input?.count || 5}`, type: 'info' },
    { text: '✓ Mock-Daten generiert', type: 'success' },
  ],
  mergeFiles: (input) => [
    { text: `⚡ Zusammenführen → ${input?.targetPath || '...'}`, type: 'command' },
    { text: '→ Lese Quelldateien...', type: 'info' },
    { text: '🔐 Dateisystem: Multi-Zugriff', type: 'access' },
    { text: '✓ Dateien zusammengeführt', type: 'success' },
  ],
  appendToFile: (input) => [
    { text: `⚡ Anfügen an ${input?.path || '...'}`, type: 'command' },
    { text: '✓ Inhalt angehängt', type: 'success' },
  ],
  insertInFile: (input) => [
    { text: `⚡ Einfügen in ${input?.path || '...'} Zeile ${input?.line || '?'}`, type: 'command' },
    { text: '✓ Inhalt eingefügt', type: 'success' },
  ],
  getProjectStats: () => [
    { text: '⚡ Berechne Statistiken...', type: 'command' },
    { text: '✓ Statistiken berechnet', type: 'success' },
  ],
  generateReadme: () => [
    { text: '⚡ Generiere README.md...', type: 'command' },
    { text: '→ Analysiere Projektstruktur...', type: 'info' },
    { text: '✓ README generiert', type: 'success' },
  ],
  extractImports: () => [
    { text: '⚡ Extrahiere Imports...', type: 'command' },
    { text: '→ Scanne Dateien...', type: 'info' },
    { text: '✓ Imports extrahiert', type: 'success' },
  ],
};

function getDefaultLines(toolName: string): TaskLine[] {
  return [
    { text: `⚡ ${toolName}...`, type: 'command' },
    { text: '→ Ausführen...', type: 'info' },
    { text: '✓ Fertig', type: 'success' },
  ];
}

export const TaskActivityOverlay: React.FC<TaskActivityOverlayProps> = React.memo(
  ({ toolName, toolInput, isActive }) => {
    const [visibleLines, setVisibleLines] = useState<TaskLine[]>([]);
    const [lineIndex, setLineIndex] = useState(0);
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;
    const glowAnim = useRef(new Animated.Value(0)).current;

    const allLines = (TOOL_ACTIVITY_MAP[toolName]?.(toolInput) || getDefaultLines(toolName));

    useEffect(() => {
      if (isActive) {
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        Animated.timing(progressAnim, { toValue: 1, duration: allLines.length * 350, useNativeDriver: false }).start();
        Animated.loop(
          Animated.sequence([
            Animated.timing(glowAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
            Animated.timing(glowAnim, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          ])
        ).start();
      } else {
        glowAnim.stopAnimation();
      }
    }, [isActive, fadeAnim, progressAnim, glowAnim, allLines.length]);

    useEffect(() => {
      if (!isActive) {
        setVisibleLines(allLines);
        setLineIndex(allLines.length);
        return;
      }

      if (lineIndex < allLines.length) {
        const timer = setTimeout(() => {
          setVisibleLines(prev => [...prev, allLines[lineIndex]]);
          setLineIndex(prev => prev + 1);
        }, 200 + Math.random() * 180);
        return () => clearTimeout(timer);
      }
    }, [isActive, lineIndex, allLines]);

    if (visibleLines.length === 0 && !isActive) return null;

    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    const glowBorderColor = glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [theme.colors.border, theme.colors.primary + '60'],
    });

    const glowShadowOpacity = glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.3],
    });

    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim, borderColor: isActive ? glowBorderColor : theme.colors.border }]}>
        {isActive && (
          <View style={styles.headerRow}>
            <Animated.View style={[styles.activeDot, { opacity: glowShadowOpacity }]} />
            <View style={styles.activeDotInner} />
            <Text style={styles.headerLabel}>{toolName}</Text>
          </View>
        )}
        {isActive && (
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth as unknown as number }]} />
          </View>
        )}
        {visibleLines.map((line, i) => (
          <LineItem key={i} line={line} index={i} isLast={i === visibleLines.length - 1 && isActive} />
        ))}
      </Animated.View>
    );
  }
);

const LineItem: React.FC<{ line: TaskLine; index: number; isLast: boolean }> = React.memo(
  ({ line, isLast }) => {
    const slideAnim = useRef(new Animated.Value(10)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 140, friction: 14, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }, [slideAnim, opacityAnim]);

    const textColor = {
      info: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      command: theme.colors.text,
      output: theme.colors.codeText,
      access: '#f59e0b',
    }[line.type];

    return (
      <Animated.View style={[styles.lineRow, { opacity: opacityAnim, transform: [{ translateX: slideAnim }] }]}>
        {isLast && line.type !== 'success' && <View style={styles.cursorDot} />}
        <Text style={[styles.lineText, { color: textColor }, line.type === 'access' && styles.accessText]}>{line.text}</Text>
      </Animated.View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.codeBackground,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  activeDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.accent,
  },
  activeDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
    marginLeft: 3,
  },
  headerLabel: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: theme.colors.textTertiary,
    marginLeft: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.backgroundTertiary,
    marginBottom: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
    borderRadius: 1,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 1,
    gap: 4,
  },
  cursorDot: {
    width: 4,
    height: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 1,
  },
  lineText: {
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 16,
  },
  accessText: {
    fontWeight: '600' as const,
  },
});
