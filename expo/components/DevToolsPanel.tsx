import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import {
  Terminal,
  FolderTree,
  Search,
  FileCode,
  Wrench,
  X,
  Info,
  HardDrive,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useStorage } from '@/providers/StorageProvider';
import { getFileIcon } from '@/utils/helpers';

interface DevToolsPanelProps {
  visible: boolean;
  onClose: () => void;
  onSendCommand: (command: string) => void;
}

type TabId = 'files' | 'search' | 'terminal' | 'info';

export const DevToolsPanel: React.FC<DevToolsPanelProps> = React.memo(
  ({ visible, onClose, onSendCommand }) => {
    const { currentProject, state } = useStorage();
    const [activeTab, setActiveTab] = useState<TabId>('files');
    const [searchQuery, setSearchQuery] = useState('');
    const [terminalInput, setTerminalInput] = useState('');
    const [terminalHistory, setTerminalHistory] = useState<{ input: string; output: string }[]>([]);

    const handleTerminalCommand = useCallback(() => {
      if (!terminalInput.trim()) return;
      const cmd = terminalInput.trim();

      if (cmd.startsWith('/')) {
        onSendCommand(cmd.substring(1));
        setTerminalHistory(prev => [...prev, { input: cmd, output: 'Befehl an KI gesendet...' }]);
      } else {
        let output = '';
        const parts = cmd.split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        try {
          if (command === 'ls' || command === 'dir') {
            if (!currentProject) { output = 'Kein Projekt ausgewählt'; }
            else {
              const filterPath = args[0] || '';
              const files = currentProject.files
                .filter(f => !filterPath || f.path.startsWith(filterPath))
                .sort((a, b) => a.path.localeCompare(b.path));
              output = files.length > 0
                ? files.map(f => `${f.type === 'folder' ? '[D]' : '   '} ${f.path}`).join('\n')
                : 'Keine Dateien';
            }
          } else if (command === 'cat' || command === 'read') {
            if (!currentProject) { output = 'Kein Projekt ausgewählt'; }
            else if (!args[0]) { output = 'Usage: cat <datei>'; }
            else {
              const file = currentProject.files.find(f => f.path === args[0]);
              output = file ? file.content : `Nicht gefunden: ${args[0]}`;
            }
          } else if (command === 'tree') {
            if (!currentProject) { output = 'Kein Projekt ausgewählt'; }
            else {
              const sorted = [...currentProject.files].sort((a, b) => a.path.localeCompare(b.path));
              output = `${currentProject.name}/\n` + sorted.map((f, i) =>
                `${i === sorted.length - 1 ? '└── ' : '├── '}${f.path}`
              ).join('\n');
            }
          } else if (command === 'grep') {
            if (!currentProject) { output = 'Kein Projekt ausgewählt'; }
            else if (!args[0]) { output = 'Usage: grep <pattern>'; }
            else {
              const results: string[] = [];
              const regex = new RegExp(args[0], 'gi');
              for (const file of currentProject.files) {
                if (file.type === 'folder') continue;
                file.content.split('\n').forEach((line, idx) => {
                  if (regex.test(line)) results.push(`${file.path}:${idx + 1}: ${line.trim()}`);
                  regex.lastIndex = 0;
                });
              }
              output = results.length > 0 ? results.slice(0, 20).join('\n') : 'Keine Treffer';
            }
          } else if (command === 'pwd') {
            output = currentProject ? `/${currentProject.name}` : '/';
          } else if (command === 'clear') {
            setTerminalHistory([]);
            setTerminalInput('');
            return;
          } else if (command === 'info') {
            if (currentProject) {
              const totalLines = currentProject.files.filter(f => f.type === 'file').reduce((a, f) => a + f.content.split('\n').length, 0);
              output = `${currentProject.name} (${currentProject.type}) [${currentProject.status}]\n${currentProject.files.length} Dateien, ${totalLines} Zeilen`;
            } else { output = 'Kein Projekt'; }
          } else if (command === 'help') {
            output = 'ls, cat, tree, grep, pwd, info, clear, /[text]';
          } else if (command === 'env') {
            output = `Expo SDK 54 | ${Platform.OS} | AsyncStorage | 25+ AI Tools`;
          } else {
            output = `Unbekannt: ${cmd} — "help" für Hilfe`;
          }
        } catch (e) {
          output = `Fehler: ${e instanceof Error ? e.message : String(e)}`;
        }
        setTerminalHistory(prev => [...prev, { input: cmd, output }]);
      }
      setTerminalInput('');
    }, [terminalInput, currentProject, onSendCommand]);

    const filteredFiles = currentProject?.files.filter(f =>
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!visible) return null;

    const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
      { id: 'files', icon: <FolderTree size={14} color={activeTab === 'files' ? theme.colors.primary : theme.colors.textTertiary} />, label: 'Dateien' },
      { id: 'search', icon: <Search size={14} color={activeTab === 'search' ? theme.colors.primary : theme.colors.textTertiary} />, label: 'Suche' },
      { id: 'terminal', icon: <Terminal size={14} color={activeTab === 'terminal' ? theme.colors.primary : theme.colors.textTertiary} />, label: 'Terminal' },
      { id: 'info', icon: <Info size={14} color={activeTab === 'info' ? theme.colors.primary : theme.colors.textTertiary} />, label: 'Info' },
    ];

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Wrench size={14} color={theme.colors.primary} />
            <Text style={styles.headerTitle}>DevTools</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <X size={14} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.body}>
          {activeTab === 'files' && (
            <ScrollView style={styles.fileList} showsVerticalScrollIndicator={false}>
              {!currentProject ? (
                <View style={styles.emptyState}>
                  <FolderTree size={28} color={theme.colors.textTertiary} />
                  <Text style={styles.emptyText}>Kein Projekt</Text>
                </View>
              ) : currentProject.files.length === 0 ? (
                <View style={styles.emptyState}>
                  <FileCode size={28} color={theme.colors.textTertiary} />
                  <Text style={styles.emptyText}>Keine Dateien</Text>
                </View>
              ) : (
                currentProject.files
                  .filter(f => f.type === 'file')
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map(file => (
                    <View key={file.id} style={styles.fileItem}>
                      <Text style={styles.fileIcon}>{getFileIcon(file.name)}</Text>
                      <View style={styles.fileInfo}>
                        <Text style={styles.fileName} numberOfLines={1}>{file.path}</Text>
                        <Text style={styles.fileMeta}>{file.content.split('\n').length} Zeilen</Text>
                      </View>
                    </View>
                  ))
              )}
            </ScrollView>
          )}

          {activeTab === 'search' && (
            <View style={styles.searchPanel}>
              <View style={styles.searchInputContainer}>
                <Search size={13} color={theme.colors.textTertiary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Suchen..."
                  placeholderTextColor={theme.colors.textTertiary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                />
              </View>
              <ScrollView style={styles.searchResults} showsVerticalScrollIndicator={false}>
                {searchQuery && filteredFiles?.map(file => (
                  <View key={file.id} style={styles.searchResult}>
                    <Text style={styles.searchFileName}>{file.path}</Text>
                    {file.content.split('\n')
                      .map((line, idx) => ({ line, idx }))
                      .filter(({ line }) => line.toLowerCase().includes(searchQuery.toLowerCase()))
                      .slice(0, 3)
                      .map(({ line, idx }) => (
                        <Text key={idx} style={styles.searchLine} numberOfLines={1}>
                          <Text style={styles.searchLineNum}>{idx + 1}: </Text>{line.trim()}
                        </Text>
                      ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {activeTab === 'terminal' && (
            <View style={styles.terminalPanel}>
              <ScrollView style={styles.terminalOutput} showsVerticalScrollIndicator={false}>
                <Text style={styles.terminalWelcome}>DevTools Terminal — "help" für Befehle</Text>
                {terminalHistory.map((entry, i) => (
                  <View key={i} style={styles.terminalEntry}>
                    <Text style={styles.terminalPrompt}>{'> '}{entry.input}</Text>
                    <Text style={styles.terminalResult}>{entry.output}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.terminalInputRow}>
                <Text style={styles.terminalPromptChar}>{'>'}</Text>
                <TextInput
                  style={styles.terminalInputField}
                  value={terminalInput}
                  onChangeText={setTerminalInput}
                  onSubmitEditing={handleTerminalCommand}
                  placeholder="Befehl..."
                  placeholderTextColor={theme.colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="send"
                />
              </View>
            </View>
          )}

          {activeTab === 'info' && (
            <ScrollView style={styles.infoPanel} showsVerticalScrollIndicator={false}>
              {currentProject ? (
                <>
                  {[
                    ['Projekt', currentProject.name],
                    ['Typ', currentProject.type],
                    ['Status', currentProject.status],
                    ['Dateien', String(currentProject.files.length)],
                    ['Projekte', String(state.projects.length)],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.infoCard}>
                      <Text style={styles.infoLabel}>{label}</Text>
                      <Text style={styles.infoValue}>{value}</Text>
                    </View>
                  ))}
                  <View style={styles.infoSection}>
                    <View style={styles.pathItem}>
                      <HardDrive size={11} color={theme.colors.textTertiary} />
                      <Text style={styles.pathText}>Backend: /home/user/rork-app</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.emptyState}>
                  <Info size={28} color={theme.colors.textTertiary} />
                  <Text style={styles.emptyText}>Kein Projekt</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    maxHeight: 300,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabLabel: {
    fontSize: 10,
    color: theme.colors.textTertiary,
  },
  tabLabelActive: {
    color: theme.colors.primary,
    fontWeight: '600' as const,
  },
  body: {
    flex: 1,
  },
  fileList: {
    flex: 1,
    padding: 6,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 6,
    gap: 6,
  },
  fileIcon: {
    fontSize: 13,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 11,
    color: theme.colors.text,
    fontFamily: 'monospace',
  },
  fileMeta: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
  searchPanel: {
    flex: 1,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    margin: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    gap: 5,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 12,
    paddingVertical: 7,
  },
  searchResults: {
    flex: 1,
    padding: 6,
  },
  searchResult: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 6,
    marginBottom: 4,
  },
  searchFileName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: theme.colors.primary,
    marginBottom: 3,
  },
  searchLine: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
  },
  searchLineNum: {
    color: theme.colors.textTertiary,
  },
  terminalPanel: {
    flex: 1,
    backgroundColor: theme.colors.codeBackground,
  },
  terminalOutput: {
    flex: 1,
    padding: 8,
  },
  terminalWelcome: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.colors.textTertiary,
    marginBottom: 6,
  },
  terminalEntry: {
    marginBottom: 5,
  },
  terminalPrompt: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.primary,
  },
  terminalResult: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: theme.colors.codeText,
    marginTop: 1,
  },
  terminalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 5,
  },
  terminalPromptChar: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: '700' as const,
  },
  terminalInputField: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    color: theme.colors.codeText,
    paddingVertical: 5,
  },
  infoPanel: {
    flex: 1,
    padding: 8,
  },
  infoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  infoLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  infoValue: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  infoSection: {
    marginTop: 8,
  },
  pathItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
  },
  pathText: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    fontFamily: 'monospace',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
  },
  emptyText: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    marginTop: 6,
  },
});
