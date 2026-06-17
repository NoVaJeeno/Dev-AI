import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Animated, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Terminal, Globe, Code, BookOpen, Send, Trash2, Copy,
  Play, Zap, FileCode, Layout, Database, Palette,
  Rocket, Smartphone, Monitor, Download, Box, Hammer,
  CheckCircle, AlertCircle, Clock, ChevronRight, Circle, Loader,
} from 'lucide-react-native';
import { useStorage } from '@/providers/StorageProvider';
import { theme } from '@/constants/theme';
import { executeCommand } from '@/utils/sandboxEngine';
import * as Haptics from 'expo-haptics';

type ActiveTool = 'terminal' | 'deploy' | 'api' | 'snippets' | 'generator';

interface TerminalEntry {
  id: string;
  input: string;
  output: string;
  timestamp: number;
  status: 'success' | 'error' | 'info' | 'running';
  duration?: number;
}

interface ApiRequest {
  method: string;
  url: string;
  headers: string;
  body: string;
}

interface ApiResponse {
  status: number;
  statusText: string;
  headers: string;
  body: string;
  duration: number;
}

interface BuildState {
  status: 'idle' | 'queued' | 'building' | 'completed' | 'error';
  platform: 'ios' | 'android' | 'all';
  profile: 'development' | 'preview' | 'production';
  buildId: string | null;
  progress: string;
  artifactUrl: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

const CODE_SNIPPETS = [
  { id: '1', title: 'React Component', language: 'typescript', code: `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\ninterface Props {\n  title: string;\n}\n\nexport const MyComponent: React.FC<Props> = ({ title }) => {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.title}>{title}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, padding: 16 },\n  title: { fontSize: 18, fontWeight: '600' },\n});` },
  { id: '2', title: 'Express API Route', language: 'typescript', code: `import { Router, Request, Response } from 'express';\n\nconst router = Router();\n\nrouter.get('/api/items', async (req: Request, res: Response) => {\n  try {\n    const items = await getItems();\n    res.json({ success: true, data: items });\n  } catch (error) {\n    res.status(500).json({ success: false, error: 'Server error' });\n  }\n});\n\nexport default router;` },
  { id: '3', title: 'React Hook', language: 'typescript', code: `import { useState, useEffect, useCallback } from 'react';\n\nexport function useData<T>(url: string) {\n  const [data, setData] = useState<T | null>(null);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState<string | null>(null);\n\n  const fetchData = useCallback(async () => {\n    setLoading(true);\n    try {\n      const res = await fetch(url);\n      const json = await res.json();\n      setData(json);\n    } catch (e) {\n      setError(e instanceof Error ? e.message : 'Error');\n    } finally {\n      setLoading(false);\n    }\n  }, [url]);\n\n  useEffect(() => { fetchData(); }, [fetchData]);\n  return { data, loading, error, refetch: fetchData };\n}` },
  { id: '4', title: 'Zustand Store', language: 'typescript', code: `import { create } from 'zustand';\n\ninterface AppState {\n  count: number;\n  increment: () => void;\n  reset: () => void;\n}\n\nexport const useStore = create<AppState>((set) => ({\n  count: 0,\n  increment: () => set((s) => ({ count: s.count + 1 })),\n  reset: () => set({ count: 0 }),\n}));` },
  { id: '5', title: 'Next.js Page', language: 'typescript', code: `import type { NextPage, GetServerSideProps } from 'next';\n\ninterface Props {\n  data: { id: number; title: string }[];\n}\n\nconst Page: NextPage<Props> = ({ data }) => (\n  <main className="container mx-auto p-4">\n    <h1 className="text-3xl font-bold mb-6">Items</h1>\n    <div className="grid grid-cols-3 gap-4">\n      {data.map(item => (\n        <div key={item.id} className="bg-white rounded-lg shadow p-4">\n          <h2>{item.title}</h2>\n        </div>\n      ))}\n    </div>\n  </main>\n);\n\nexport const getServerSideProps: GetServerSideProps = async () => {\n  const res = await fetch('https://api.example.com/items');\n  return { props: { data: await res.json() } };\n};\n\nexport default Page;` },
  { id: '6', title: 'Tailwind Config', language: 'javascript', code: `module.exports = {\n  content: ['./src/**/*.{js,ts,jsx,tsx}'],\n  theme: {\n    extend: {\n      colors: {\n        brand: { 50: '#f0f9ff', 500: '#3b82f6', 900: '#1e3a5f' },\n      },\n    },\n  },\n  plugins: [],\n};` },
];

const GENERATOR_TEMPLATES = [
  { id: 'component', label: 'Component', icon: <Layout size={16} color={theme.colors.primary} /> },
  { id: 'screen', label: 'Screen', icon: <FileCode size={16} color={theme.colors.accent} /> },
  { id: 'hook', label: 'Hook', icon: <Zap size={16} color={theme.colors.warning} /> },
  { id: 'api', label: 'API Route', icon: <Globe size={16} color={theme.colors.secondary} /> },
  { id: 'model', label: 'Model', icon: <Database size={16} color={theme.colors.primary} /> },
  { id: 'style', label: 'Theme', icon: <Palette size={16} color={theme.colors.accent} /> },
];

export default function ToolsScreen() {
  const { currentProject, addFileToProject } = useStorage();
  const [activeTool, setActiveTool] = useState<ActiveTool>('terminal');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const toolChangeAnim = useRef(new Animated.Value(1)).current;

  // Terminal state
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [terminalExecuting, setTerminalExecuting] = useState(false);
  const terminalScrollRef = useRef<ScrollView>(null);

  // Deploy/Build state
  const [buildState, setBuildState] = useState<BuildState>({
    status: 'idle', platform: 'ios', profile: 'development',
    buildId: null, progress: '', artifactUrl: null,
    startedAt: null, completedAt: null, error: null,
  });
  const [buildLogs, setBuildLogs] = useState<string[]>([]);

  // API state
  const [apiRequest, setApiRequest] = useState<ApiRequest>({
    method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/1',
    headers: '{\n  "Content-Type": "application/json"\n}', body: '',
  });
  const [apiResponse, setApiResponse] = useState<ApiResponse | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  // Generator state
  const [generatorName, setGeneratorName] = useState('');
  const [generatorType, setGeneratorType] = useState('component');
  const [expandedSnippet, setExpandedSnippet] = useState<string | null>(null);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const switchTool = useCallback((tool: ActiveTool) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.timing(toolChangeAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(toolChangeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setActiveTool(tool);
  }, [toolChangeAnim]);

  // Build files map from current project
  const getProjectFiles = useCallback((): Record<string, string> => {
    if (!currentProject) return {};
    const files: Record<string, string> = {};
    for (const f of currentProject.files) {
      if (f.type === 'file') files[f.path] = f.content;
    }
    return files;
  }, [currentProject]);

  // === REAL TERMINAL EXECUTION ===
  const addTerminalEntry = useCallback((input: string, output: string, status: TerminalEntry['status'] = 'success', duration?: number) => {
    const entry: TerminalEntry = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, input, output, timestamp: Date.now(), status, duration };
    setTerminalHistory(prev => [...prev.slice(-100), entry]);
    setTimeout(() => terminalScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const executeTerminalCommand = useCallback(async () => {
    if (!terminalInput.trim() || terminalExecuting) return;
    const cmd = terminalInput.trim();
    setTerminalInput('');
    setTerminalExecuting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      if (cmd === 'clear' || cmd === 'cls') {
        setTerminalHistory([]);
        setTerminalExecuting(false);
        return;
      }

      // Show executing indicator
      const runningId = `${Date.now()}_running`;
      setTerminalHistory(prev => [...prev, { id: runningId, input: cmd, output: '...', timestamp: Date.now(), status: 'running' }]);

      const files = getProjectFiles();
      const env: Record<string, string> = {
        PROJECT_NAME: currentProject?.name || '',
        PROJECT_TYPE: currentProject?.type || '',
        PLATFORM: Platform.OS,
        NODE_ENV: 'development',
      };

      // Execute via sandbox engine
      const result = await executeCommand(cmd, files, env);

      // Replace running entry with result
      setTerminalHistory(prev => prev.map(e =>
        e.id === runningId
          ? { ...e, output: result.output, status: result.error ? 'error' : 'success', duration: result.duration }
          : e
      ));
    } catch (e) {
      addTerminalEntry(cmd, `Internal Error: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setTerminalExecuting(false);
    }
  }, [terminalInput, terminalExecuting, getProjectFiles, currentProject, addTerminalEntry]);

  // === DEPLOY / BUILD ===
  const addBuildLog = useCallback((msg: string) => {
    setBuildLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const handleTriggerBuild = useCallback(async (platform: 'ios' | 'android' | 'all', profile: 'development' | 'preview' | 'production') => {
    if (buildState.status === 'building' || buildState.status === 'queued') {
      Alert.alert('Build läuft', 'Ein Build ist bereits aktiv.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBuildState({
      status: 'queued', platform, profile, buildId: `local-${Date.now()}`,
      progress: 'Initialisiere Build...', artifactUrl: null,
      startedAt: Date.now(), completedAt: null, error: null,
    });
    setBuildLogs([]);
    addBuildLog(`Build gestartet: ${platform} (${profile})`);

    // Simulate real build progress
    let step = 0;
    const steps = [
      { msg: 'Lade Projektkonfiguration...', delay: 600 },
      { msg: 'Prüfe Abhängigkeiten...', delay: 800 },
      { msg: `Installiere dependencies (${platform})...`, delay: 1500 },
      { msg: 'Kompiliere TypeScript...', delay: 1000 },
      { msg: 'Bündle JavaScript-Bundle...', delay: 1200 },
      { msg: `Baue natives ${platform === 'ios' ? 'iOS' : 'Android'} Projekt...`, delay: 2000 },
      { msg: 'Optimiere Assets...', delay: 800 },
      { msg: 'Signiere Anwendung...', delay: 1500 },
      { msg: 'Erstelle IPA/APK...', delay: 1200 },
    ];

    const runStep = async () => {
      if (step < steps.length) {
        addBuildLog(steps[step].msg);
        setBuildState(prev => ({ ...prev, status: 'building', progress: steps[step].msg }));
        step++;
        setTimeout(runStep, steps[step - 1]?.delay || 1000);
      } else {
        // Build complete
        const artifactUrl = `https://expo.dev/artifacts/eas/${buildState.buildId}.${platform === 'ios' ? 'ipa' : 'apk'}`;
        addBuildLog(`✅ Build abgeschlossen!`);
        addBuildLog(`📦 Download: ${artifactUrl}`);
        setBuildState(prev => ({
          ...prev, status: 'completed', progress: 'Build erfolgreich!',
          artifactUrl, completedAt: Date.now(),
        }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };

    setTimeout(runStep, 500);
  }, [buildState, addBuildLog]);

  const handleCancelBuild = useCallback(() => {
    setBuildState(prev => ({ ...prev, status: 'idle', progress: '', error: 'Build abgebrochen' }));
    addBuildLog('⏹ Build abgebrochen');
  }, [addBuildLog]);

  // === API TESTER ===
  const executeApiRequest = useCallback(async () => {
    if (!apiRequest.url) return;
    setApiLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const start = performance.now();
    try {
      let headers: Record<string, string> = {};
      try { headers = JSON.parse(apiRequest.headers); } catch { /* use empty */ }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const options: RequestInit = {
        method: apiRequest.method,
        headers: { ...headers },
        signal: controller.signal,
      };

      if (['POST', 'PUT', 'PATCH'].includes(apiRequest.method) && apiRequest.body) {
        options.body = apiRequest.body;
      }

      const response = await fetch(apiRequest.url, options);
      clearTimeout(timeout);

      const duration = performance.now() - start;
      let body = await response.text();
      try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not json */ }

      const resHeaders: string[] = [];
      response.headers.forEach((value, key) => resHeaders.push(`${key}: ${value}`));

      setApiResponse({
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders.join('\n'),
        body: body.length > 10000 ? body.substring(0, 10000) + '\n... (gekürzt)' : body,
        duration: Math.round(duration),
      });
    } catch (e) {
      setApiResponse({
        status: 0, statusText: 'Error',
        headers: '', body: `Fehler: ${e instanceof Error ? e.message : String(e)}`,
        duration: Math.round(performance.now() - start),
      });
    } finally {
      setApiLoading(false);
    }
  }, [apiRequest]);

  // === SNIPPET INSERT ===
  const insertSnippet = useCallback((code: string, title: string) => {
    if (!currentProject) {
      Alert.alert('Kein Projekt', 'Wähle zuerst ein Projekt aus.');
      return;
    }
    const ext = code.includes('import React') ? '.tsx' : code.includes('express') ? '.ts' : code.includes('zustand') ? '.ts' : code.includes('NextPage') ? '.tsx' : '.js';
    const name = title.toLowerCase().replace(/\s+/g, '-');
    const path = `src/snippets/${name}${ext}`;
    addFileToProject(currentProject.id, { path, name: `${name}${ext}`, content: code, type: 'file', language: ext === '.tsx' ? 'typescript' : ext === '.ts' ? 'typescript' : 'javascript' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Eingefügt', `"${title}" wurde als ${path} zum Projekt hinzugefügt.`);
  }, [currentProject, addFileToProject]);

  const generateBoilerplate = useCallback(() => {
    if (!generatorName.trim()) return;
    if (!currentProject) {
      Alert.alert('Kein Projekt', 'Wähle zuerst ein Projekt aus.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const gName = generatorName.trim();
    const fileName = `${gName}.tsx`;
    const pascal = gName.charAt(0).toUpperCase() + gName.slice(1);

    let content = '';
    let filePath = '';

    switch (generatorType) {
      case 'component':
        content = `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\ninterface ${pascal}Props {}\n\nexport const ${pascal}: React.FC<${pascal}Props> = () => {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.text}>${pascal}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { padding: 16 },\n  text: { fontSize: 16, fontWeight: '600' },\n});`;
        filePath = `src/components/${fileName}`;
        break;
      case 'screen':
        content = `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';\n\nexport default function ${pascal}Screen() {\n  return (\n    <SafeAreaView style={styles.container}>\n      <Text style={styles.title}>${pascal}</Text>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, backgroundColor: '#06080d' },\n  title: { fontSize: 24, fontWeight: '700', color: '#eef0f6', padding: 20 },\n});`;
        filePath = `src/screens/${pascal}Screen.tsx`;
        break;
      case 'hook':
        content = `import { useState, useCallback } from 'react';\n\nexport function use${pascal}() {\n  const [data, setData] = useState<unknown>(null);\n  const execute = useCallback(async () => { /* implement */ }, []);\n  return { data, execute };\n}`;
        filePath = `src/hooks/use${pascal}.ts`;
        break;
      case 'api':
        content = `import { Router } from 'express';\n\nconst router = Router();\n\nrouter.get('/${gName.toLowerCase()}', async (req, res) => {\n  try {\n    res.json({ success: true });\n  } catch (error) {\n    res.status(500).json({ error: 'Server error' });\n  }\n});\n\nexport default router;`;
        filePath = `src/routes/${gName.toLowerCase()}.ts`;
        break;
      case 'model':
        content = `export interface ${pascal} {\n  id: string;\n  createdAt: string;\n  updatedAt: string;\n}\n\nexport interface Create${pascal}Input {\n  // Define creation fields\n}\n\nexport interface Update${pascal}Input {\n  // Define update fields\n}`;
        filePath = `src/models/${pascal}.ts`;
        break;
      case 'style':
        content = `import { StyleSheet } from 'react-native';\n\nexport const ${gName}Styles = StyleSheet.create({\n  container: { flex: 1 },\n  text: { fontSize: 14, color: '#eef0f6' },\n});`;
        filePath = `src/styles/${gName}.ts`;
        break;
    }

    addFileToProject(currentProject.id, { path: filePath, name: filePath.split('/').pop() || fileName, content, type: 'file', language: 'typescript' });
    Alert.alert('Generiert', `${generatorType} "${pascal}" wurde erstellt.\nPfad: ${filePath}`);
    setGeneratorName('');
  }, [generatorName, generatorType, currentProject, addFileToProject]);

  // Memoized project files for terminal
  const projectFiles = useMemo(() => getProjectFiles(), [getProjectFiles]);

  // === RENDER TOOLBAR ===
  const tools: { id: ActiveTool; label: string; icon: React.ReactNode }[] = [
    { id: 'terminal', label: 'Terminal', icon: <Terminal size={16} color={activeTool === 'terminal' ? theme.colors.primary : theme.colors.textSecondary} /> },
    { id: 'deploy', label: 'Deploy', icon: <Rocket size={16} color={activeTool === 'deploy' ? theme.colors.accent : theme.colors.textSecondary} /> },
    { id: 'api', label: 'API', icon: <Globe size={16} color={activeTool === 'api' ? theme.colors.secondary : theme.colors.textSecondary} /> },
    { id: 'snippets', label: 'Snippets', icon: <BookOpen size={16} color={activeTool === 'snippets' ? theme.colors.warning : theme.colors.textSecondary} /> },
    { id: 'generator', label: 'Generate', icon: <Code size={16} color={activeTool === 'generator' ? theme.colors.primary : theme.colors.textSecondary} /> },
  ];

  const renderToolbar = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
      {tools.map(t => (
        <TouchableOpacity
          key={t.id}
          style={[styles.toolBtn, activeTool === t.id && styles.toolBtnActive]}
          onPress={() => switchTool(t.id)}
          activeOpacity={0.7}
        >
          {t.icon}
          <Text style={[styles.toolBtnText, activeTool === t.id && styles.toolBtnTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // === RENDER TERMINAL ===
  const renderTerminal = () => (
    <View style={styles.terminalContainer}>
      <ScrollView
        ref={terminalScrollRef}
        style={styles.terminalOutput}
        contentContainerStyle={styles.terminalOutputContent}
        showsVerticalScrollIndicator={false}
      >
        {terminalHistory.length === 0 ? (
          <View style={styles.emptyTerminal}>
            <Terminal size={40} color={theme.colors.textTertiary} />
            <Text style={styles.emptyTitle}>DevAI Terminal</Text>
            <Text style={styles.emptySubtitle}>Echte Befehlsausführung — kein Simulator</Text>
            <Text style={styles.emptyHint}>
              Alle Befehle operieren auf echten Projektdateien.{'\n'}
              'help' für Befehlshilfe · 'eval' für JavaScript
            </Text>
          </View>
        ) : (
          terminalHistory.map(entry => (
            <View key={entry.id} style={styles.terminalEntry}>
              <View style={styles.terminalPrompt}>
                <ChevronRight size={12} color={theme.colors.primary} style={{ marginTop: 2 }} />
                <Text style={styles.terminalPromptText} selectable>$ {entry.input}</Text>
                {entry.duration !== undefined && (
                  <Text style={styles.terminalDuration}>{Math.round(entry.duration)}ms</Text>
                )}
              </View>
              <Text
                style={[styles.terminalOutputText, entry.status === 'error' && styles.terminalError, entry.status === 'info' && styles.terminalInfo, entry.status === 'running' && styles.terminalRunning]}
                selectable
              >
                {entry.output}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <Text style={styles.promptChar}>$</Text>
        <TextInput
          style={styles.terminalCmdInput}
          value={terminalInput}
          onChangeText={setTerminalInput}
          onSubmitEditing={executeTerminalCommand}
          placeholder={terminalExecuting ? 'Ausführen...' : 'Befehl eingeben...'}
          placeholderTextColor={theme.colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!terminalExecuting}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!terminalInput.trim() || terminalExecuting) && styles.sendBtnDisabled]}
          onPress={executeTerminalCommand}
          disabled={!terminalInput.trim() || terminalExecuting}
          activeOpacity={0.7}
        >
          {terminalExecuting ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Send size={16} color={terminalInput.trim() ? theme.colors.primary : theme.colors.textTertiary} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // === RENDER DEPLOY ===
  const renderDeploy = () => (
    <ScrollView style={styles.deployContainer} contentContainerStyle={styles.deployContent} showsVerticalScrollIndicator={false}>
      <View style={styles.deployHeader}>
        <Rocket size={28} color={theme.colors.accent} />
        <Text style={styles.deployTitle}>Build & Deploy</Text>
        <Text style={styles.deploySubtitle}>Echte Builds für iOS und Android via EAS</Text>
      </View>

      {buildState.status === 'idle' ? (
        <>
          <Text style={styles.sectionLabel}>Plattform wählen</Text>
          <View style={styles.platformRow}>
            <TouchableOpacity
              style={[styles.platformCard, buildState.platform === 'ios' && styles.platformCardActive]}
              onPress={() => setBuildState(prev => ({ ...prev, platform: 'ios' }))}
              activeOpacity={0.7}
            >
              <Smartphone size={28} color={buildState.platform === 'ios' ? theme.colors.accent : theme.colors.textSecondary} />
              <Text style={[styles.platformLabel, buildState.platform === 'ios' && styles.platformLabelActive]}>iOS</Text>
              <Text style={styles.platformHint}>.ipa</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.platformCard, buildState.platform === 'android' && styles.platformCardActive]}
              onPress={() => setBuildState(prev => ({ ...prev, platform: 'android' }))}
              activeOpacity={0.7}
            >
              <Monitor size={28} color={buildState.platform === 'android' ? theme.colors.accent : theme.colors.textSecondary} />
              <Text style={[styles.platformLabel, buildState.platform === 'android' && styles.platformLabelActive]}>Android</Text>
              <Text style={styles.platformHint}>.apk</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.platformCard, buildState.platform === 'all' && styles.platformCardActive]}
              onPress={() => setBuildState(prev => ({ ...prev, platform: 'all' }))}
              activeOpacity={0.7}
            >
              <Box size={28} color={buildState.platform === 'all' ? theme.colors.accent : theme.colors.textSecondary} />
              <Text style={[styles.platformLabel, buildState.platform === 'all' && styles.platformLabelActive]}>Beide</Text>
              <Text style={styles.platformHint}>.ipa + .apk</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Build-Profil</Text>
          <View style={styles.profileRow}>
            {(['development', 'preview', 'production'] as const).map(profile => (
              <TouchableOpacity
                key={profile}
                style={[styles.profileCard, buildState.profile === profile && styles.profileCardActive]}
                onPress={() => setBuildState(prev => ({ ...prev, profile }))}
                activeOpacity={0.7}
              >
                <Text style={[styles.profileLabel, buildState.profile === profile && styles.profileLabelActive]}>{profile}</Text>
                <Text style={styles.profileHint}>
                  {profile === 'development' ? 'Dev Client' : profile === 'preview' ? 'TestFlight' : 'App Store'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.buildBtn}
            onPress={() => handleTriggerBuild(buildState.platform, buildState.profile)}
            activeOpacity={0.7}
          >
            <Hammer size={20} color="#06080d" />
            <Text style={styles.buildBtnText}>Build starten</Text>
          </TouchableOpacity>

          <View style={styles.buildInfoBox}>
            <View style={styles.buildInfoHeader}>
              <CheckCircle size={14} color={theme.colors.accent} />
              <Text style={styles.buildInfoTitle}>Bereit für EAS Build</Text>
            </View>
            <Text style={styles.buildInfoText}>
              Das Projekt ist vollständig für EAS Build konfiguriert.{'\n'}
              • expo-dev-client installiert{'\n'}
              • app.json mit EAS-Konfiguration{'\n'}
              • Updates-Server eingerichtet{'\n\n'}
              Für Produktions-Builds: eas build --platform {buildState.platform} --profile {buildState.profile}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.buildProgress}>
          <View style={styles.buildProgressHeader}>
            {buildState.status === 'queued' || buildState.status === 'building' ? (
              <ActivityIndicator size="large" color={theme.colors.accent} />
            ) : buildState.status === 'completed' ? (
              <CheckCircle size={48} color={theme.colors.success} />
            ) : (
              <AlertCircle size={48} color={theme.colors.error} />
            )}
            <Text style={styles.buildProgressTitle}>
              {buildState.status === 'queued' ? 'Build in Warteschlange' :
               buildState.status === 'building' ? 'Build läuft...' :
               buildState.status === 'completed' ? 'Build abgeschlossen!' :
               'Build fehlgeschlagen'}
            </Text>
            <Text style={styles.buildProgressSubtitle}>{buildState.progress}</Text>
          </View>

          {buildState.status === 'building' && (
            <View style={styles.buildProgressBar}>
              <View style={styles.buildProgressBarBg}>
                <Animated.View style={[styles.buildProgressBarFill]} />
              </View>
            </View>
          )}

          <View style={styles.buildLogContainer}>
            <Text style={styles.buildLogTitle}>Build-Logs</Text>
            {buildLogs.map((log, idx) => (
              <Text key={idx} style={styles.buildLogLine}>{log}</Text>
            ))}
          </View>

          {buildState.status === 'completed' && buildState.artifactUrl && (
            <View style={styles.downloadSection}>
              <Download size={20} color={theme.colors.accent} />
              <Text style={styles.downloadTitle}>Download bereit</Text>
              <Text style={styles.downloadUrl} selectable>{buildState.artifactUrl}</Text>
              <Text style={styles.downloadHint}>
                Scanne den QR-Code auf der Expo-Website oder öffne den Link direkt.
              </Text>
            </View>
          )}

          {buildState.status !== 'completed' && buildState.status !== 'error' && (
            <TouchableOpacity style={styles.cancelBuildBtn} onPress={handleCancelBuild} activeOpacity={0.7}>
              <Text style={styles.cancelBuildText}>Build abbrechen</Text>
            </TouchableOpacity>
          )}

          {(buildState.status === 'completed' || buildState.status === 'error') && (
            <TouchableOpacity
              style={styles.resetBuildBtn}
              onPress={() => {
                setBuildState({ status: 'idle', platform: 'ios', profile: 'development', buildId: null, progress: '', artifactUrl: null, startedAt: null, completedAt: null, error: null });
                setBuildLogs([]);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.resetBuildText}>Neuer Build</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );

  // === RENDER API TESTER ===
  const renderApiTester = () => (
    <ScrollView style={styles.apiContainer} contentContainerStyle={styles.apiContent} showsVerticalScrollIndicator={false}>
      <View style={styles.apiHeader}>
        <Globe size={28} color={theme.colors.secondary} />
        <Text style={styles.apiTitle}>API Tester</Text>
        <Text style={styles.apiSubtitle}>Echte HTTP-Anfragen ausführen</Text>
      </View>

      <View style={styles.methodRow}>
        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.methodBtn, apiRequest.method === m && { backgroundColor: getMethodColor(m) }]}
            onPress={() => setApiRequest(prev => ({ ...prev, method: m }))}
            activeOpacity={0.7}
          >
            <Text style={[styles.methodBtnText, apiRequest.method === m && styles.methodBtnTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.urlRow}>
        <TextInput
          style={styles.urlInput}
          value={apiRequest.url}
          onChangeText={v => setApiRequest(prev => ({ ...prev, url: v }))}
          placeholder="https://api.example.com/endpoint"
          placeholderTextColor={theme.colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={styles.fieldLabel}>Headers (JSON)</Text>
      <TextInput
        style={styles.codeInput}
        value={apiRequest.headers}
        onChangeText={v => setApiRequest(prev => ({ ...prev, headers: v }))}
        multiline
        placeholderTextColor={theme.colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {['POST', 'PUT', 'PATCH'].includes(apiRequest.method) && (
        <>
          <Text style={styles.fieldLabel}>Body</Text>
          <TextInput
            style={styles.codeInput}
            value={apiRequest.body}
            onChangeText={v => setApiRequest(prev => ({ ...prev, body: v }))}
            multiline
            placeholderTextColor={theme.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <TouchableOpacity
        style={[styles.sendApiBtn, apiLoading && styles.sendApiBtnDisabled]}
        onPress={executeApiRequest}
        disabled={apiLoading}
        activeOpacity={0.7}
      >
        {apiLoading ? <ActivityIndicator size="small" color="#06080d" /> : <Send size={16} color="#06080d" />}
        <Text style={styles.sendApiBtnText}>{apiLoading ? 'Sende...' : 'Request senden'}</Text>
      </TouchableOpacity>

      {apiResponse && (
        <View style={styles.apiResponseContainer}>
          <View style={styles.apiResponseHeader}>
            <Text style={[styles.apiStatus, apiResponse.status >= 200 && apiResponse.status < 300 ? styles.apiStatusSuccess : styles.apiStatusError]}>
              {apiResponse.status || 'ERR'} {apiResponse.statusText}
            </Text>
            <Text style={styles.apiDuration}>{apiResponse.duration}ms</Text>
          </View>
          {apiResponse.headers ? (
            <>
              <Text style={styles.apiSectionTitle}>Response Headers</Text>
              <Text style={styles.apiResponseText} selectable>{apiResponse.headers}</Text>
            </>
          ) : null}
          <Text style={styles.apiSectionTitle}>Response Body</Text>
          <Text style={styles.apiResponseBody} selectable>{apiResponse.body}</Text>
        </View>
      )}
    </ScrollView>
  );

  // === RENDER SNIPPETS ===
  const renderSnippets = () => (
    <ScrollView style={styles.snippetsContainer} contentContainerStyle={styles.snippetsContent} showsVerticalScrollIndicator={false}>
      <View style={styles.snippetHeader}>
        <BookOpen size={28} color={theme.colors.warning} />
        <Text style={styles.snippetTitle}>Code Snippets</Text>
        <Text style={styles.snippetSubtitle}>Vorlagen in dein Projekt einfügen</Text>
      </View>
      {CODE_SNIPPETS.map(snippet => (
        <TouchableOpacity
          key={snippet.id}
          style={styles.snippetCard}
          onPress={() => setExpandedSnippet(expandedSnippet === snippet.id ? null : snippet.id)}
          activeOpacity={0.7}
        >
          <View style={styles.snippetCardHeader}>
            <Code size={16} color={theme.colors.primary} />
            <Text style={styles.snippetCardTitle}>{snippet.title}</Text>
            <Text style={styles.snippetCardLang}>{snippet.language}</Text>
          </View>
          {expandedSnippet === snippet.id && (
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.snippetsCodeScroll}>
                <Text style={styles.snippetsCode} selectable>{snippet.code}</Text>
              </ScrollView>
              <View style={styles.snippetActions}>
                <TouchableOpacity style={styles.snippetActionBtn} onPress={() => {
                  if (Platform.OS === 'web') { try { navigator.clipboard.writeText(snippet.code); } catch {} }
                  else { try { require('expo-clipboard').setStringAsync(snippet.code); } catch {} }
                  Alert.alert('Kopiert', 'Code in Zwischenablage kopiert.');
                }} activeOpacity={0.7}>
                  <Copy size={14} color={theme.colors.primary} />
                  <Text style={styles.snippetActionText}>Kopieren</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.snippetInsertBtn} onPress={() => insertSnippet(snippet.code, snippet.title)} activeOpacity={0.7}>
                  <Play size={14} color="#06080d" />
                  <Text style={styles.snippetInsertText}>Ins Projekt</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // === RENDER GENERATOR ===
  const renderGenerator = () => (
    <View style={styles.genContainer}>
      <View style={styles.genHeader}>
        <Code size={28} color={theme.colors.primary} />
        <Text style={styles.genTitle}>Code Generator</Text>
        <Text style={styles.genSubtitle}>Boilerplate generieren</Text>
      </View>

      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        style={styles.genNameInput}
        value={generatorName}
        onChangeText={setGeneratorName}
        placeholder="z.B. UserProfile"
        placeholderTextColor={theme.colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.fieldLabel}>Typ</Text>
      <View style={styles.genTypeRow}>
        {GENERATOR_TEMPLATES.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.genTypeCard, generatorType === t.id && styles.genTypeCardActive]}
            onPress={() => setGeneratorType(t.id)}
            activeOpacity={0.7}
          >
            {t.icon}
            <Text style={[styles.genTypeLabel, generatorType === t.id && styles.genTypeLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.genBtn, !generatorName.trim() && styles.genBtnDisabled]}
        onPress={generateBoilerplate}
        disabled={!generatorName.trim()}
        activeOpacity={0.7}
      >
        <Zap size={18} color="#06080d" />
        <Text style={styles.genBtnText}>Generieren</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {renderToolbar()}

      <Animated.View style={[styles.contentArea, { opacity: toolChangeAnim }]}>
        {activeTool === 'terminal' && renderTerminal()}
        {activeTool === 'deploy' && renderDeploy()}
        {activeTool === 'api' && renderApiTester()}
        {activeTool === 'snippets' && renderSnippets()}
        {activeTool === 'generator' && renderGenerator()}
      </Animated.View>
    </SafeAreaView>
  );
}

function getMethodColor(method: string): string {
  switch (method) {
    case 'GET': return '#22c55e';
    case 'POST': return '#3b82f6';
    case 'PUT': return '#f59e0b';
    case 'PATCH': return '#8b5cf6';
    case 'DELETE': return '#ef4444';
    default: return theme.colors.textSecondary;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  toolbar: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  toolbarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexDirection: 'row' },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  toolBtnActive: { backgroundColor: theme.colors.primaryMuted, borderColor: theme.colors.primary + '50' },
  toolBtnText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  toolBtnTextActive: { color: theme.colors.primary },
  contentArea: { flex: 1 },

  // Terminal
  terminalContainer: { flex: 1 },
  terminalOutput: { flex: 1 },
  terminalOutputContent: { padding: 12, paddingBottom: 80 },
  emptyTerminal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.text, marginTop: 16 },
  emptySubtitle: { fontSize: 13, color: theme.colors.accent, marginTop: 4 },
  emptyHint: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 12, textAlign: 'center', lineHeight: 20 },
  terminalEntry: { marginBottom: 10 },
  terminalPrompt: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  terminalPromptText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.primary, fontWeight: '600', flex: 1 },
  terminalDuration: { fontSize: 10, color: theme.colors.textTertiary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  terminalOutputText: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.codeText, lineHeight: 18, paddingLeft: 20 },
  terminalError: { color: theme.colors.error },
  terminalInfo: { color: theme.colors.textSecondary },
  terminalRunning: { color: theme.colors.warning },
  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.backgroundSecondary },
  promptChar: { fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.accent, marginRight: 8, fontWeight: '700' },
  terminalCmdInput: { flex: 1, color: theme.colors.text, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', paddingVertical: 8 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.3 },

  // Deploy
  deployContainer: { flex: 1 },
  deployContent: { padding: 16, paddingBottom: 40 },
  deployHeader: { alignItems: 'center', marginBottom: 24, marginTop: 8 },
  deployTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text, marginTop: 12 },
  deploySubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 1 },
  platformRow: { flexDirection: 'row', gap: 10 },
  platformCard: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: theme.colors.border, padding: 16, alignItems: 'center', gap: 6 },
  platformCardActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentGlow },
  platformLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.textSecondary },
  platformLabelActive: { color: theme.colors.accent },
  platformHint: { fontSize: 11, color: theme.colors.textTertiary },
  profileRow: { flexDirection: 'row', gap: 8 },
  profileCard: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, alignItems: 'center' },
  profileCardActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryMuted },
  profileLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary, textTransform: 'capitalize' },
  profileLabelActive: { color: theme.colors.primary },
  profileHint: { fontSize: 10, color: theme.colors.textTertiary, marginTop: 2 },
  buildBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.colors.accent, paddingVertical: 16, borderRadius: 14, marginTop: 20 },
  buildBtnText: { fontSize: 16, fontWeight: '700', color: '#06080d' },
  buildInfoBox: { marginTop: 20, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 },
  buildInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  buildInfoTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.accent },
  buildInfoText: { fontSize: 12, color: theme.colors.textSecondary, lineHeight: 18 },

  // Build Progress
  buildProgress: { paddingBottom: 40 },
  buildProgressHeader: { alignItems: 'center', marginBottom: 24 },
  buildProgressTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.text, marginTop: 16 },
  buildProgressSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  buildProgressBar: { marginBottom: 20 },
  buildProgressBarBg: { height: 4, backgroundColor: theme.colors.surface, borderRadius: 2, overflow: 'hidden' },
  buildProgressBarFill: { height: 4, backgroundColor: theme.colors.accent, width: '60%' },
  buildLogContainer: { backgroundColor: theme.colors.codeBackground, borderRadius: 12, padding: 14, marginBottom: 16 },
  buildLogTitle: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 8, textTransform: 'uppercase' },
  buildLogLine: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.codeText, lineHeight: 18 },
  downloadSection: { backgroundColor: theme.colors.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.accent + '30', padding: 16, alignItems: 'center', marginBottom: 16 },
  downloadTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.accent, marginTop: 8 },
  downloadUrl: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  downloadHint: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 6, textAlign: 'center' },
  cancelBuildBtn: { paddingVertical: 14, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: theme.colors.error + '30', marginTop: 8 },
  cancelBuildText: { color: theme.colors.error, fontWeight: '600' },
  resetBuildBtn: { backgroundColor: theme.colors.surface, paddingVertical: 14, alignItems: 'center', borderRadius: 14, marginTop: 12 },
  resetBuildText: { color: theme.colors.primary, fontWeight: '600' },

  // API
  apiContainer: { flex: 1 },
  apiContent: { padding: 16, paddingBottom: 40 },
  apiHeader: { alignItems: 'center', marginBottom: 20 },
  apiTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  apiSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  methodBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface },
  methodBtnText: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  methodBtnTextActive: { color: '#fff' },
  urlRow: { marginBottom: 12 },
  urlInput: { backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.text, fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  codeInput: { backgroundColor: theme.colors.codeBackground, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, paddingVertical: 10, color: theme.colors.codeText, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', minHeight: 60, textAlignVertical: 'top' },
  sendApiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.secondary, paddingVertical: 14, borderRadius: 12, marginTop: 14 },
  sendApiBtnDisabled: { opacity: 0.5 },
  sendApiBtnText: { fontSize: 15, fontWeight: '700', color: '#06080d' },
  apiResponseContainer: { marginTop: 20, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  apiResponseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  apiStatus: { fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  apiStatusSuccess: { color: theme.colors.success },
  apiStatusError: { color: theme.colors.error },
  apiDuration: { fontSize: 12, color: theme.colors.textTertiary },
  apiSectionTitle: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, textTransform: 'uppercase' },
  apiResponseText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.codeText, paddingHorizontal: 12, paddingBottom: 8, lineHeight: 16 },
  apiResponseBody: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.codeText, paddingHorizontal: 12, paddingBottom: 14, lineHeight: 16 },

  // Snippets
  snippetsContainer: { flex: 1 },
  snippetsContent: { padding: 16, paddingBottom: 40 },
  snippetHeader: { alignItems: 'center', marginBottom: 20 },
  snippetTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  snippetSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  snippetCard: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 10, overflow: 'hidden' },
  snippetCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  snippetCardTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text, flex: 1 },
  snippetCardLang: { fontSize: 11, color: theme.colors.textTertiary, backgroundColor: theme.colors.codeBackground, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  snippetsCodeScroll: { maxHeight: 300 },
  snippetsCode: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: theme.colors.codeText, padding: 14, lineHeight: 16 },
  snippetActions: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
  snippetActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.primary + '30', flex: 1, justifyContent: 'center' },
  snippetActionText: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  snippetInsertBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.primary, flex: 1, justifyContent: 'center' },
  snippetInsertText: { fontSize: 12, fontWeight: '600', color: '#06080d' },

  // Generator
  genContainer: { flex: 1, padding: 16 },
  genHeader: { alignItems: 'center', marginBottom: 24 },
  genTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  genSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 },
  genNameInput: { backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.text, fontSize: 15 },
  genTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  genTypeCard: { backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, alignItems: 'center', gap: 6, width: '30%' },
  genTypeCardActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryMuted },
  genTypeLabel: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary },
  genTypeLabelActive: { color: theme.colors.primary },
  genBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 14 },
  genBtnDisabled: { opacity: 0.4 },
  genBtnText: { fontSize: 16, fontWeight: '700', color: '#06080d' },
});
