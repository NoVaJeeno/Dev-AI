import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  FolderOpen,
  File,
  FilePlus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Search,
  Save,
  Trash2,
  Copy,
  Edit3,
  Download,
  Upload,
  RefreshCw,
  MoreVertical,
  X,
  FileText,
  FileCode,
  Image,
  Settings2,
  ArrowUpDown,
  Filter,
} from 'lucide-react-native';
import { useStorage } from '@/providers/StorageProvider';
import { theme } from '@/constants/theme';
import { getFileIcon, getFileLanguage, formatFileSize } from '@/utils/helpers';
import { ProjectFile } from '@/types';

type SortMode = 'name' | 'date' | 'size' | 'type';
type ViewMode = 'tree' | 'list';

export default function FileManagerScreen() {
  const {
    currentProject,
    state,
    addFileToProject,
    updateFileInProject,
    deleteFileFromProject,
    setCurrentProject,
  } = useStorage();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<'file' | 'folder'>('file');
  const [renameTarget, setRenameTarget] = useState<ProjectFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const sortedFiles = useMemo(() => {
    if (!currentProject) return [];
    let files = [...currentProject.files];

    if (searchQuery) {
      files = files.filter(f =>
        f.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      switch (sortMode) {
        case 'name': return a.path.localeCompare(b.path);
        case 'date': return b.updatedAt - a.updatedAt;
        case 'size': return b.content.length - a.content.length;
        case 'type': return (a.language || '').localeCompare(b.language || '');
        default: return 0;
      }
    });
    return files;
  }, [currentProject, searchQuery, sortMode]);

  const folderStructure = useMemo(() => {
    const folders = new Map<string, ProjectFile[]>();
    folders.set('', []);
    for (const file of sortedFiles) {
      const parts = file.path.split('/');
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!folders.has(parentPath)) folders.set(parentPath, []);
      folders.get(parentPath)!.push(file);
    }
    return folders;
  }, [sortedFiles]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((file: ProjectFile) => {
    if (file.type === 'folder') {
      toggleFolder(file.path);
    } else {
      setSelectedFile(file);
      setEditingContent(file.content);
      setIsEditing(false);
    }
  }, [toggleFolder]);

  const handleSaveFile = useCallback(() => {
    if (selectedFile && currentProject) {
      updateFileInProject(currentProject.id, selectedFile.id, { content: editingContent });
      setIsEditing(false);
      console.log('[FileManager] File saved:', selectedFile.path);
    }
  }, [selectedFile, currentProject, editingContent, updateFileInProject]);

  const handleDeleteFile = useCallback((file: ProjectFile) => {
    if (!currentProject) return;
    Alert.alert('Datei löschen', `"${file.name}" wirklich löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          deleteFileFromProject(currentProject.id, file.id);
          if (selectedFile?.id === file.id) {
            setSelectedFile(null);
            setIsEditing(false);
          }
          console.log('[FileManager] File deleted:', file.path);
        },
      },
    ]);
  }, [currentProject, selectedFile, deleteFileFromProject]);

  const handleCreateFile = useCallback(() => {
    if (!currentProject || !newFileName.trim()) return;
    const path = newFileName.trim();
    const name = path.split('/').pop() || path;
    addFileToProject(currentProject.id, {
      path,
      name,
      content: newFileType === 'file' ? '' : '',
      type: newFileType,
      language: newFileType === 'file' ? getFileLanguage(name) : undefined,
    });
    setNewFileName('');
    setShowCreateModal(false);
    console.log('[FileManager] Created:', path);
  }, [currentProject, newFileName, newFileType, addFileToProject]);

  const handleRenameFile = useCallback(() => {
    if (!currentProject || !renameTarget || !renameValue.trim()) return;
    const newName = renameValue.trim().split('/').pop() || renameValue.trim();
    updateFileInProject(currentProject.id, renameTarget.id, {
      path: renameValue.trim(),
      name: newName,
      language: getFileLanguage(newName),
    });
    setShowRenameModal(false);
    setRenameTarget(null);
    console.log('[FileManager] Renamed to:', renameValue.trim());
  }, [currentProject, renameTarget, renameValue, updateFileInProject]);

  const handleDuplicateFile = useCallback((file: ProjectFile) => {
    if (!currentProject) return;
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const base = file.name.replace(ext, '');
    const newPath = file.path.replace(file.name, `${base}_copy${ext}`);
    const newName = `${base}_copy${ext}`;
    addFileToProject(currentProject.id, {
      path: newPath,
      name: newName,
      content: file.content,
      type: file.type,
      language: file.language,
    });
    console.log('[FileManager] Duplicated:', file.path, '->', newPath);
  }, [currentProject, addFileToProject]);

  const handleExportFile = useCallback((file: ProjectFile) => {
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([file.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('[FileManager] Export error:', e);
      }
    }
    Alert.alert('Exportiert', `"${file.name}" exportiert`);
  }, []);

  const handleExportProject = useCallback(() => {
    if (!currentProject) return;
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([JSON.stringify(currentProject, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProject.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('[FileManager] Project export error:', e);
      }
    }
    Alert.alert('Projekt exportiert', `${currentProject.files.length} Dateien exportiert`);
  }, [currentProject]);

  const startRename = useCallback((file: ProjectFile) => {
    setRenameTarget(file);
    setRenameValue(file.path);
    setShowRenameModal(true);
  }, []);

  const getFileTypeIcon = useCallback((file: ProjectFile) => {
    if (file.type === 'folder') return <FolderOpen size={16} color={theme.colors.warning} />;
    const lang = file.language || '';
    if (['typescript', 'javascript'].includes(lang)) return <FileCode size={16} color={theme.colors.primary} />;
    if (['css', 'html'].includes(lang)) return <FileCode size={16} color={theme.colors.accent} />;
    if (['json', 'yaml'].includes(lang)) return <Settings2 size={16} color={theme.colors.secondary} />;
    if (['markdown'].includes(lang)) return <FileText size={16} color={theme.colors.textSecondary} />;
    return <File size={16} color={theme.colors.textTertiary} />;
  }, []);

  const renderFileItem = useCallback((file: ProjectFile, depth: number = 0) => {
    const isSelected = selectedFile?.id === file.id;
    const isFolder = file.type === 'folder';
    const isExpanded = expandedFolders.has(file.path);

    return (
      <View key={file.id}>
        <TouchableOpacity
          style={[
            styles.fileRow,
            isSelected && styles.fileRowSelected,
            { paddingLeft: 14 + depth * 16 },
          ]}
          onPress={() => handleSelectFile(file)}
          onLongPress={() => {
            Alert.alert(file.name, 'Aktion wählen', [
              { text: 'Umbenennen', onPress: () => startRename(file) },
              { text: 'Duplizieren', onPress: () => handleDuplicateFile(file) },
              { text: 'Exportieren', onPress: () => handleExportFile(file) },
              { text: 'Löschen', style: 'destructive', onPress: () => handleDeleteFile(file) },
              { text: 'Abbrechen', style: 'cancel' },
            ]);
          }}
          activeOpacity={0.6}
          testID={`file-${file.path}`}
        >
          {isFolder && (
            isExpanded
              ? <ChevronDown size={14} color={theme.colors.textSecondary} />
              : <ChevronRight size={14} color={theme.colors.textSecondary} />
          )}
          <View style={styles.fileRowIcon}>{getFileTypeIcon(file)}</View>
          <View style={styles.fileRowInfo}>
            <Text style={[styles.fileRowName, isSelected && styles.fileRowNameActive]} numberOfLines={1}>
              {file.name}
            </Text>
            {!isFolder && (
              <Text style={styles.fileRowMeta}>
                {file.content.split('\n').length} Zeilen · {formatFileSize(file.content.length)}
              </Text>
            )}
          </View>
          {!isFolder && (
            <TouchableOpacity
              style={styles.fileRowAction}
              onPress={() => {
                Alert.alert(file.name, '', [
                  { text: 'Umbenennen', onPress: () => startRename(file) },
                  { text: 'Duplizieren', onPress: () => handleDuplicateFile(file) },
                  { text: 'Löschen', style: 'destructive', onPress: () => handleDeleteFile(file) },
                  { text: 'Abbrechen', style: 'cancel' },
                ]);
              }}
            >
              <MoreVertical size={14} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
        {isFolder && isExpanded && (
          folderStructure.get(file.path)?.map(child => renderFileItem(child, depth + 1))
        )}
      </View>
    );
  }, [selectedFile, expandedFolders, handleSelectFile, getFileTypeIcon, startRename, handleDuplicateFile, handleExportFile, handleDeleteFile, folderStructure]);

  const projectStats = useMemo(() => {
    if (!currentProject) return null;
    const files = currentProject.files.filter(f => f.type === 'file');
    const totalLines = files.reduce((a, f) => a + f.content.split('\n').length, 0);
    const totalSize = files.reduce((a, f) => a + f.content.length, 0);
    return { fileCount: files.length, folderCount: currentProject.files.filter(f => f.type === 'folder').length, totalLines, totalSize };
  }, [currentProject]);

  if (!currentProject) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Animated.View style={[styles.emptyRoot, { opacity: fadeAnim }]}>
          <View style={styles.emptyIconWrap}>
            <FolderOpen size={48} color={theme.colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>Kein Projekt ausgewählt</Text>
          <Text style={styles.emptySubtitle}>Wähle ein Projekt aus der Projektliste</Text>
          {state.projects.length > 0 && (
            <View style={styles.projectQuickList}>
              <Text style={styles.quickListTitle}>PROJEKTE</Text>
              {state.projects.slice(0, 5).map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.quickProjectItem}
                  onPress={() => setCurrentProject(p.id)}
                  activeOpacity={0.7}
                >
                  <FolderOpen size={16} color={theme.colors.primary} />
                  <View style={styles.quickProjectInfo}>
                    <Text style={styles.quickProjectName}>{p.name}</Text>
                    <Text style={styles.quickProjectMeta}>{p.files.length} Dateien · {p.type}</Text>
                  </View>
                  <ChevronRight size={14} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={styles.projectSelector}
          onPress={() => setShowProjectPicker(!showProjectPicker)}
          activeOpacity={0.7}
        >
          <FolderOpen size={18} color={theme.colors.primary} />
          <Text style={styles.headerTitle} numberOfLines={1}>{currentProject.name}</Text>
          <ChevronDown size={14} color={theme.colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => { setNewFileType('file'); setShowCreateModal(true); }}
          >
            <FilePlus size={16} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => { setNewFileType('folder'); setShowCreateModal(true); }}
          >
            <FolderPlus size={16} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handleExportProject}>
            <Download size={16} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {showProjectPicker && (
        <View style={styles.projectDropdown}>
          {state.projects.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[styles.projectDropdownItem, p.id === currentProject.id && styles.projectDropdownActive]}
              onPress={() => { setCurrentProject(p.id); setShowProjectPicker(false); setSelectedFile(null); }}
            >
              <FolderOpen size={14} color={p.id === currentProject.id ? theme.colors.primary : theme.colors.textSecondary} />
              <Text style={[styles.projectDropdownText, p.id === currentProject.id && styles.projectDropdownTextActive]}>
                {p.name}
              </Text>
              <Text style={styles.projectDropdownMeta}>{p.files.length}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.toolbar}>
        <View style={styles.searchBar}>
          <Search size={14} color={theme.colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Dateien suchen..."
            placeholderTextColor={theme.colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={14} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const modes: SortMode[] = ['name', 'date', 'size', 'type'];
            const idx = modes.indexOf(sortMode);
            setSortMode(modes[(idx + 1) % modes.length]);
          }}
        >
          <ArrowUpDown size={13} color={theme.colors.textSecondary} />
          <Text style={styles.sortLabel}>{sortMode}</Text>
        </TouchableOpacity>
      </View>

      {projectStats && (
        <View style={styles.statsBar}>
          <Text style={styles.statItem}>{projectStats.fileCount} Dateien</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{projectStats.folderCount} Ordner</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{projectStats.totalLines} Zeilen</Text>
          <View style={styles.statDot} />
          <Text style={styles.statItem}>{formatFileSize(projectStats.totalSize)}</Text>
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.fileTree}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {folderStructure.get('')?.map(file => renderFileItem(file, 0))}
            {sortedFiles.length === 0 && (
              <View style={styles.noFiles}>
                <File size={32} color={theme.colors.textTertiary} />
                <Text style={styles.noFilesText}>
                  {searchQuery ? 'Keine Treffer' : 'Keine Dateien'}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>

        <View style={styles.editorPane}>
          {selectedFile ? (
            <>
              <View style={styles.editorHeader}>
                <View style={styles.editorHeaderLeft}>
                  <Text style={styles.editorFileName} numberOfLines={1}>{selectedFile.path}</Text>
                  <Text style={styles.editorFileMeta}>
                    {selectedFile.language || 'text'} · {selectedFile.content.split('\n').length} Zeilen
                  </Text>
                </View>
                <View style={styles.editorActions}>
                  {isEditing ? (
                    <TouchableOpacity style={styles.editorActionBtn} onPress={handleSaveFile}>
                      <Save size={15} color={theme.colors.accent} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.editorActionBtn} onPress={() => setIsEditing(true)}>
                      <Edit3 size={15} color={theme.colors.primary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.editorActionBtn} onPress={() => handleDuplicateFile(selectedFile)}>
                    <Copy size={15} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editorActionBtn} onPress={() => handleExportFile(selectedFile)}>
                    <Download size={15} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editorActionBtn} onPress={() => handleDeleteFile(selectedFile)}>
                    <Trash2 size={15} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.editorBody}>
                <ScrollView style={styles.lineNumberCol}>
                  {editingContent.split('\n').map((_, i) => (
                    <Text key={i} style={styles.lineNum}>{i + 1}</Text>
                  ))}
                </ScrollView>
                <ScrollView style={styles.codeCol} horizontal>
                  {isEditing ? (
                    <TextInput
                      style={styles.codeInput}
                      value={editingContent}
                      onChangeText={setEditingContent}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      textAlignVertical="top"
                    />
                  ) : (
                    <Text style={styles.codeText} selectable>{editingContent || '(leer)'}</Text>
                  )}
                </ScrollView>
              </View>
            </>
          ) : (
            <View style={styles.noFileSelected}>
              <FileText size={40} color={theme.colors.textTertiary} />
              <Text style={styles.noFileText}>Wähle eine Datei</Text>
              <Text style={styles.noFileSubtext}>Tippe auf eine Datei im Baum links</Text>
            </View>
          )}
        </View>
      </View>

      {showCreateModal && (
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowCreateModal(false)} activeOpacity={1} />
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{newFileType === 'file' ? 'Neue Datei' : 'Neuer Ordner'}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={newFileType === 'file' ? 'src/components/Button.tsx' : 'src/utils'}
              placeholderTextColor={theme.colors.textTertiary}
              value={newFileName}
              onChangeText={setNewFileName}
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreateBtn} onPress={handleCreateFile}>
                <Text style={styles.modalCreateText}>Erstellen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {showRenameModal && renameTarget && (
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalBackdrop} onPress={() => setShowRenameModal(false)} activeOpacity={1} />
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Umbenennen</Text>
            <Text style={styles.modalSubtitle}>Aktuell: {renameTarget.path}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Neuer Pfad"
              placeholderTextColor={theme.colors.textTertiary}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowRenameModal(false)}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreateBtn} onPress={handleRenameFile}>
                <Text style={styles.modalCreateText}>Umbenennen</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  projectSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingVertical: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: theme.colors.text,
    flex: 1,
  },
  headerActions: { flexDirection: 'row', gap: 6 },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectDropdown: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: 4,
  },
  projectDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  projectDropdownActive: { backgroundColor: theme.colors.primaryMuted },
  projectDropdownText: { flex: 1, fontSize: 13, color: theme.colors.text },
  projectDropdownTextActive: { color: theme.colors.primary, fontWeight: '600' as const },
  projectDropdownMeta: { fontSize: 11, color: theme.colors.textTertiary },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    gap: 6,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 13 },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
  },
  sortLabel: { fontSize: 11, color: theme.colors.textSecondary, textTransform: 'capitalize' as const },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  statItem: { fontSize: 10, color: theme.colors.textTertiary },
  statDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.colors.textTertiary },
  content: { flex: 1, flexDirection: 'row' },
  fileTree: {
    width: 200,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingRight: 10,
    gap: 6,
  },
  fileRowSelected: { backgroundColor: theme.colors.primaryMuted },
  fileRowIcon: { width: 20, alignItems: 'center' },
  fileRowInfo: { flex: 1 },
  fileRowName: { fontSize: 12, color: theme.colors.text },
  fileRowNameActive: { color: theme.colors.primary, fontWeight: '600' as const },
  fileRowMeta: { fontSize: 9, color: theme.colors.textTertiary, marginTop: 1 },
  fileRowAction: { padding: 4 },
  noFiles: { alignItems: 'center', paddingVertical: 40 },
  noFilesText: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 8 },
  editorPane: { flex: 1, backgroundColor: theme.colors.codeBackground },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.backgroundTertiary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  editorHeaderLeft: { flex: 1 },
  editorFileName: { fontSize: 12, color: theme.colors.text, fontFamily: 'monospace' },
  editorFileMeta: { fontSize: 10, color: theme.colors.textTertiary, marginTop: 2 },
  editorActions: { flexDirection: 'row', gap: 8 },
  editorActionBtn: { padding: 4 },
  editorBody: { flex: 1, flexDirection: 'row' },
  lineNumberCol: {
    paddingHorizontal: 8,
    paddingTop: 10,
    backgroundColor: theme.colors.backgroundTertiary,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  lineNum: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: theme.colors.textTertiary,
    lineHeight: 20,
    textAlign: 'right' as const,
    minWidth: 24,
  },
  codeCol: { flex: 1 },
  codeInput: {
    flex: 1,
    padding: 10,
    color: theme.colors.codeText,
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 20,
    minWidth: '100%' as unknown as number,
  },
  codeText: {
    padding: 10,
    color: theme.colors.codeText,
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  noFileSelected: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noFileText: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 12, fontWeight: '500' as const },
  noFileSubtext: { fontSize: 12, color: theme.colors.textTertiary, marginTop: 4 },
  emptyRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: theme.colors.text },
  emptySubtitle: { fontSize: 14, color: theme.colors.textSecondary, marginTop: 6, textAlign: 'center' as const },
  projectQuickList: { width: '100%', marginTop: 28 },
  quickListTitle: { fontSize: 10, fontWeight: '700' as const, color: theme.colors.textTertiary, letterSpacing: 1, marginBottom: 10 },
  quickProjectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 13,
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickProjectInfo: { flex: 1 },
  quickProjectName: { fontSize: 14, fontWeight: '600' as const, color: theme.colors.text },
  quickProjectMeta: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 2 },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' },
  modal: {
    width: '90%',
    maxWidth: 380,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: theme.colors.text, marginBottom: 6 },
  modalSubtitle: { fontSize: 12, color: theme.colors.textTertiary, marginBottom: 12, fontFamily: 'monospace' },
  modalInput: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 13,
    color: theme.colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.surface, alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600' as const, color: theme.colors.textSecondary },
  modalCreateBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center' },
  modalCreateText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
});
