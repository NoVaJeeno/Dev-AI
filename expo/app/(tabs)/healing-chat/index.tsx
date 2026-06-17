import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Text,
  Animated,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, Sparkles, AlertTriangle, Brain, Activity, Trash2, Wrench } from 'lucide-react-native';
import { ChatInput } from '@/components/ChatInput';
import { AgentMessage } from '@/components/AgentMessage';
import { useSelfHealingAgent } from '@/hooks/useSelfHealingAgent';
import { useSelfHealing } from '@/providers/SelfHealingProvider';
import { theme } from '@/constants/theme';
import { mmkv } from '@/utils/mmkv';

const ACCENT = '#10b981';
const ACCENT_DIM = 'rgba(16, 185, 129, 0.08)';
const ACCENT_BORDER = 'rgba(16, 185, 129, 0.25)';

const CHAT_MESSAGES_KEY = 'selfhealing:dedicated_chat:messages';

export default function HealingChatScreen() {
  const agent = useSelfHealingAgent();
  const { stats, activeTasks, isScanning } = useSelfHealing();

  const { messages, error, sendMessage, setMessages } = agent;
  const flatListRef = useRef<FlatList>(null);
  const headerGlow = useRef(new Animated.Value(0)).current;
  const appStateRef = useRef<AppStateStatus>('active');
  const savePendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);

  const isStreaming = useMemo(() => {
    try {
      if (!messages || messages.length === 0) return false;
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') return false;
      const parts = (last as { parts?: { type: string; state?: string }[] }).parts;
      if (!Array.isArray(parts)) return false;
      return parts.some(p => p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available'));
    } catch {
      return false;
    }
  }, [messages]);

  const currentToolActivity = useMemo(() => {
    if (!isStreaming) return null;
    const last = messages[messages.length - 1];
    const parts = (last as { parts?: { type: string; state?: string; toolName?: string }[] }).parts;
    if (!Array.isArray(parts)) return null;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available')) {
        return p.toolName || null;
      }
    }
    return null;
  }, [isStreaming, messages]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const stored = mmkv.getObject<unknown[]>(CHAT_MESSAGES_KEY);
      if (Array.isArray(stored) && stored.length > 0) {
        const sanitized = stored.filter(m => {
          if (!m || typeof m !== 'object') return false;
          const mm = m as Record<string, unknown>;
          return typeof mm.id === 'string' && typeof mm.role === 'string';
        }).map(m => {
          const mm = m as Record<string, unknown>;
          if (!Array.isArray(mm.parts)) return mm;
          const parts = (mm.parts as Record<string, unknown>[]).map(part => {
            if (part.type === 'tool' && (part.state === 'input-streaming' || part.state === 'input-available')) {
              return { ...part, state: 'output-available', output: part.output ?? `[Task unterbrochen - ${String(part.toolName)}]` };
            }
            return part;
          });
          return { ...mm, parts };
        });
        if (sanitized.length > 0) {
          console.log('[HealingChat] Restoring', sanitized.length, 'messages');
          setMessages(sanitized as unknown as Parameters<typeof setMessages>[0]);
        }
      }
    } catch (e) {
      console.warn('[HealingChat] Restore failed:', e);
    }
  }, [setMessages]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    if (savePendingRef.current) clearTimeout(savePendingRef.current);
    savePendingRef.current = setTimeout(() => {
      try {
        mmkv.setObject(CHAT_MESSAGES_KEY, messages.slice(-120));
      } catch (e) {
        console.warn('[HealingChat] Save failed:', e);
      }
    }, 600);
    return () => { if (savePendingRef.current) clearTimeout(savePendingRef.current); };
  }, [messages]);

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
        try {
          if (messages.length > 0) mmkv.setObject(CHAT_MESSAGES_KEY, messages.slice(-120));
          void mmkv.flushCritical().catch(() => {});
        } catch {}
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 150);
  }, []);

  const handleSend = useCallback((text: string, files?: { type: 'file'; mimeType: string; uri: string }[]) => {
    try {
      console.log('[HealingChat] Sending:', text.substring(0, 80));
      if (files && files.length > 0) {
        const mapped = files.map(f => ({ type: 'file' as const, mimeType: f.mimeType, uri: f.uri, mediaType: f.mimeType, url: f.uri }));
        sendMessage({ text, files: mapped } as unknown as Parameters<typeof sendMessage>[0]);
      } else {
        sendMessage(text);
      }
      scrollToBottom();
    } catch (e) {
      console.error('[HealingChat] Send error:', e);
    }
  }, [sendMessage, scrollToBottom]);

  const handleClearChat = useCallback(() => {
    try {
      setMessages([]);
      mmkv.delete(CHAT_MESSAGES_KEY);
    } catch (e) {
      console.warn('[HealingChat] Clear failed:', e);
    }
  }, [setMessages]);

  const deduplicatedMessages = useMemo(() => {
    const seen = new Set<string>();
    return messages.filter(m => {
      if (!m?.id) return true;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [messages]);

  const renderMessage = useCallback(({ item, index }: { item: typeof messages[0]; index: number }) => (
    <AgentMessage
      message={item}
      isLatest={index === deduplicatedMessages.length - 1}
    />
  ), [deduplicatedMessages.length]);

  const headerBorderColor = headerGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [ACCENT_BORDER, ACCENT],
  });

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.logoContainer}>
        <View style={styles.logoRing} />
        <View style={styles.logo}>
          <ShieldCheck size={36} color={ACCENT} />
        </View>
      </View>
      <Text style={styles.emptyTitle}>Self Healing AI</Text>
      <Text style={styles.emptySubtitle}>Eigener Chat · Voller Zugriff · 70+ Tools</Text>

      <View style={styles.capRow}>
        {['Auto-Heal', 'Memory', 'Scan', 'Fix', 'Deploy', 'Env'].map(c => (
          <View key={c} style={styles.capBadge}>
            <Text style={styles.capText}>{c}</Text>
          </View>
        ))}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalScans}</Text>
          <Text style={styles.statLabel}>Scans</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: ACCENT }]}>{stats.errorsFixed}</Text>
          <Text style={styles.statLabel}>Fixes</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{activeTasks.length}</Text>
          <Text style={styles.statLabel}>Aktiv</Text>
        </View>
      </View>

      <View style={styles.suggestions}>
        {[
          'App-Status vollständig analysieren',
          'Alle aktiven Fehler beheben',
          'Umgebungs-Scan starten',
          'Memory & Knowledge Base zeigen',
        ].map((s, i) => (
          <TouchableOpacity
            key={i}
            style={styles.suggestion}
            onPress={() => handleSend(s)}
            activeOpacity={0.7}
            testID={`healing-suggestion-${i}`}
          >
            <Sparkles size={13} color={ACCENT} />
            <Text style={styles.suggestionText}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.header, { borderBottomColor: headerBorderColor }]} testID="healing-chat-header">
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <ShieldCheck size={20} color={ACCENT} />
            {(isScanning || isStreaming) && <View style={styles.activeDot} />}
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Self Healing Agent</Text>
            {isStreaming ? (
              <View style={styles.headerSubRow}>
                <Activity size={9} color={ACCENT} />
                <Text style={styles.headerSubActive} numberOfLines={1}>
                  {currentToolActivity ? `Nutzt ${currentToolActivity}...` : 'Arbeitet...'}
                </Text>
              </View>
            ) : (
              <View style={styles.headerSubRow}>
                <Wrench size={9} color={theme.colors.textTertiary} />
                <Text style={styles.headerSub}>
                  {stats.errorsFixed} Fixes · {stats.totalScans} Scans · {activeTasks.length} aktiv
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.memoryPill}>
            <Brain size={11} color={ACCENT} />
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleClearChat}
            activeOpacity={0.7}
            testID="healing-clear-btn"
          >
            <Trash2 size={15} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.mainArea}>
          {deduplicatedMessages.length === 0 ? (
            renderEmpty()
          ) : (
            <FlatList
              ref={flatListRef}
              data={deduplicatedMessages}
              renderItem={renderMessage}
              keyExtractor={(item, index) => `${item?.id || 'msg'}_${index}`}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={scrollToBottom}
            />
          )}
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <AlertTriangle size={14} color={theme.colors.error} />
            <Text style={styles.errorText} numberOfLines={2}>
              {error.message?.includes('502') || error.message?.includes('503') || error.message?.includes('bad gateway')
                ? 'Server nicht erreichbar - Retry läuft...'
                : error.message || 'Fehler'}
            </Text>
          </View>
        )}

        <ChatInput
          onSend={handleSend}
          disabled={false}
          isStreaming={isStreaming}
          placeholder="Self Healing AI fragen..."
        />
      </KeyboardAvoidingView>
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
    borderBottomColor: ACCENT_BORDER,
    backgroundColor: '#0a0f16',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    position: 'relative',
  },
  activeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
    borderWidth: 1.5,
    borderColor: '#0a0f16',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: ACCENT,
    letterSpacing: 0.2,
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  headerSub: {
    fontSize: 10,
    color: theme.colors.textTertiary,
  },
  headerSubActive: {
    fontSize: 10,
    color: ACCENT,
    fontWeight: '600' as const,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memoryPill: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  logoContainer: {
    position: 'relative',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: ACCENT + '22',
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: ACCENT,
    letterSpacing: 0.3,
  },
  emptySubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 4,
    marginBottom: 18,
  },
  capRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 18,
    justifyContent: 'center',
  },
  capBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: ACCENT_DIM,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  capText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: ACCENT,
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
    width: '100%',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#0d1219',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#151d28',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.colors.text,
  },
  statLabel: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 3,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    fontWeight: '600' as const,
  },
  suggestions: {
    width: '100%',
    gap: 8,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d1219',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  suggestionText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '500' as const,
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
});
