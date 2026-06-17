import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  FolderPlus,
  Smartphone,
  Globe,
  Server,
  Layers,
  Search,
  Trash2,
  Download,
  FileCode,
  Shield,
  HardDrive,
  RefreshCw,
  CheckCircle,
  Database,
  Archive,
  Copy,
} from 'lucide-react-native';
import { useStorage } from '@/providers/StorageProvider';
import { useConnectionGuard } from '@/providers/ConnectionGuard';
import { theme } from '@/constants/theme';
import { formatTimestamp, generateId, getFileLanguage } from '@/utils/helpers';
import { Project } from '@/types';
import {
  APP_SOURCE_REGISTRY,
  generateArchitectureDoc,
  generateDependencyDoc,
} from '@/constants/sourceRegistry';

export default function ProjectsScreen() {
  const {
    state,
    createProject,
    deleteProject,
    setCurrentProject,
    currentProject,
    addFileToProject,
    updateProject,
    getAllMemory,
  } = useStorage();
  const { status: guardStatus } = useConnectionGuard();

  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectType, setNewProjectType] = useState<Project['type']>('react-native');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const backupPulse = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (isBackingUp) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(backupPulse, { toValue: 1, duration: 600, useNativeDriver: false }),
          Animated.timing(backupPulse, { toValue: 0, duration: 600, useNativeDriver: false }),
        ])
      ).start();
    } else {
      backupPulse.stopAnimation();
      backupPulse.setValue(0);
    }
  }, [isBackingUp, backupPulse]);

  useEffect(() => {
    if (backupSuccess) {
      Animated.sequence([
        Animated.spring(successScale, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(successScale, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setBackupSuccess(false));
    }
  }, [backupSuccess, successScale]);

  const filteredProjects = state.projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getProjectIcon = (type: Project['type']) => {
    const map = {
      'react-native': <Smartphone size={22} color={theme.colors.primary} />,
      'web': <Globe size={22} color={theme.colors.accent} />,
      'api': <Server size={22} color={theme.colors.secondary} />,
      'fullstack': <Layers size={22} color={theme.colors.warning} />,
    };
    return map[type];
  };

  const getStatusColor = (status: Project['status']) => {
    const map = { draft: theme.colors.textTertiary, building: theme.colors.warning, completed: theme.colors.success, error: theme.colors.error };
    return map[status];
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Namen ein');
      return;
    }
    createProject(newProjectName.trim(), newProjectType);
    setNewProjectName('');
    setShowCreateModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleFullBackup = useCallback(async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      console.log('[Projects] Starting full app backup...');
      const timestamp = new Date().toLocaleDateString('de-DE') + ' ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const backupProject = createProject(`App Backup ${timestamp}`, 'fullstack', 'Vollständiges App-Backup (Frontend + Backend + Config)');

      const archDoc = generateArchitectureDoc();
      addFileToProject(backupProject.id, {
        path: 'ARCHITECTURE.md',
        name: 'ARCHITECTURE.md',
        content: archDoc,
        type: 'file',
        language: 'markdown',
      });

      const depDoc = generateDependencyDoc();
      addFileToProject(backupProject.id, {
        path: 'package.json',
        name: 'package.json',
        content: depDoc,
        type: 'file',
        language: 'json',
      });

      for (const entry of APP_SOURCE_REGISTRY) {
        addFileToProject(backupProject.id, {
          path: entry.path,
          name: entry.path.split('/').pop() || entry.path,
          content: `// ${entry.description}\n// Kategorie: ${entry.category}\n// Pfad: ${entry.path}\n// Backup erstellt: ${timestamp}`,
          type: 'file',
          language: getFileLanguage(entry.path.split('/').pop() || ''),
        });
      }

      const memory = getAllMemory();
      const memoryKeys = Object.keys(memory);
      if (memoryKeys.length > 0) {
        let memoryDoc = `# KI Memory Backup\n## ${memoryKeys.length} Erinnerungen\n\n`;
        for (const key of memoryKeys) {
          memoryDoc += `### ${key}\n${memory[key]}\n\n`;
        }
        addFileToProject(backupProject.id, {
          path: 'backup/ai-memory.md',
          name: 'ai-memory.md',
          content: memoryDoc,
          type: 'file',
          language: 'markdown',
        });
      }

      const existingProjects = state.projects.filter(p => p.id !== backupProject.id);
      if (existingProjects.length > 0) {
        let projectsDoc = `# Projekte Backup\n## ${existingProjects.length} Projekte\n\n`;
        for (const p of existingProjects) {
          projectsDoc += `### ${p.name}\n`;
          projectsDoc += `- Typ: ${p.type}\n`;
          projectsDoc += `- Status: ${p.status}\n`;
          projectsDoc += `- Dateien: ${p.files.length}\n`;
          projectsDoc += `- Erstellt: ${new Date(p.createdAt).toLocaleDateString('de-DE')}\n\n`;
        }
        addFileToProject(backupProject.id, {
          path: 'backup/projects-overview.md',
          name: 'projects-overview.md',
          content: projectsDoc,
          type: 'file',
          language: 'markdown',
        });
      }

      const convs = state.conversations;
      if (convs.length > 0) {
        let convsDoc = `# Chat-Verlauf Backup\n## ${convs.length} Konversationen\n\n`;
        for (const c of convs.slice(0, 50)) {
          convsDoc += `### ${c.title}\n`;
          convsDoc += `- ID: ${c.id}\n`;
          convsDoc += `- Nachrichten: ${c.messages.length}\n`;
          convsDoc += `- Erstellt: ${new Date(c.createdAt).toLocaleDateString('de-DE')}\n`;
          convsDoc += `- Aktualisiert: ${new Date(c.updatedAt).toLocaleDateString('de-DE')}\n\n`;
        }
        addFileToProject(backupProject.id, {
          path: 'backup/conversations.md',
          name: 'conversations.md',
          content: convsDoc,
          type: 'file',
          language: 'markdown',
        });
      }

      let protectionDoc = `# Schutz-Status\n\n`;
      protectionDoc += `- SDK: ${guardStatus.sdk}\n`;
      protectionDoc += `- Storage: ${guardStatus.storage}\n`;
      protectionDoc += `- Tools: ${guardStatus.tools}\n`;
      protectionDoc += `- Second Agent: ${guardStatus.secondAgent}\n`;
      protectionDoc += `- Geschützt: ${guardStatus.isProtected ? 'Ja' : 'Nein'}\n`;
      protectionDoc += `- Verschlüsselung: ${guardStatus.encryptionActive ? 'Aktiv' : 'Bereit'}\n`;
      protectionDoc += `- Letzter Health-Check: ${new Date(guardStatus.lastHealthCheck).toLocaleString('de-DE')}\n`;
      addFileToProject(backupProject.id, {
        path: 'backup/protection-status.md',
        name: 'protection-status.md',
        content: protectionDoc,
        type: 'file',
        language: 'markdown',
      });

      updateProject(backupProject.id, { status: 'completed' });
      setCurrentProject(backupProject.id);

      console.log('[Projects] Full backup completed');
      setIsBackingUp(false);
      setBackupSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    } catch (e) {
      console.error('[Projects] Backup failed:', e);
      setIsBackingUp(false);
      Alert.alert('Fehler', 'Backup konnte nicht erstellt werden.');
    }
  }, [isBackingUp, createProject, addFileToProject, updateProject, setCurrentProject, getAllMemory, state, guardStatus]);

  const handleExportProject = (project: Project) => {
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      Alert.alert('Export', `"${project.name}" exportiert (${project.files.length} Dateien)`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.error('[Projects] Export error:', e);
    }
  };

  const handleDeleteProject = (project: Project) => {
    Alert.alert('Löschen', `"${project.name}" wirklich löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen', style: 'destructive', onPress: () => {
          deleteProject(project.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      },
    ]);
  };

  const handleDuplicateProject = useCallback((project: Project) => {
    try {
      const cloned = createProject(`${project.name} (Kopie)`, project.type, project.description);
      for (const file of project.files) {
        addFileToProject(cloned.id, {
          path: file.path,
          name: file.name,
          content: file.content,
          type: file.type,
          language: file.language,
        });
      }
      updateProject(cloned.id, { status: project.status });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert('Dupliziert', `"${project.name}" wurde kopiert.`);
    } catch (e) {
      console.error('[Projects] Duplicate error:', e);
    }
  }, [createProject, addFileToProject, updateProject]);

  const projectTypes: { type: Project['type']; label: string; icon: React.ReactNode }[] = [
    { type: 'react-native', label: 'React Native', icon: <Smartphone size={18} color={theme.colors.primary} /> },
    { type: 'web', label: 'Web', icon: <Globe size={18} color={theme.colors.accent} /> },
    { type: 'api', label: 'API', icon: <Server size={18} color={theme.colors.secondary} /> },
    { type: 'fullstack', label: 'Fullstack', icon: <Layers size={18} color={theme.colors.warning} /> },
  ];

  const totalFiles = state.projects.reduce((acc, p) => acc + p.files.length, 0);
  const totalSize = state.projects.reduce((acc, p) =>
    acc + p.files.reduce((a, f) => a + (f.content?.length || 0), 0), 0
  );

  const backupBorderColor = backupPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.accent + '40', theme.colors.accent],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.headerWrap, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Projekte</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.createButton} onPress={() => setShowCreateModal(true)} activeOpacity={0.7}>
              <FolderPlus size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statChip}>
            <Database size={12} color={theme.colors.primary} />
            <Text style={styles.statText}>{state.projects.length} Projekte</Text>
          </View>
          <View style={styles.statChip}>
            <FileCode size={12} color={theme.colors.accent} />
            <Text style={styles.statText}>{totalFiles} Dateien</Text>
          </View>
          <View style={styles.statChip}>
            <HardDrive size={12} color={theme.colors.secondary} />
            <Text style={styles.statText}>{(totalSize / 1024).toFixed(1)} KB</Text>
          </View>
          {guardStatus.isProtected && (
            <View style={[styles.statChip, styles.protectedChip]}>
              <Shield size={12} color={theme.colors.accent} />
              <Text style={[styles.statText, styles.protectedText]}>Geschützt</Text>
            </View>
          )}
        </View>

        <Animated.View style={[styles.backupCard, { borderColor: isBackingUp ? backupBorderColor : theme.colors.accent + '30' }]}>
          <View style={styles.backupInfo}>
            <Archive size={20} color={theme.colors.accent} />
            <View style={styles.backupTextWrap}>
              <Text style={styles.backupTitle}>Vollständiges App-Backup</Text>
              <Text style={styles.backupSubtitle}>Frontend, Backend, Config, Memory, Chats</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.backupButton, isBackingUp && styles.backupButtonDisabled]}
            onPress={handleFullBackup}
            disabled={isBackingUp}
            activeOpacity={0.7}
          >
            {isBackingUp ? (
              <RefreshCw size={16} color="#fff" />
            ) : (
              <Download size={16} color="#fff" />
            )}
            <Text style={styles.backupButtonText}>
              {isBackingUp ? 'Sichern...' : 'Backup'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {backupSuccess && (
          <Animated.View style={[styles.successBanner, { transform: [{ scale: successScale }] }]}>
            <CheckCircle size={16} color={theme.colors.success} />
            <Text style={styles.successText}>Backup erfolgreich erstellt!</Text>
          </Animated.View>
        )}

        <View style={styles.searchContainer}>
          <Search size={18} color={theme.colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Suchen..."
            placeholderTextColor={theme.colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {filteredProjects.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FileCode size={56} color={theme.colors.textTertiary} />
            <Text style={styles.emptyTitle}>Keine Projekte</Text>
            <Text style={styles.emptySubtitle}>Erstelle ein Projekt oder nutze das Backup!</Text>
          </View>
        ) : (
          filteredProjects.map(project => (
            <TouchableOpacity
              key={project.id}
              style={[styles.projectCard, currentProject?.id === project.id && styles.projectCardActive]}
              onPress={() => {
                setCurrentProject(project.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.projectIcon}>{getProjectIcon(project.type)}</View>
              <View style={styles.projectInfo}>
                <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
                <View style={styles.projectMeta}>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(project.status) + '15' }]}>
                    <View style={[styles.statusDot, { backgroundColor: getStatusColor(project.status) }]} />
                    <Text style={[styles.statusText, { color: getStatusColor(project.status) }]}>{project.status}</Text>
                  </View>
                  <Text style={styles.fileCount}>{project.files.length} Dateien</Text>
                </View>
                <Text style={styles.projectDate}>{formatTimestamp(project.updatedAt)}</Text>
              </View>
              <View style={styles.projectActions}>
                <TouchableOpacity style={styles.actionButton} onPress={() => handleDuplicateProject(project)}>
                  <Copy size={14} color={theme.colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton} onPress={() => handleExportProject(project)}>
                  <Download size={14} color={theme.colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton} onPress={() => handleDeleteProject(project)}>
                  <Trash2 size={14} color={theme.colors.error} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {showCreateModal && (
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowCreateModal(false)} activeOpacity={1} />
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Neues Projekt</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Projektname"
              placeholderTextColor={theme.colors.textTertiary}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus
            />
            <Text style={styles.modalLabel}>Typ</Text>
            <View style={styles.typeGrid}>
              {projectTypes.map(pt => (
                <TouchableOpacity
                  key={pt.type}
                  style={[styles.typeOption, newProjectType === pt.type && styles.typeOptionActive]}
                  onPress={() => setNewProjectType(pt.type)}
                >
                  {pt.icon}
                  <Text style={[styles.typeLabel, newProjectType === pt.type && styles.typeLabelActive]}>{pt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreateButton} onPress={handleCreateProject}>
                <Text style={styles.modalCreateText}>Erstellen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  headerWrap: {},
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '700' as const, color: theme.colors.text },
  headerActions: { flexDirection: 'row', gap: 8 },
  createButton: { width: 42, height: 42, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 6, marginBottom: 10 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  statText: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '500' as const },
  protectedChip: { backgroundColor: theme.colors.accentGlow, borderColor: theme.colors.accent + '30' },
  protectedText: { color: theme.colors.accent },
  backupCard: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.accentGlow, borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  backupInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  backupTextWrap: { flex: 1 },
  backupTitle: { fontSize: 13, fontWeight: '600' as const, color: theme.colors.text },
  backupSubtitle: { fontSize: 10, color: theme.colors.textSecondary, marginTop: 1 },
  backupButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  backupButtonDisabled: { opacity: 0.6 },
  backupButtonText: { fontSize: 12, fontWeight: '600' as const, color: '#fff' },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(34, 197, 94, 0.08)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.2)' },
  successText: { fontSize: 12, color: theme.colors.success, fontWeight: '500' as const },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, marginHorizontal: 20, borderRadius: 12, paddingHorizontal: 14, height: 44, marginBottom: 12, gap: 8 },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14 },
  content: { flex: 1, paddingHorizontal: 20 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: theme.colors.text, marginTop: 16 },
  emptySubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 6, textAlign: 'center' },
  projectCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.border },
  projectCardActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryMuted },
  projectIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.backgroundTertiary, alignItems: 'center', justifyContent: 'center' },
  projectInfo: { flex: 1, marginLeft: 12 },
  projectName: { fontSize: 15, fontWeight: '600' as const, color: theme.colors.text },
  projectMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, gap: 4 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '500' as const, textTransform: 'capitalize' as const },
  fileCount: { fontSize: 11, color: theme.colors.textTertiary },
  projectDate: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 3 },
  projectActions: { flexDirection: 'row', gap: 5 },
  actionButton: { width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.backgroundTertiary, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' },
  modal: { width: '90%', maxWidth: 380, backgroundColor: theme.colors.backgroundSecondary, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 18 },
  modalInput: { backgroundColor: theme.colors.surface, borderRadius: 12, padding: 13, color: theme.colors.text, fontSize: 15, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 18 },
  modalLabel: { fontSize: 13, fontWeight: '500' as const, color: theme.colors.textSecondary, marginBottom: 10 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  typeOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, gap: 6 },
  typeOptionActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryMuted },
  typeLabel: { fontSize: 12, color: theme.colors.textSecondary },
  typeLabelActive: { color: theme.colors.primary },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelButton: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: theme.colors.surface, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600' as const, color: theme.colors.textSecondary },
  modalCreateButton: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center' },
  modalCreateText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
});
