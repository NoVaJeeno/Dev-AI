import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { theme } from '@/constants/theme';

interface AIActivityBarProps {
  isActive: boolean;
  toolName: string | null;
  agentLabel?: string;
  toolCallCount?: number;
  taskStartTime?: number;
}

const TOOL_DISPLAY: Record<string, string> = {
  createProject: 'Projekt erstellen',
  writeFile: 'Datei schreiben',
  readFile: 'Datei lesen',
  deleteFile: 'Datei löschen',
  bulkWriteFiles: 'Dateien schreiben',
  installPackage: 'Pakete installieren',
  scaffoldProject: 'Template generieren',
  webFetch: 'Web-Anfrage',
  httpRequest: 'HTTP Request',
  grep: 'Code durchsuchen',
  findReplace: 'Suchen & Ersetzen',
  analyzeCode: 'Code analysieren',
  analyzeWithAI: 'KI-Analyse',
  generateTextAI: 'Text generieren',
  rememberNote: 'Erinnerung speichern',
  recallNote: 'Erinnerung abrufen',
  recallAllMemory: 'Memory laden',
  getConversationHistory: 'Verlauf laden',
  saveWorkingMemory: 'Kontext speichern',
  getWorkingMemory: 'Kontext laden',
  listFiles: 'Dateien auflisten',
  listProjects: 'Projekte laden',
  selectProject: 'Projekt wählen',
  getProjectInfo: 'Projektinfo laden',
  generateComponent: 'Komponente generieren',
  generateScreen: 'Screen generieren',
  generateHook: 'Hook generieren',
  cloneProject: 'Projekt klonen',
  renameFile: 'Datei umbenennen',
  appendToFile: 'Datei erweitern',
  insertInFile: 'Code einfügen',
  getAppStructure: 'App-Struktur laden',
  scanErrors: 'Fehler scannen',
  triggerScan: 'Scan starten',
  triggerEnvScan: 'Umgebung scannen',
  saveMemory: 'Memory speichern',
  recallMemory: 'Memory abrufen',
  savePermanentReminder: 'Erinnerung sichern',
  getPermanentReminders: 'Erinnerungen laden',
  saveCrossSessionMemory: 'Session-Memory',
  getCrossSessionMemory: 'Session laden',
  getErrorLogs: 'Logs laden',
  getErrorPatterns: 'Patterns laden',
  createRepairTask: 'Reparatur erstellen',
  getAppHealth: 'Health-Check',
  analyzeAndFix: 'Auto-Fix',
  checkStorageHealth: 'Speicher prüfen',
};

const TOOL_WEIGHT: Record<string, number> = {
  createProject: 8,
  writeFile: 3,
  bulkWriteFiles: 10,
  readFile: 2,
  deleteFile: 2,
  installPackage: 6,
  scaffoldProject: 12,
  webFetch: 5,
  httpRequest: 5,
  grep: 3,
  findReplace: 4,
  analyzeCode: 6,
  analyzeWithAI: 8,
  generateTextAI: 7,
  rememberNote: 1,
  recallNote: 1,
  recallAllMemory: 2,
  saveWorkingMemory: 1,
  getWorkingMemory: 1,
  listFiles: 2,
  listProjects: 2,
  generateComponent: 5,
  generateScreen: 5,
  generateHook: 4,
  cloneProject: 8,
  scanErrors: 4,
  triggerScan: 3,
  triggerEnvScan: 4,
  getAppHealth: 3,
  analyzeAndFix: 6,
};

function estimateProgress(toolCallCount: number, taskStartTime: number, currentTool: string | null): number {
  if (toolCallCount <= 0) return 2;
  const elapsed = (Date.now() - taskStartTime) / 1000;
  const toolWeight = currentTool ? (TOOL_WEIGHT[currentTool] || 3) : 3;
  const weightedCalls = toolCallCount * toolWeight;
  const timeProgress = Math.min(elapsed / 60, 0.4) * 100;
  const callProgress = Math.min(weightedCalls / 80, 0.55) * 100;
  const combined = Math.min(timeProgress + callProgress, 95);
  return Math.max(2, Math.round(combined));
}

export const AIActivityBar: React.FC<AIActivityBarProps> = React.memo(({ isActive, toolName, agentLabel, toolCallCount = 0, taskStartTime = 0 }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [displayPercent, setDisplayPercent] = useState(0);
  const completedToolsRef = useRef(0);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    if (isActive && taskStartTime > 0) {
      startTimeRef.current = taskStartTime;
    } else if (isActive && startTimeRef.current === 0) {
      startTimeRef.current = Date.now();
    }
  }, [isActive, taskStartTime]);

  useEffect(() => {
    if (isActive) {
      completedToolsRef.current = toolCallCount;
    }
  }, [toolCallCount, isActive]);

  const updateProgress = useCallback(() => {
    if (!isActive) return;
    const pct = estimateProgress(completedToolsRef.current, startTimeRef.current, toolName);
    setDisplayPercent(pct);
    Animated.timing(progressAnim, {
      toValue: pct / 100,
      duration: 400,
      useNativeDriver: false,
      easing: Easing.out(Easing.ease),
    }).start();
  }, [isActive, toolName, progressAnim]);

  useEffect(() => {
    if (isActive) {
      updateProgress();
      const interval = setInterval(updateProgress, 1500);
      return () => clearInterval(interval);
    } else {
      setDisplayPercent(0);
      progressAnim.setValue(0);
      completedToolsRef.current = 0;
      startTimeRef.current = 0;
    }
  }, [isActive, updateProgress, progressAnim]);

  useEffect(() => {
    if (isActive) {
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      shimmerAnim.stopAnimation();
      shimmerAnim.setValue(0);
      pulseAnim.stopAnimation();
    }
  }, [isActive, shimmerAnim, opacityAnim, pulseAnim]);

  if (!isActive) return null;

  const displayName = toolName ? (TOOL_DISPLAY[toolName] || toolName) : 'Verarbeite...';

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const elapsed = startTimeRef.current > 0 ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <Animated.View style={[styles.container, { opacity: opacityAnim }]}>
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            { width: progressWidth as unknown as number },
          ]}
        />
      </View>
      <View style={styles.labelRow}>
        <Animated.View style={[styles.dot, { opacity: pulseAnim }]} />
        <Text style={styles.label} numberOfLines={1}>
          {agentLabel ? `${agentLabel} → ` : ''}{displayName}
        </Text>
        <View style={styles.statsRow}>
          <Text style={styles.percentText}>{displayPercent}%</Text>
          {elapsed > 0 && <Text style={styles.timeText}>{elapsedStr}</Text>}
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingBottom: 4,
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.colors.backgroundTertiary,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: theme.colors.primary,
  },
  labelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.primary,
  },
  label: {
    flex: 1,
    fontSize: 10,
    fontFamily: 'monospace',
    color: theme.colors.textSecondary,
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  percentText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700' as const,
    color: theme.colors.primary,
    minWidth: 30,
    textAlign: 'right' as const,
  },
  timeText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: theme.colors.textTertiary,
  },
});
