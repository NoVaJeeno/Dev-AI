export interface SourceFileEntry {
  path: string;
  category: 'routing' | 'component' | 'hook' | 'provider' | 'type' | 'util' | 'constant' | 'config';
  description: string;
}

export const APP_SOURCE_REGISTRY: SourceFileEntry[] = [
  { path: 'app/_layout.tsx', category: 'routing', description: 'Root Layout mit QueryClient, AuthGate, ErrorBoundary, Providers' },
  { path: 'app/login.tsx', category: 'routing', description: 'Login-Screen mit Passwort-Authentifizierung' },
  { path: 'app/+not-found.tsx', category: 'routing', description: '404 Not Found Screen' },
  { path: 'app/+native-intent.tsx', category: 'routing', description: 'Native Intent Handler' },
  { path: 'app/(tabs)/_layout.tsx', category: 'routing', description: 'Tab Layout: Chat, Projekte, Dateien, Tools, Terminal, Settings' },
  { path: 'app/(tabs)/(chat)/_layout.tsx', category: 'routing', description: 'Chat Tab Stack Layout' },
  { path: 'app/(tabs)/(chat)/index.tsx', category: 'routing', description: 'Chat Screen - Dual Agent System, Message History, Live Preview' },
  { path: 'app/(tabs)/projects/_layout.tsx', category: 'routing', description: 'Projects Tab Stack Layout' },
  { path: 'app/(tabs)/projects/index.tsx', category: 'routing', description: 'Projekte Screen - CRUD, Suche, Export' },
  { path: 'app/(tabs)/files/_layout.tsx', category: 'routing', description: 'Files Tab Stack Layout' },
  { path: 'app/(tabs)/files/index.tsx', category: 'routing', description: 'File Manager - Tree/List View, Editor, Syntax Highlight' },
  { path: 'app/(tabs)/tools/_layout.tsx', category: 'routing', description: 'Tools Tab Stack Layout' },
  { path: 'app/(tabs)/tools/index.tsx', category: 'routing', description: 'Dev Tools - Terminal, API Tester, Snippets, Generator' },
  { path: 'app/(tabs)/terminal/_layout.tsx', category: 'routing', description: 'Terminal Tab Stack Layout' },
  { path: 'app/(tabs)/terminal/index.tsx', category: 'routing', description: 'Terminal - SSH/WebSocket Verbindung, Command Execution' },
  { path: 'app/(tabs)/workspace/_layout.tsx', category: 'routing', description: 'Workspace Tab Stack Layout' },
  { path: 'app/(tabs)/workspace/index.tsx', category: 'routing', description: 'Workspace - Projektübersicht und Dateiverwaltung' },
  { path: 'app/(tabs)/settings/_layout.tsx', category: 'routing', description: 'Settings Tab Stack Layout' },
  { path: 'app/(tabs)/settings/index.tsx', category: 'routing', description: 'Settings - Theme, Font, Haptics, Connection Guard Status' },

  { path: 'components/AgentMessage.tsx', category: 'component', description: 'KI-Nachricht Renderer mit Tool-Anzeige, Code-Blöcke, Copy' },
  { path: 'components/AnimatedTerminalOutput.tsx', category: 'component', description: 'Animierte Terminal-Ausgabe mit Typewriter-Effekt' },
  { path: 'components/ChatInput.tsx', category: 'component', description: 'Chat Eingabe mit Datei-Upload, Bild-Picker, Vorschau' },
  { path: 'components/ChatMessage.tsx', category: 'component', description: 'Chat Nachricht Layout (User/Assistant)' },
  { path: 'components/ConversationList.tsx', category: 'component', description: 'Sidebar Konversationsliste mit Suche und Verwaltung' },
  { path: 'components/DevToolsPanel.tsx', category: 'component', description: 'Developer Tools Panel - Quick Commands, Snippets' },
  { path: 'components/ErrorBoundary.tsx', category: 'component', description: 'Error Boundary mit Self-Healing und Auto-Recovery' },
  { path: 'components/LivePreview.tsx', category: 'component', description: 'Live-Vorschau für Projekte (WebView-basiert)' },
  { path: 'components/TaskActivityOverlay.tsx', category: 'component', description: 'Tool-Aktivitäts-Overlay mit Animationen' },

  { path: 'hooks/useDevAgent.ts', category: 'hook', description: 'Primärer KI-Agent: 50+ Tools, Memory, Projekt-Management, Code-Gen' },
  { path: 'hooks/useSecondAgent.ts', category: 'hook', description: 'Sekundärer KI-Agent: Parallele Instanz mit vollen Rechten' },

  { path: 'providers/AuthProvider.tsx', category: 'provider', description: 'Authentifizierung Provider mit Passwort-Login' },
  { path: 'providers/ConnectionGuard.tsx', category: 'provider', description: 'Connection Guard - Schutz, Health Checks, Encryption, Stealth' },
  { path: 'providers/StorageProvider.tsx', category: 'provider', description: 'MMKV Storage - Conversations, Projects, Memory, Settings' },

  { path: 'types/index.ts', category: 'type', description: 'TypeScript Typen: Message, Conversation, Project, ProjectFile, etc.' },

  { path: 'utils/encryption.ts', category: 'util', description: 'XOR-Verschlüsselung, Base64, Device Fingerprint' },
  { path: 'utils/helpers.ts', category: 'util', description: 'generateId, formatTimestamp, getFileLanguage, debounce' },
  { path: 'utils/mmkv.ts', category: 'util', description: 'MMKV Cache Engine (AsyncStorage-backed, sync reads)' },

  { path: 'constants/colors.ts', category: 'constant', description: 'Farb-Konstanten' },
  { path: 'constants/templates.ts', category: 'constant', description: 'Projekt-Templates: react-native, nextjs, express, landing, dashboard' },
  { path: 'constants/theme.ts', category: 'constant', description: 'App Theme: Colors, Spacing, BorderRadius, FontSize' },
  { path: 'constants/sourceRegistry.ts', category: 'constant', description: 'Source Registry aller App-Dateien' },

  { path: 'app.json', category: 'config', description: 'Expo App Konfiguration' },
  { path: 'package.json', category: 'config', description: 'Dependencies und Scripts' },
  { path: 'tsconfig.json', category: 'config', description: 'TypeScript Konfiguration' },
  { path: 'babel.config.js', category: 'config', description: 'Babel Konfiguration' },
  { path: 'metro.config.js', category: 'config', description: 'Metro Bundler Konfiguration' },
  { path: 'eslint.config.js', category: 'config', description: 'ESLint Konfiguration' },
];

