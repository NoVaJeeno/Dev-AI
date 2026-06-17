import React, { useState, useRef, useCallback, useEffect, useMemo, type FC } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Text,
  Animated,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Menu, Sparkles, AlertTriangle, Wrench, Brain, Zap, Shield } from 'lucide-react-native';
import { ChatInput } from '@/components/ChatInput';
import { ConversationList } from '@/components/ConversationList';
import { AgentMessage } from '@/components/AgentMessage';
import { LivePreview } from '@/components/LivePreview';
import { DevToolsPanel } from '@/components/DevToolsPanel';
import { SelfHealingOverlay } from '@/components/SelfHealingOverlay';
import { SelfHealingBanner } from '@/components/SelfHealingBanner';
import { AIActivityBar } from '@/components/AIActivityBar';
import { useStorage } from '@/providers/StorageProvider';
import { useDevAgent } from '@/hooks/useDevAgent';
import { useSecondAgent } from '@/hooks/useSecondAgent';
import { addShortTermMemory, logInteraction, consolidateMemory } from '@/utils/memoryContext';
import { useConnectionGuard } from '@/providers/ConnectionGuard';
import { useSelfHealing } from '@/providers/SelfHealingProvider';
import { theme } from '@/constants/theme';
import { Project } from '@/types';
import { mmkv } from '@/utils/mmkv';

type AgentMode = 'primary' | 'secondary';

function sanitizeRestoredMessages(messages: unknown[]): unknown[] {
  if (!Array.isArray(messages)) return [];
  try {
    return messages.filter(msg => {
      if (!msg || typeof msg !== 'object') return false;
      const m = msg as Record<string, unknown>;
      if (!m.id || typeof m.id !== 'string') return false;
      if (!m.role || typeof m.role !== 'string') return false;
      return true;
    }).map((msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (!Array.isArray(m.parts)) return { ...m, id: m.id || `restored_${Date.now()}_${Math.random().toString(36).slice(2)}` };
      const sanitizedParts = (m.parts as Record<string, unknown>[]).filter(part => {
        if (!part || typeof part !== 'object') return false;
        return true;
      }).map((part) => {
        if (part.type === 'tool' && (part.state === 'input-streaming' || part.state === 'input-available')) {
          console.log('[Chat] Sanitizing stuck tool part:', part.toolName, 'from state:', part.state);
          return {
            ...part,
            state: 'output-available',
            output: part.output ?? `[Task wurde unterbrochen - ${String(part.toolName)} war aktiv beim Neustart]`,
          };
        }
        return part;
      });
      return { ...m, parts: sanitizedParts };
    });
  } catch (e) {
    console.error('[Chat] sanitizeRestoredMessages failed:', e);
    return [];
  }
}

