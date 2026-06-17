import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  FolderOpen,
  File,
  FilePlus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  X,
  Save,
  Trash2,
  Code,
  Copy,
} from 'lucide-react-native';
import { useStorage } from '@/providers/StorageProvider';
import { theme } from '@/constants/theme';
import { getFileIcon, getFileLanguage } from '@/utils/helpers';
import { ProjectFile } from '@/types';

export default function WorkspaceScreen() {
  const {
    currentProject,
    state,
    addFileToProject,
    updateFileInProject,
    deleteFileFromProject,
    openFile,
    closeFile,
    setActiveFile,
  } = useStorage();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editedContent, setEditedContent] = useState<string>('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<'file' | 'folder'>('file');

  const activeFile = useMemo(() => {
    if (!currentProject || !state.workspace.activeFileId) return null;
    return currentProject.files.find(f => f.id === state.workspace.activeFileId) || null;
  }, [currentProject, state.workspace.activeFileId]);

  const openFiles = useMemo(() => {
    if (!currentProject) return [];
    return state.workspace.openFiles
      .map(id => currentProject.files.find(f => f.id === id))
      .filter(Boolean) as ProjectFile[];
  }, [currentProject, state.workspace.openFiles]);

  const fileTree = useMemo(() => {
    if (!currentProject) return [];
    return [...currentProject.files].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [currentProject]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleFileSelect = (file: ProjectFile) => {
    if (file.type === 'folder') {
      toggleFolder(file.id);
    } else {
      openFile(file.id);
      setEditedContent(file.content);
    }
  };

  const handleSaveFile = () => {
    if (activeFile && currentProject) {
      updateFileInProject(currentProject.id, activeFile.id, { content: editedContent });
      Alert.alert('Gespeichert', 'Datei gespeichert');
    }
  };

  const handleDeleteFile = (file: ProjectFile) => {
    if (!currentProject) return;
    Alert.alert('Löschen', `"${file.name}" löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => deleteFileFromProject(currentProject.id, file.id) },
    ]);
  };

  const handleCreateFile = () => {
    if (!currentProject || !newFileName.trim()) return;
    const path = newFileName.trim();
    const name = path.split('/').pop() || path;
    addFileToProject(currentProject.id, {
      path,
      name,
      content: '',
      type: newFileType,
      language: newFileType === 'file' ? getFileLanguage(name) : undefined,
    });
    setNewFileName('');
    setShowNewFileModal(false);
  };

  const renderLineNumbers = () => {
    const lines = editedContent.split('\n');
    return lines.map((_, index) => (
      <Text key={index} style={styles.lineNumber}>{index + 1}</Text>
    ));
  };

  if (!currentProject) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.noProjectContainer}>
          <FolderOpen size={56} color={theme.colors.textTertiary} />
          <Text style={styles.noProjectTitle}>Kein Projekt</Text>
          <Text style={styles.noProjectSubtitle}>Wähle ein Projekt unter Projekte aus</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Code size={20} color={theme.colors.primary} />
          <Text style={styles.headerTitle} numberOfLines={1}>{currentProject.name}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={() => { setNewFileType('file'); setShowNewFileModal(true); }}>
            <FilePlus size={18} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={() => { setNewFileType('folder'); setShowNewFileModal(true); }}>
            <FolderPlus size={18} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.sidebar}>
          <Text style={styles.sidebarTitle}>DATEIEN</Text>
          <ScrollView style={styles.fileTree} showsVerticalScrollIndicator={false}>
            {fileTree.map(file => (
              <TouchableOpacity
                key={file.id}
                style={[styles.fileItem, activeFile?.id === file.id && styles.fileItemActive]}
                onPress={() => handleFileSelect(file)}
                onLongPress={() => handleDeleteFile(file)}
              >
                {file.type === 'folder' ? (
                  expandedFolders.has(file.id) ? (
                    <ChevronDown size={14} color={theme.colors.textSecondary} />
                  ) : (
                    <ChevronRight size={14} color={theme.colors.textSecondary} />
                  )
                ) : (
                  <Text style={styles.fileIconText}>{getFileIcon(file.name)}</Text>
                )}
                <Text style={[styles.fileName, activeFile?.id === file.id && styles.fileNameActive]} numberOfLines={1}>
                  {file.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.editor}>
          {openFiles.length > 0 && (
            <ScrollView horizontal style={styles.tabs} showsHorizontalScrollIndicator={false}>
              {openFiles.map(file => (
                <TouchableOpacity
                  key={file.id}
                  style={[styles.tab, activeFile?.id === file.id && styles.tabActive]}
                  onPress={() => { setActiveFile(file.id); setEditedContent(file.content); }}
                >
                  <Text style={[styles.tabText, activeFile?.id === file.id && styles.tabTextActive]} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <TouchableOpacity style={styles.tabClose} onPress={() => closeFile(file.id)}>
                    <X size={12} color={theme.colors.textTertiary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {activeFile ? (
            <View style={styles.editorContent}>
              <View style={styles.editorToolbar}>
                <Text style={styles.editorPath}>{activeFile.path}</Text>
                <View style={styles.editorActions}>
                  <TouchableOpacity style={styles.editorButton} onPress={() => Alert.alert('Kopiert', 'Inhalt kopiert')}>
                    <Copy size={16} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editorButton} onPress={handleSaveFile}>
                    <Save size={16} color={theme.colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editorButton} onPress={() => handleDeleteFile(activeFile)}>
                    <Trash2 size={16} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.codeContainer}>
                <View style={styles.lineNumbers}>{renderLineNumbers()}</View>
                <ScrollView style={styles.codeScroll} horizontal>
                  <TextInput
                    style={styles.codeInput}
                    value={editedContent}
                    onChangeText={setEditedContent}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textAlignVertical="top"
                  />
                </ScrollView>
              </View>
            </View>
          ) : (
            <View style={styles.noFileContainer}>
              <File size={40} color={theme.colors.textTertiary} />
              <Text style={styles.noFileText}>Wähle eine Datei</Text>
            </View>
          )}
        </View>
      </View>

      {showNewFileModal && (
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowNewFileModal(false)} activeOpacity={1} />
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{newFileType === 'file' ? 'Neue Datei' : 'Neuer Ordner'}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={newFileType === 'file' ? 'datei.tsx' : 'ordnername'}
              placeholderTextColor={theme.colors.textTertiary}
              value={newFileName}
              onChangeText={setNewFileName}
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setShowNewFileModal(false)}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreateButton} onPress={handleCreateFile}>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '600' as const, color: theme.colors.text },
  headerActions: { flexDirection: 'row', gap: 6 },
  headerButton: { width: 36, height: 36, borderRadius: 9, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 180, backgroundColor: theme.colors.backgroundSecondary, borderRightWidth: 1, borderRightColor: theme.colors.border },
  sidebarTitle: { fontSize: 10, fontWeight: '700' as const, color: theme.colors.textTertiary, letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 8 },
  fileTree: { flex: 1 },
  fileItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, gap: 6 },
  fileItemActive: { backgroundColor: theme.colors.primaryMuted },
  fileIconText: { fontSize: 13 },
  fileName: { flex: 1, fontSize: 12, color: theme.colors.textSecondary },
  fileNameActive: { color: theme.colors.primary, fontWeight: '500' as const },
  editor: { flex: 1, backgroundColor: theme.colors.codeBackground },
  tabs: { flexDirection: 'row', backgroundColor: theme.colors.backgroundSecondary, borderBottomWidth: 1, borderBottomColor: theme.colors.border, maxHeight: 36 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRightWidth: 1, borderRightColor: theme.colors.border, gap: 6 },
  tabActive: { backgroundColor: theme.colors.codeBackground },
  tabText: { fontSize: 12, color: theme.colors.textTertiary, maxWidth: 90 },
  tabTextActive: { color: theme.colors.text },
  tabClose: { padding: 2 },
  editorContent: { flex: 1 },
  editorToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.colors.backgroundTertiary, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  editorPath: { fontSize: 11, color: theme.colors.textTertiary, fontFamily: 'monospace' },
  editorActions: { flexDirection: 'row', gap: 10 },
  editorButton: { padding: 3 },
  codeContainer: { flex: 1, flexDirection: 'row' },
  lineNumbers: { paddingHorizontal: 10, paddingTop: 10, backgroundColor: theme.colors.backgroundTertiary, borderRightWidth: 1, borderRightColor: theme.colors.border },
  lineNumber: { fontSize: 12, fontFamily: 'monospace', color: theme.colors.textTertiary, lineHeight: 20, textAlign: 'right', minWidth: 22 },
  codeScroll: { flex: 1 },
  codeInput: { flex: 1, padding: 10, color: theme.colors.codeText, fontSize: 13, fontFamily: 'monospace', lineHeight: 20, minWidth: '100%' as unknown as number },
  noFileContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noFileText: { fontSize: 13, color: theme.colors.textTertiary, marginTop: 10 },
  noProjectContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  noProjectTitle: { fontSize: 18, fontWeight: '600' as const, color: theme.colors.text, marginTop: 16 },
  noProjectSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 6, textAlign: 'center' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' },
  modal: { width: '90%', maxWidth: 380, backgroundColor: theme.colors.backgroundSecondary, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: theme.colors.border },
  modalTitle: { fontSize: 17, fontWeight: '600' as const, color: theme.colors.text, marginBottom: 14 },
  modalInput: { backgroundColor: theme.colors.surface, borderRadius: 10, padding: 12, color: theme.colors.text, fontSize: 14, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 14 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelButton: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: theme.colors.surface, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '500' as const, color: theme.colors.textSecondary },
  modalCreateButton: { flex: 1, paddingVertical: 11, borderRadius: 10, backgroundColor: theme.colors.primary, alignItems: 'center' },
  modalCreateText: { fontSize: 14, fontWeight: '500' as const, color: '#fff' },
});