export function generateArchitectureDoc(): string {
  const now = new Date().toLocaleDateString('de-DE');
  const categories = {
    routing: APP_SOURCE_REGISTRY.filter(f => f.category === 'routing'),
    component: APP_SOURCE_REGISTRY.filter(f => f.category === 'component'),
    hook: APP_SOURCE_REGISTRY.filter(f => f.category === 'hook'),
    provider: APP_SOURCE_REGISTRY.filter(f => f.category === 'provider'),
    type: APP_SOURCE_REGISTRY.filter(f => f.category === 'type'),
    util: APP_SOURCE_REGISTRY.filter(f => f.category === 'util'),
    constant: APP_SOURCE_REGISTRY.filter(f => f.category === 'constant'),
    config: APP_SOURCE_REGISTRY.filter(f => f.category === 'config'),
  };

  let doc = `# Developer AI Studio - Vollständige Architektur\n`;
  doc += `## Generiert: ${now}\n\n`;
  doc += `## Stack\n`;
  doc += `- React Native 0.81 + Expo SDK 54\n`;
  doc += `- TypeScript 5.9\n`;
  doc += `- Expo Router (File-based)\n`;
  doc += `- @rork-ai/toolkit-sdk (Dual Agent System)\n`;
  doc += `- MMKV Cache Engine (AsyncStorage-backed)\n`;
  doc += `- @tanstack/react-query\n`;
  doc += `- @nkzw/create-context-hook\n`;
  doc += `- XOR Encryption + Stealth Keys\n\n`;

  doc += `## Dateien: ${APP_SOURCE_REGISTRY.length} total\n\n`;

  const catLabels: Record<string, string> = {
    routing: 'Routing & Screens',
    component: 'Components',
    hook: 'Hooks (KI Agents)',
    provider: 'Providers',
    type: 'Types',
    util: 'Utilities',
    constant: 'Constants',
    config: 'Config',
  };

  for (const [cat, files] of Object.entries(categories)) {
    doc += `### ${catLabels[cat]} (${files.length})\n`;
    for (const f of files) {
      doc += `- \`${f.path}\` — ${f.description}\n`;
    }
    doc += `\n`;
  }

  doc += `## Features\n`;
  doc += `- Dual AI Agent System (Primary + Secondary, parallel)\n`;
  doc += `- 50+ Development Tools (File Management, Code Generation, API Testing)\n`;
  doc += `- Persistent Memory System (über alle Chats)\n`;
  doc += `- Connection Guard (Health Checks, Auto-Recovery, Stealth Protection)\n`;
  doc += `- Chat Encryption (XOR + Base64, auto on background)\n`;
  doc += `- Self-Healing Error Boundary\n`;
  doc += `- Live Project Preview\n`;
  doc += `- File Manager mit Tree/List View\n`;
  doc += `- Terminal mit SSH/WebSocket Support\n`;
  doc += `- Project Templates (5 Typen)\n`;
  doc += `- Loop Detection & Protection\n`;
  doc += `- Auth System mit Passwort\n\n`;

  doc += `## Schutz-Systeme\n`;
  doc += `- ConnectionGuard: Stealth Key Backup, Integrity Hash, Auto-Reconnect\n`;
  doc += `- Tool Registry Protection: Tamper Detection + Auto-Restore\n`;
  doc += `- Agent Protection: Dual Registry, Parallel Health Checks\n`;
  doc += `- Storage Protection: Key Validation, Corruption Recovery\n`;
  doc += `- Chat Encryption: Auto-encrypt on background, auto-decrypt on foreground\n`;

  return doc;
}