export default function ChatScreen() {
  const {
    state,
    currentConversation,
    createConversation,
    setCurrentConversation,
    deleteConversation,
    currentProject,
    saveChatMessages,
    loadChatMessages,
    getAllMemory,
  } = useStorage();

  const primaryAgent = useDevAgent();
  const secondaryAgent = useSecondAgent();
  const { status: guardStatus } = useConnectionGuard();
  const { addTaskFromAgent: healingAddTask } = useSelfHealing();

  const [activeAgent, setActiveAgent] = useState<AgentMode>('primary');
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const headerGlow = useRef(new Animated.Value(0)).current;
  const currentConvIdRef = useRef<string | null>(null);
  const savePendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentSwitchAnim = useRef(new Animated.Value(0)).current;
  const appStateRef = useRef<AppStateStatus>('active');

  const agent = activeAgent === 'primary' ? primaryAgent : secondaryAgent;
  const { messages, error, sendMessage, setMessages, stop } = agent as ReturnType<typeof useDevAgent> & { stop?: () => void };

  const checkStreaming = useCallback((msgs: typeof messages): boolean => {
    try {
      if (!msgs || msgs.length === 0) return false;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return false;
      if (!Array.isArray(last.parts)) return false;
      return last.parts.some(
        (p: { type: string; state?: string }) => p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available')
      );
    } catch {
      return false;
    }
  }, []);

  const isStreaming = useMemo(() => checkStreaming(messages), [messages, checkStreaming]);
  const isPrimaryStreaming = useMemo(() => checkStreaming(primaryAgent.messages), [primaryAgent.messages, checkStreaming]);
  const isSecondaryStreaming = useMemo(() => checkStreaming(secondaryAgent.messages), [secondaryAgent.messages, checkStreaming]);

  const currentToolActivity = useMemo(() => {
    if (!isStreaming) return null;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg?.parts || !Array.isArray(lastMsg.parts)) return null;
    for (let i = lastMsg.parts.length - 1; i >= 0; i--) {
      const part = lastMsg.parts[i] as { type: string; toolName?: string; state?: string };
      if (part.type === 'tool' && (part.state === 'input-streaming' || part.state === 'input-available')) {
        return part.toolName || null;
      }
    }
    return null;
  }, [isStreaming, messages]);

  const taskProgress = useMemo(() => {
    if (activeAgent === 'primary' && 'getTaskProgress' in primaryAgent) {
      return (primaryAgent as ReturnType<typeof useDevAgent>).getTaskProgress();
    }
    return { toolCallCount: 0, taskStartTime: 0 };
  }, [activeAgent, primaryAgent, isStreaming, currentToolActivity]);

  useEffect(() => {
    if (!currentConversation) {
      currentConvIdRef.current = null;
      return;
    }
    if (currentConvIdRef.current === currentConversation.id) return;

    console.log('[Chat] Switching to conversation:', currentConversation.id, currentConversation.title);
    currentConvIdRef.current = currentConversation.id;

    try {
      const stored = loadChatMessages(currentConversation.id);
      if (stored && Array.isArray(stored) && stored.length > 0) {
        const sanitized = sanitizeRestoredMessages(stored);
        if (sanitized.length > 0) {
          console.log('[Chat] Restoring', sanitized.length, 'sanitized messages');
          setMessages(sanitized as Parameters<typeof setMessages>[0]);
        } else {
          setMessages([]);
        }
      } else {
        setMessages([]);
      }
    } catch (e) {
      console.error('[Chat] Failed to restore messages:', e);
      healingAddTask('Chat-Wiederherstellung', 'Nachrichten konnten nicht geladen werden: ' + String(e), 'high');
      setMessages([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversation?.id, loadChatMessages, setMessages]);

  useEffect(() => {
    if (!currentConversation?.id || messages.length === 0) return;
    if (savePendingRef.current) clearTimeout(savePendingRef.current);
    savePendingRef.current = setTimeout(() => {
      try {
        console.log('[Chat] Auto-saving', messages.length, 'messages for:', currentConversation.id);
        saveChatMessages(currentConversation.id, messages);
      } catch (e) {
        console.error('[Chat] Auto-save failed:', e);
      }
    }, 800);
    return () => { if (savePendingRef.current) clearTimeout(savePendingRef.current); };
  }, [messages, currentConversation?.id, saveChatMessages]);

  useEffect(() => {
    if (isStreaming) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(headerGlow, { toValue: 1, duration: 1200, useNativeDriver: false }),
          Animated.timing(headerGlow, { toValue: 0, duration: 1200, useNativeDriver: false }),
        ])
      ).start();
    } else {
      headerGlow.stopAnimation();
      headerGlow.setValue(0);
    }
  }, [isStreaming, headerGlow]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;

      if (nextState !== 'active' && wasActive) {
        console.log('[Chat] App going to background, saving state...');
        try {
          if (currentConversation?.id && messages.length > 0) {
            saveChatMessages(currentConversation.id, messages);
            console.log('[Chat] Background save successful');
          }
        } catch (e) {
          console.error('[Chat] Background save failed:', e);
        }
        try {
          void mmkv.flushCritical().catch(() => {});
        } catch {}
      }

      if (nextState === 'active' && !wasActive) {
        console.log('[Chat] App returned to foreground');
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [currentConversation?.id, messages, saveChatMessages]);

  const switchAgent = useCallback((mode: AgentMode) => {
    if (mode === activeAgent) return;
    Animated.sequence([
      Animated.timing(agentSwitchAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(agentSwitchAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
    setActiveAgent(mode);
    console.log('[Chat] Switched to agent:', mode);
  }, [activeAgent, agentSwitchAnim]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 150);
  }, []);

  const handleStop = useCallback(() => {
    console.log('[Chat] Stop requested for', activeAgent);
    try {
      if (typeof stop === 'function') {
        void stop();
      }
    } catch (e) {
      console.warn('[Chat] Stop error:', e);
    }
  }, [activeAgent, stop]);

  const handleSend = useCallback((text: string, files?: { type: 'file'; mimeType: string; uri: string }[]) => {
    try {
      if (!currentConversation) {
        const conv = createConversation(text.substring(0, 50));
        currentConvIdRef.current = conv.id;
      }
      console.log('[Chat] Sending via', activeAgent, ':', text.substring(0, 80));
      logInteraction('user', text.substring(0, 200));
      addShortTermMemory('User fragte: ' + text.substring(0, 150), 'context', 5);
      if (files && files.length > 0) {
        const mappedFiles = files.map((f) => ({
          type: 'file' as const, mimeType: f.mimeType, uri: f.uri,
          mediaType: f.mimeType, url: f.uri,
        }));
        sendMessage({ text, files: mappedFiles } as unknown as Parameters<typeof sendMessage>[0]);
      } else {
        sendMessage(text);
      }
      scrollToBottom();
    } catch (e) {
      console.error('[Chat] Send failed:', e);
      healingAddTask('Chat-Senden fehlgeschlagen', `Nachricht konnte nicht gesendet werden: ${e instanceof Error ? e.message : String(e)}`, 'high');
    }
  }, [currentConversation, createConversation, sendMessage, scrollToBottom, activeAgent, healingAddTask]);

  const handleNewChat = useCallback(() => {
    if (currentConversation?.id && messages.length > 0) {
      saveChatMessages(currentConversation.id, messages);
    }
    try { consolidateMemory(); } catch {}
    const conv = createConversation();
    currentConvIdRef.current = conv.id;
    setMessages([]);
    setShowSidebar(false);
  }, [createConversation, setMessages, currentConversation, messages, saveChatMessages]);

  const handleSelectConversation = useCallback((id: string) => {
    if (currentConversation?.id && messages.length > 0) {
      saveChatMessages(currentConversation.id, messages);
    }
    setCurrentConversation(id);
    setShowSidebar(false);
  }, [setCurrentConversation, currentConversation, messages, saveChatMessages]);

  const handlePreviewProject = useCallback((projectName: string) => {
    try {
      let project: Project | null = null;
      if (projectName === '__current__') {
        project = currentProject ?? null;
      } else {
        project = state.projects.find(p => p.name === projectName) ?? currentProject ?? null;
      }
      if (project) {
        setPreviewProject(project);
      } else {
        Alert.alert('Kein Projekt', 'Kein Projekt zum Anzeigen gefunden.');
      }
    } catch (e) {
      console.error('[Chat] Preview error:', e);
    }
  }, [currentProject, state.projects]);

  const handleSaveProject = useCallback((projectName: string) => {
    try {
      let project: Project | null = null;
      if (projectName === '__current__') {
        project = currentProject ?? null;
      } else {
        project = state.projects.find(p => p.name === projectName) ?? currentProject ?? null;
      }
      if (!project) {
        Alert.alert('Kein Projekt', 'Kein Projekt zum Speichern gefunden.');
        return;
      }
      if (Platform.OS === 'web') {
        try {
          const projectData = JSON.stringify(project, null, 2);
          const blob = new Blob([projectData], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${project.name.replace(/\s+/g, '_')}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error('[Chat] Web save error:', e);
        }
      }
      Alert.alert('Gespeichert', `"${project.name}" wurde gespeichert.\n${project.files.length} Dateien`);
    } catch (e) {
      console.error('[Chat] Save error:', e);
    }
  }, [currentProject, state.projects]);

  const handleSaveFromPreview = useCallback((project: Project) => {
    handleSaveProject(project.name);
  }, [handleSaveProject]);

  const handleDevToolsCommand = useCallback((command: string) => {
    handleSend(command);
    setShowDevTools(false);
  }, [handleSend]);

  const memoryCount = useMemo(() => {
    try { return Object.keys(getAllMemory()).length; } catch { return 0; }
  }, [getAllMemory]);

  const deduplicatedMessages = useMemo(() => {
    const seen = new Set<string>();
    return messages.filter((msg) => {
      if (!msg?.id) return true;
      if (seen.has(msg.id)) {
        console.log('[Chat] Filtering duplicate message key:', msg.id);
        return false;
      }
      seen.add(msg.id);
      return true;
    });
  }, [messages]);

  const renderMessage = useCallback(({ item, index }: { item: typeof messages[0]; index: number }) => (
    <AgentMessage
      message={item}
      isLatest={index === deduplicatedMessages.length - 1}
      onPreviewProject={handlePreviewProject}
      onSaveProject={handleSaveProject}
    />
  ), [deduplicatedMessages.length, handlePreviewProject, handleSaveProject]);

  const headerBorderColor = headerGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.border, activeAgent === 'primary' ? theme.colors.primary : '#f97316'],
  });

  const contentOpacity = agentSwitchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.3],
  });

  const renderEmptyChat = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.logoContainer}>
        <View style={styles.logoRing} />
        <View style={[styles.logo, activeAgent === 'secondary' && styles.logoSecondary]}>
          {activeAgent === 'primary' ? (
            <Sparkles size={36} color={theme.colors.primary} />
          ) : (
            <Zap size={36} color="#f97316" />
          )}
        </View>
      </View>
      <Text style={styles.emptyTitle}>
        {activeAgent === 'primary' ? 'Developer AI' : 'Second Agent'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {activeAgent === 'primary' ? 'Dein KI-Entwicklungspartner' : 'Parallele KI-Instanz'}
      </Text>

      <View style={styles.capabilityRow}>
        {activeAgent === 'primary'
          ? ['Full-Stack', 'Live Preview', '50+ Tools', 'Memory'].map((cap) => (
              <View key={cap} style={[styles.capBadge, cap === 'Memory' && styles.memoryBadge]}>
                {cap === 'Memory' && <Brain size={10} color={theme.colors.secondary} />}
                <Text style={[styles.capText, cap === 'Memory' && styles.memoryCapText]}>{cap}</Text>
              </View>
            ))
          : ['Parallel', 'AI Analysis', 'Code Gen', 'HTTP'].map((cap) => (
              <View key={cap} style={[styles.capBadge, styles.secondaryBadge]}>
                <Text style={[styles.capText, styles.secondaryCapText]}>{cap}</Text>
              </View>
            ))
        }
      </View>

      {memoryCount > 0 && (
        <View style={styles.memoryIndicator}>
          <Brain size={14} color={theme.colors.secondary} />
          <Text style={styles.memoryText}>{memoryCount} Erinnerungen aktiv</Text>
        </View>
      )}

      <View style={styles.suggestions}>
        {(activeAgent === 'primary' ? [
          'Erstelle eine React Native Todo-App',
          'Erstelle eine Landing Page mit modernem Design',
          'Erstelle eine REST API mit Express',
          'Zeige meine Projekte',
        ] : [
          'Analysiere den Code meines Projekts',
          'Erstelle Unit Tests für mein Projekt',
          'Optimiere die Performance',
          'Erstelle eine Dokumentation',
        ]).map((suggestion, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.suggestion, activeAgent === 'secondary' && styles.suggestionSecondary]}
            onPress={() => handleSend(suggestion)}
            activeOpacity={0.7}
            testID={`suggestion-${index}`}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.header, { borderBottomColor: headerBorderColor }]} testID="chat-header">
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => setShowSidebar(true)}
          testID="menu-button"
          activeOpacity={0.7}
        >
          <Menu size={22} color={theme.colors.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentConversation?.title || 'Neuer Chat'}
          </Text>
          {isStreaming && (
            <View style={styles.streamingIndicator}>
              <View style={[styles.streamingDot, activeAgent === 'secondary' && styles.streamingDotSecondary]} />
              <Text style={[styles.streamingText, activeAgent === 'secondary' && styles.streamingTextSecondary]}>
                {activeAgent === 'primary' ? 'Denkt...' : 'Agent 2 arbeitet...'}
              </Text>
            </View>
          )}
          {!isStreaming && currentProject && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{currentProject.name}</Text>
          )}
        </View>

        <View style={styles.headerRight}>
          {guardStatus.isProtected && (
            <View style={styles.shieldDot}>
              <Shield size={10} color={theme.colors.accent} />
            </View>
          )}
          {memoryCount > 0 && (
            <View style={styles.memoryDot}>
              <Brain size={11} color={theme.colors.secondary} />
            </View>
          )}

          <View style={styles.agentToggle}>
            <TouchableOpacity
              style={[styles.agentToggleBtn, activeAgent === 'primary' && styles.agentToggleBtnActive]}
              onPress={() => switchAgent('primary')}
              activeOpacity={0.7}
              testID="agent-primary-btn"
            >
              <Sparkles size={13} color={activeAgent === 'primary' ? '#fff' : theme.colors.textTertiary} />
              {isPrimaryStreaming && activeAgent !== 'primary' && <View style={styles.agentBusyDot} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.agentToggleBtn, activeAgent === 'secondary' && styles.agentToggleBtnSecondaryActive]}
              onPress={() => switchAgent('secondary')}
              activeOpacity={0.7}
              testID="agent-secondary-btn"
            >
              <Zap size={13} color={activeAgent === 'secondary' ? '#fff' : theme.colors.textTertiary} />
              {isSecondaryStreaming && activeAgent !== 'secondary' && <View style={[styles.agentBusyDot, styles.agentBusyDotSecondary]} />}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.iconButton, showDevTools && styles.iconButtonActive]}
            onPress={() => setShowDevTools(!showDevTools)}
            testID="devtools-button"
            activeOpacity={0.7}
          >
            <Wrench size={17} color={showDevTools ? theme.colors.primary : theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleNewChat}
            testID="new-chat-button"
            activeOpacity={0.7}
          >
            <Sparkles size={17} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <AIActivityBar
          isActive={isStreaming}
          toolName={currentToolActivity}
          agentLabel={activeAgent === 'secondary' ? 'Agent 2' : undefined}
          toolCallCount={taskProgress.toolCallCount}
          taskStartTime={taskProgress.taskStartTime}
        />

        <Animated.View style={[styles.mainArea, { opacity: contentOpacity }]}>
          {messages.length === 0 ? (
            renderEmptyChat()
          ) : (
            <FlatList
              ref={flatListRef}
              data={deduplicatedMessages}
              renderItem={renderMessage}
              keyExtractor={(item, index) => {
                const base = item?.id || `msg_fallback_${index}`;
                return `${base}_${index}`;
              }}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={scrollToBottom}
            />
          )}

          {previewProject && (
            <LivePreview
              project={previewProject}
              visible={true}
              onClose={() => setPreviewProject(null)}
              onSaveLocal={handleSaveFromPreview}
            />
          )}
        </Animated.View>

        {error && (
          <View style={styles.errorBanner}>
            <AlertTriangle size={14} color={theme.colors.error} />
            <Text style={styles.errorText} numberOfLines={2}>
              {error.message?.includes('internal server error') || error.message?.includes('502') || error.message?.includes('503') || error.message?.includes('bad gateway')
                ? 'Server vorübergehend nicht erreichbar - Retry läuft automatisch...'
                : error.message || 'Ein Fehler ist aufgetreten'}
            </Text>
          </View>
        )}

        {(isPrimaryStreaming && activeAgent === 'secondary') && (
          <TouchableOpacity
            style={styles.backgroundTaskBanner}
            onPress={() => switchAgent('primary')}
            activeOpacity={0.7}
          >
            <View style={styles.backgroundTaskDot} />
            <Text style={styles.backgroundTaskText}>Agent 1 arbeitet im Hintergrund</Text>
            <Text style={styles.backgroundTaskAction}>Anzeigen</Text>
          </TouchableOpacity>
        )}
        {(isSecondaryStreaming && activeAgent === 'primary') && (
          <TouchableOpacity
            style={[styles.backgroundTaskBanner, styles.backgroundTaskBannerSecondary]}
            onPress={() => switchAgent('secondary')}
            activeOpacity={0.7}
          >
            <View style={[styles.backgroundTaskDot, styles.backgroundTaskDotSecondary]} />
            <Text style={styles.backgroundTaskText}>Agent 2 arbeitet im Hintergrund</Text>
            <Text style={[styles.backgroundTaskAction, styles.backgroundTaskActionSecondary]}>Anzeigen</Text>
          </TouchableOpacity>
        )}

        {showDevTools && (
          <DevToolsPanel
            visible={showDevTools}
            onClose={() => setShowDevTools(false)}
            onSendCommand={handleDevToolsCommand}
          />
        )}

        <SelfHealingBanner />

        <ChatInput
          onSend={handleSend}
          disabled={false}
          isStreaming={isStreaming}
          onStop={handleStop}
          placeholder={activeAgent === 'primary' ? 'Nachricht eingeben...' : 'Agent 2 Nachricht...'}
        />
      </KeyboardAvoidingView>

      <SelfHealingOverlay />

      <ConversationList
        conversations={state.conversations}
        currentId={currentConversation?.id || null}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={deleteConversation}
        onClose={() => setShowSidebar(false)}
        visible={showSidebar}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  headerSubtitle: {
    fontSize: 11,
    color: theme.colors.primary,
    marginTop: 1,
  },
  streamingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  streamingDotSecondary: {
    backgroundColor: '#f97316',
  },
  streamingText: {
    fontSize: 11,
    color: theme.colors.accent,
    fontWeight: '500' as const,
  },
  streamingTextSecondary: {
    color: '#f97316',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  shieldDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.accentGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.secondaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentToggle: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  agentToggleBtn: {
    width: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  agentToggleBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  agentToggleBtnSecondaryActive: {
    backgroundColor: '#f97316',
  },
  agentBusyDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  agentBusyDotSecondary: {
    backgroundColor: '#f97316',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: {
    backgroundColor: theme.colors.primaryMuted,
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
  },
  content: {
    flex: 1,
  },
  mainArea: {
    flex: 1,
  },
  messageList: {
    paddingVertical: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  logoContainer: {
    position: 'relative',
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: theme.colors.primary + '20',
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary + '40',
  },
  logoSecondary: {
    borderColor: '#f9731640',
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: theme.colors.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    marginBottom: 16,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 20,
    justifyContent: 'center',
  },
  capBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: theme.colors.primaryMuted,
    borderWidth: 1,
    borderColor: theme.colors.primary + '25',
  },
  memoryBadge: {
    backgroundColor: theme.colors.secondaryGlow,
    borderColor: theme.colors.secondary + '25',
  },
  secondaryBadge: {
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderColor: 'rgba(249, 115, 22, 0.25)',
  },
  capText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: theme.colors.primary,
  },
  memoryCapText: {
    color: theme.colors.secondary,
  },
  secondaryCapText: {
    color: '#f97316',
  },
  memoryIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: theme.colors.secondaryGlow,
    borderWidth: 1,
    borderColor: theme.colors.secondary + '20',
    marginBottom: 20,
  },
  memoryText: {
    fontSize: 12,
    color: theme.colors.secondary,
    fontWeight: '500' as const,
  },
  suggestions: {
    width: '100%',
    gap: 10,
  },
  suggestion: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  suggestionSecondary: {
    borderColor: 'rgba(249, 115, 22, 0.2)',
  },
  suggestionText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    flex: 1,
    color: theme.colors.error,
    fontSize: 12,
  },
  backgroundTaskBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.primaryMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.primary + '30',
  },
  backgroundTaskBannerSecondary: {
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  backgroundTaskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  backgroundTaskDotSecondary: {
    backgroundColor: '#f97316',
  },
  backgroundTaskText: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontWeight: '500' as const,
  },
  backgroundTaskAction: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: '600' as const,
  },
  backgroundTaskActionSecondary: {
    color: '#f97316',
  },
});
