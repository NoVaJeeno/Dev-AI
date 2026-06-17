import { useEffect, useState, useCallback, useMemo } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import { AppSettings, Conversation, Project, ProjectFile, WorkspaceState } from '@/types';
import { generateId } from '@/utils/helpers';
import { mmkv } from '@/utils/mmkv';
import { isEncrypted, decryptData } from '@/utils/encryption';

const KEYS = {
  conversations: 'app:conversations',
  projects: 'app:projects',
  workspace: 'app:workspace',
  settings: 'app:settings',
  currentConversationId: 'app:currentConversationId',
  chatMessages: (id: string) => `chat:messages:${id}`,
  memory: 'ai:memory',
};

const defaultSettings: AppSettings = {
  theme: 'dark',
  fontSize: 14,
  autoSave: true,
  showLineNumbers: true,
  enableHaptics: true,
};

const defaultWorkspace: WorkspaceState = {
  currentProjectId: null,
  openFiles: [],
  activeFileId: null,
  expandedFolders: [],
};

interface ConversationMeta {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
}

export const [StorageProvider, useStorage] = createContextHook(() => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(defaultWorkspace);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    mmkv.setObject(KEYS.workspace, workspace);
  }, [workspace, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    mmkv.setObject(KEYS.settings, settings);
  }, [settings, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    if (currentConversationId) {
      mmkv.setString(KEYS.currentConversationId, currentConversationId);
    } else {
      mmkv.delete(KEYS.currentConversationId);
    }
  }, [currentConversationId, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    const metas: ConversationMeta[] = conversations.map(c => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      projectId: c.projectId,
    }));
    mmkv.setObject(KEYS.conversations, metas);
    for (const conv of conversations) {
      if (conv.messages.length > 0) {
        mmkv.setObject(KEYS.chatMessages(conv.id), conv.messages);
      }
    }
  }, [conversations, isInitialized]);

  useEffect(() => {
    if (!isInitialized) return;
    mmkv.setObject(KEYS.projects, projects);
  }, [projects, isInitialized]);

  const loadState = async () => {
    try {
      console.log('[Storage] Initializing MMKV...');
      await mmkv.init();

      try {
        const storedSettings = mmkv.getObject<AppSettings>(KEYS.settings);
        if (storedSettings) {
          setSettings({ ...defaultSettings, ...storedSettings });
        }
      } catch (e) {
        console.warn('[Storage] Failed to load settings:', e);
      }

      try {
        const storedWorkspace = mmkv.getObject<WorkspaceState>(KEYS.workspace);
        if (storedWorkspace) {
          setWorkspace({ ...defaultWorkspace, ...storedWorkspace });
        }
      } catch (e) {
        console.warn('[Storage] Failed to load workspace:', e);
      }

      try {
        const storedProjects = mmkv.getObject<Project[]>(KEYS.projects);
        if (storedProjects && Array.isArray(storedProjects)) {
          setProjects(storedProjects);
          console.log('[Storage] Loaded', storedProjects.length, 'projects');
        }
      } catch (e) {
        console.warn('[Storage] Failed to load projects:', e);
      }

      try {
        const storedMetas = mmkv.getObject<ConversationMeta[]>(KEYS.conversations);
        if (storedMetas && Array.isArray(storedMetas)) {
          const fullConversations: Conversation[] = storedMetas.map(meta => {
            const messages = mmkv.getObject<Conversation['messages']>(KEYS.chatMessages(meta.id)) || [];
            return {
              id: meta.id,
              title: meta.title,
              messages,
              createdAt: meta.createdAt,
              updatedAt: meta.updatedAt,
              projectId: meta.projectId,
            };
          });
          setConversations(fullConversations);
          console.log('[Storage] Loaded', fullConversations.length, 'conversations');
        }
      } catch (e) {
        console.warn('[Storage] Failed to load conversations:', e);
      }

      try {
        const storedCurrentId = mmkv.getString(KEYS.currentConversationId);
        if (storedCurrentId) {
          setCurrentConversationIdState(storedCurrentId);
        }
      } catch (e) {
        console.warn('[Storage] Failed to load current conversation:', e);
      }

      console.log('[Storage] MMKV initialization complete');
    } catch (error) {
      console.error('[Storage] Load failed:', error);
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
    }
  };

  const createConversation = useCallback((title?: string): Conversation => {
    const conversation: Conversation = {
      id: generateId(),
      title: title || 'Neuer Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [conversation, ...prev]);
    setCurrentConversationIdState(conversation.id);
    console.log('[Storage] Created conversation:', conversation.id);
    return conversation;
  }, []);

  const updateConversation = useCallback((id: string, updates: Partial<Conversation>) => {
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
    ));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    setCurrentConversationIdState(prev => prev === id ? null : prev);
    mmkv.delete(KEYS.chatMessages(id));
    console.log('[Storage] Deleted conversation:', id);
  }, []);

  const addMessage = useCallback((conversationId: string, message: Omit<import('@/types').Message, 'id' | 'timestamp'>) => {
    const newMessage: import('@/types').Message = {
      ...message,
      id: generateId(),
      timestamp: Date.now(),
    };
    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, newMessage], updatedAt: Date.now() }
        : c
    ));
    return newMessage;
  }, []);

  const saveChatMessages = useCallback((conversationId: string, messages: unknown[]) => {
    try {
      if (!Array.isArray(messages)) {
        console.warn('[Storage] saveChatMessages: messages is not an array');
        return;
      }
      const safe = messages.filter(m => m && typeof m === 'object');
      mmkv.setObject(KEYS.chatMessages(conversationId), safe);
      setConversations(prev => prev.map(c =>
        c.id === conversationId
          ? { ...c, updatedAt: Date.now() }
          : c
      ));
    } catch (e) {
      console.error('[Storage] saveChatMessages failed:', e);
    }
  }, []);

  const loadChatMessages = useCallback((conversationId: string): unknown[] => {
    try {
      const raw = mmkv.getString(KEYS.chatMessages(conversationId));
      if (!raw) return [];

      let jsonStr = raw;
      if (isEncrypted(raw)) {
        const passKey = mmkv.getString('guard:enc_pass') || 'DevAI_SecureKey_2026_XR7';
        jsonStr = decryptData(raw, passKey);
        console.log('[Storage] Decrypted chat messages for:', conversationId);
        mmkv.setString(KEYS.chatMessages(conversationId), jsonStr);
      }

      try {
        const data = JSON.parse(jsonStr);
        if (!Array.isArray(data)) return [];
        return data.filter(m => m && typeof m === 'object');
      } catch {
        return [];
      }
    } catch (e) {
      console.error('[Storage] loadChatMessages failed for', conversationId, e);
      return [];
    }
  }, []);

  const saveMemoryNote = useCallback((key: string, value: string) => {
    const memory = mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
    memory[key] = value;
    mmkv.setObject(KEYS.memory, memory);
    console.log('[Storage] Memory saved:', key);
  }, []);

  const getMemoryNote = useCallback((key: string): string | null => {
    const memory = mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
    return memory[key] ?? null;
  }, []);

  const getAllMemory = useCallback((): Record<string, string> => {
    return mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
  }, []);

  const deleteMemoryNote = useCallback((key: string) => {
    const memory = mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
    delete memory[key];
    mmkv.setObject(KEYS.memory, memory);
  }, []);

  const createProject = useCallback((name: string, type: Project['type'], description?: string): Project => {
    const project: Project = {
      id: generateId(),
      name,
      description: description || '',
      type,
      files: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
    };
    setProjects(prev => [project, ...prev]);
    return project;
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
    ));
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setWorkspace(prev => prev.currentProjectId === id
      ? { ...prev, currentProjectId: null, openFiles: [], activeFileId: null }
      : prev
    );
  }, []);

  const addFileToProject = useCallback((projectId: string, file: Omit<ProjectFile, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newFile: ProjectFile = {
      ...file,
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, files: [...p.files, newFile], updatedAt: Date.now() }
        : p
    ));
    return newFile;
  }, []);

  const updateFileInProject = useCallback((projectId: string, fileId: string, updates: Partial<ProjectFile>) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? {
            ...p,
            files: p.files.map(f =>
              f.id === fileId ? { ...f, ...updates, updatedAt: Date.now() } : f
            ),
            updatedAt: Date.now(),
          }
        : p
    ));
  }, []);

  const deleteFileFromProject = useCallback((projectId: string, fileId: string) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? { ...p, files: p.files.filter(f => f.id !== fileId), updatedAt: Date.now() }
        : p
    ));
    setWorkspace(prev => prev.openFiles.includes(fileId)
      ? {
          ...prev,
          openFiles: prev.openFiles.filter(id => id !== fileId),
          activeFileId: prev.activeFileId === fileId ? null : prev.activeFileId,
        }
      : prev
    );
  }, []);

  const setCurrentConversation = useCallback((id: string | null) => {
    setCurrentConversationIdState(id);
  }, []);

  const setCurrentProject = useCallback((id: string | null) => {
    setWorkspace(prev => ({ ...prev, currentProjectId: id, openFiles: [], activeFileId: null }));
  }, []);

  const openFile = useCallback((fileId: string) => {
    setWorkspace(prev => ({
      ...prev,
      openFiles: prev.openFiles.includes(fileId)
        ? prev.openFiles
        : [...prev.openFiles, fileId],
      activeFileId: fileId,
    }));
  }, []);

  const closeFile = useCallback((fileId: string) => {
    setWorkspace(prev => {
      const newOpenFiles = prev.openFiles.filter(id => id !== fileId);
      return {
        ...prev,
        openFiles: newOpenFiles,
        activeFileId: prev.activeFileId === fileId
          ? newOpenFiles[newOpenFiles.length - 1] || null
          : prev.activeFileId,
      };
    });
  }, []);

  const setActiveFile = useCallback((fileId: string | null) => {
    setWorkspace(prev => ({ ...prev, activeFileId: fileId }));
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      mmkv.clear();
      setConversations([]);
      setProjects([]);
      setWorkspace(defaultWorkspace);
      setSettings(defaultSettings);
      setCurrentConversationIdState(null);
      console.log('[Storage] All data cleared');
    } catch (e) {
      console.error('[Storage] clearAllData failed:', e);
    }
  }, []);

  const state = useMemo(() => ({
    conversations,
    projects,
    workspace,
    settings,
    currentConversationId,
  }), [conversations, projects, workspace, settings, currentConversationId]);

  const currentConversation = useMemo(() => {
    return conversations.find(c => c.id === currentConversationId) || null;
  }, [conversations, currentConversationId]);

  const currentProject = useMemo(() => {
    return projects.find(p => p.id === workspace.currentProjectId) || null;
  }, [projects, workspace.currentProjectId]);

  return {
    state,
    isLoading,
    currentConversation,
    currentProject,
    createConversation,
    updateConversation,
    deleteConversation,
    addMessage,
    saveChatMessages,
    loadChatMessages,
    saveMemoryNote,
    getMemoryNote,
    getAllMemory,
    deleteMemoryNote,
    createProject,
    updateProject,
    deleteProject,
    addFileToProject,
    updateFileInProject,
    deleteFileFromProject,
    setCurrentConversation,
    setCurrentProject,
    openFile,
    closeFile,
    setActiveFile,
    updateSettings,
    clearAllData,
  };
});