export function generateDependencyDoc(): string {
  return `{
  "dependencies": {
    "@expo/vector-icons": "^15.0.3",
    "@nkzw/create-context-hook": "^1.1.0",
    "@react-native-async-storage/async-storage": "2.2.0",
    "@rork-ai/toolkit-sdk": "^0.2.51",
    "@stardazed/streams-text-encoding": "^1.0.2",
    "@tanstack/react-query": "^5.83.0",
    "@ungap/structured-clone": "^1.3.0",
    "expo": "~54.0.27",
    "expo-blur": "~15.0.8",
    "expo-clipboard": "~8.0.8",
    "expo-constants": "~18.0.11",
    "expo-font": "~14.0.10",
    "expo-haptics": "~15.0.8",
    "expo-image": "~3.0.11",
    "expo-image-manipulator": "~14.0.8",
    "expo-image-picker": "~17.0.9",
    "expo-linear-gradient": "~15.0.8",
    "expo-linking": "~8.0.10",
    "expo-location": "~19.0.8",
    "expo-router": "~6.0.17",
    "expo-splash-screen": "~31.0.12",
    "expo-status-bar": "~3.0.9",
    "expo-symbols": "~1.0.8",
    "expo-system-ui": "~6.0.9",
    "expo-web-browser": "~15.0.10",
    "lucide-react-native": "^0.475.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.5",
    "react-native-gesture-handler": "~2.28.0",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-svg": "15.12.1",
    "react-native-web": "^0.21.0",
    "zod": "^4.3.6"
  }
}`;
}
