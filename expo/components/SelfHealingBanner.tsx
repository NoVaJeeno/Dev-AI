import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import {
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Send,
  Activity,
  Cpu,
  Zap,
  ScanLine,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Clock,
  Brain,
  Database,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useSelfHealing } from '@/providers/SelfHealingProvider';
import { useSelfHealingAgent } from '@/hooks/useSelfHealingAgent';

const ACCENT = '#10b981';
const ACCENT_GLOW = 'rgba(16, 185, 129, 0.12)';
const ACCENT_BORDER = 'rgba(16, 185, 129, 0.25)';
const BANNER_BG = '#0a1a14';
const CHAT_BG = '#060f0b';

interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  output?: unknown;
  input?: unknown;
}

interface AgentMessage {
  id: string;
  role: string;
  parts?: MessagePart[];
}

const ToolCallBubble = React.memo(function ToolCallBubble({ part }: { part: MessagePart }) {
  const isRunning = part.state === 'input-streaming' || part.state === 'input-available';
  const isDone = part.state === 'output-available';

  return (
    <View style={[toolStyles.container, isRunning && toolStyles.running]}>
      <View style={toolStyles.header}>
        {isRunning ? (
          <Activity size={11} color={ACCENT} />
        ) : isDone ? (
          <CheckCircle size={11} color={ACCENT} />
        ) : (
          <AlertTriangle size={11} color={theme.colors.warning} />
        )}
        <Text style={toolStyles.name}>{part.toolName || 'Tool'}</Text>
        {isRunning && <Text style={toolStyles.status}>läuft...</Text>}
      </View>
      {isDone && part.output != null && (
        <Text style={toolStyles.output} numberOfLines={3}>
          {String(typeof part.output === 'string' ? part.output : JSON.stringify(part.output)).substring(0, 200)}
        </Text>
      )}
    </View>
  );
});

const toolStyles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    borderRadius: 8,
    padding: 8,
    borderLeftWidth: 2,
    borderLeftColor: ACCENT + '40',
    marginVertical: 3,
  },
  running: {
    borderLeftColor: ACCENT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: ACCENT,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  status: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginLeft: 'auto',
  },
  output: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 4,
    lineHeight: 14,
  },
});

const MessageBubble = React.memo(function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const isAuto = !isUser && message.parts?.some(p => p.type === 'text' && p.text?.startsWith('[AUTO-IMPULS]'));

  return (
    <View style={[bubbleStyles.container, isUser ? bubbleStyles.userContainer : bubbleStyles.aiContainer]}>
      {!isUser && (
        <View style={bubbleStyles.aiLabel}>
          {isAuto ? (
            <Zap size={9} color={theme.colors.warning} />
          ) : (
            <ShieldCheck size={9} color={ACCENT} />
          )}
          <Text style={[bubbleStyles.aiLabelText, isAuto && bubbleStyles.autoLabelText]}>
            {isAuto ? 'Auto-Impuls' : 'Self Healing AI'}
          </Text>
        </View>
      )}
      {message.parts?.map((part, i) => {
        if (part.type === 'text' && part.text) {
          let displayText = part.text;
          if (isAuto) {
            displayText = displayText.replace('[AUTO-IMPULS] ', '').replace('[AUTO-IMPULS]', '');
          }
          return (
            <Text key={`${message.id}-t-${i}`} style={[bubbleStyles.text, isUser && bubbleStyles.userText]}>
              {displayText}
            </Text>
          );
        }
        if (part.type === 'tool') {
          return <ToolCallBubble key={`${message.id}-tl-${i}`} part={part} />;
        }
        return null;
      })}
    </View>
  );
});

const bubbleStyles = StyleSheet.create({
  container: {
    maxWidth: '88%',
    borderRadius: 14,
    padding: 10,
    marginVertical: 3,
  },
  userContainer: {
    alignSelf: 'flex-end',
    backgroundColor: ACCENT + '18',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  aiContainer: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  aiLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  aiLabelText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: ACCENT,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  autoLabelText: {
    color: theme.colors.warning,
  },
  text: {
    fontSize: 12,
    color: theme.colors.text,
    lineHeight: 18,
  },
  userText: {
    color: theme.colors.text,
  },
});

export const SelfHealingBanner = React.memo(function SelfHealingBanner() {
  const { stats, activeTasks, isScanning, isActive, log, conversationHistory, errorImpulseQueue, consumeErrorImpulse } = useSelfHealing();
  const healingAgent = useSelfHealingAgent();

  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [input, setInput] = useState('');

  const expandAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const bannerGlow = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const impulseProcessingRef = useRef(false);
  const impulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 2000, useNativeDriver: false }),
      ])
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    if (isScanning || activeTasks.length > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(bannerGlow, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(bannerGlow, { toValue: 0, duration: 800, useNativeDriver: false }),
        ])
      ).start();
    } else {
      bannerGlow.stopAnimation();
      bannerGlow.setValue(0);
    }
  }, [isScanning, activeTasks.length, bannerGlow]);

  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: expanded ? 1 : 0,
      tension: 80,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }, [expanded, expandAnim]);

  useEffect(() => {
    if (errorImpulseQueue.length > 0 && !impulseProcessingRef.current && healingAgent.canSendAutoImpulse()) {
      impulseProcessingRef.current = true;
      try {
        const impulse = consumeErrorImpulse();
        if (impulse) {
          healingAgent.sendErrorImpulse(impulse);
        }
      } catch {} finally {
        impulseTimerRef.current = setTimeout(() => {
          impulseProcessingRef.current = false;
        }, 12000);
      }
    }

    return () => {
      if (impulseTimerRef.current) clearTimeout(impulseTimerRef.current);
    };
  }, [errorImpulseQueue.length, consumeErrorImpulse, healingAgent]);

  const toggleExpand = useCallback(() => {
    setExpanded(prev => !prev);
    if (expanded) setChatOpen(false);
  }, [expanded]);

  const toggleChat = useCallback(() => {
    setChatOpen(prev => !prev);
    if (!expanded) setExpanded(true);
  }, [expanded]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    Keyboard.dismiss();
    try {
      healingAgent.sendMessage(text);
    } catch {}
    setTimeout(() => {
      try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
    }, 200);
  }, [input, healingAgent]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
    }, 150);
  }, []);

  const statusColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [ACCENT + '60', ACCENT],
  });

  const glowBorder = bannerGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [ACCENT + '15', ACCENT + '50'],
  });

  const expandHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, chatOpen ? 380 : 180],
  });

  const recentFixes = useMemo(() => {
    try {
      return log.filter(l => l.level === 'fix').slice(-3);
    } catch {
      return [];
    }
  }, [log]);

  const agentMessages = healingAgent.messages as AgentMessage[];

  const isAgentWorking = useMemo(() => {
    try {
      if (agentMessages.length === 0) return false;
      const lastMsg = agentMessages[agentMessages.length - 1];
      if (lastMsg?.role !== 'assistant' || !Array.isArray(lastMsg?.parts)) return false;
      return lastMsg.parts.some(
        (p: MessagePart) => p.type === 'tool' && (p.state === 'input-streaming' || p.state === 'input-available')
      );
    } catch {
      return false;
    }
  }, [agentMessages]);

  const renderChatMessage = useCallback(({ item }: { item: AgentMessage }) => (
    <MessageBubble message={item} />
  ), []);

  const deduplicatedMessages = useMemo(() => {
    try {
      const seen = new Set<string>();
      return agentMessages.filter(m => {
        if (!m?.id) return true;
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    } catch {
      return [];
    }
  }, [agentMessages]);

  const memoryCount = useMemo(() => {
    try {
      return conversationHistory.length;
    } catch {
      return 0;
    }
  }, [conversationHistory]);

  return (
    <Animated.View style={[styles.banner, { borderColor: glowBorder }]}>
      <TouchableOpacity
        style={styles.bannerHeader}
        onPress={toggleExpand}
        activeOpacity={0.8}
        testID="selfhealing-banner"
      >
        <View style={styles.bannerLeft}>
          <Animated.View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.iconWrap}>
            <ShieldCheck size={16} color={ACCENT} />
          </View>
          <View>
            <Text style={styles.bannerTitle}>Self Healing AI</Text>
            <View style={styles.bannerMeta}>
              {isScanning ? (
                <>
                  <ScanLine size={9} color={theme.colors.primary} />
                  <Text style={styles.metaTextActive}>Scanning...</Text>
                </>
              ) : isAgentWorking ? (
                <>
                  <Cpu size={9} color={ACCENT} />
                  <Text style={styles.metaTextActive}>Arbeitet...</Text>
                </>
              ) : activeTasks.length > 0 ? (
                <>
                  <Wrench size={9} color={theme.colors.warning} />
                  <Text style={styles.metaText}>{activeTasks.length} Tasks aktiv</Text>
                </>
              ) : (
                <>
                  <Activity size={9} color={ACCENT} />
                  <Text style={styles.metaText}>
                    {stats.errorsFixed} Fixes • {stats.totalScans} Scans
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.bannerRight}>
          <TouchableOpacity
            style={[styles.chatToggle, chatOpen && styles.chatToggleActive]}
            onPress={toggleChat}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Cpu size={13} color={chatOpen ? '#fff' : ACCENT} />
          </TouchableOpacity>
          {expanded ? (
            <ChevronUp size={16} color={theme.colors.textTertiary} />
          ) : (
            <ChevronDown size={16} color={theme.colors.textTertiary} />
          )}
        </View>
      </TouchableOpacity>

      <Animated.View style={[styles.expandedContent, { height: expandHeight }]}>
        {expanded && !chatOpen && (
          <View style={styles.statsPanel}>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.totalScans}</Text>
                <Text style={styles.statLabel}>Scans</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.errorsDetected}</Text>
                <Text style={styles.statLabel}>Erkannt</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, styles.statValueGreen]}>{stats.errorsFixed}</Text>
                <Text style={styles.statLabel}>Behoben</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.duplicatesBlocked}</Text>
                <Text style={styles.statLabel}>Dedup</Text>
              </View>
            </View>

            <View style={styles.memoryRow}>
              <View style={styles.memoryBadge}>
                <Brain size={10} color={ACCENT} />
                <Text style={styles.memoryText}>{memoryCount} Erinnerungen</Text>
              </View>
              <View style={styles.memoryBadge}>
                <Database size={10} color={theme.colors.primary} />
                <Text style={styles.memoryText}>{activeTasks.length} Aktiv</Text>
              </View>
              {stats.loopsDetected > 0 && (
                <View style={[styles.memoryBadge, styles.loopBadge]}>
                  <AlertTriangle size={10} color={theme.colors.warning} />
                  <Text style={[styles.memoryText, styles.loopText]}>{stats.loopsDetected} Loops</Text>
                </View>
              )}
            </View>

            {recentFixes.length > 0 && (
              <View style={styles.fixList}>
                <Text style={styles.fixListTitle}>Letzte Fixes</Text>
                {recentFixes.map(fix => (
                  <View key={fix.id} style={styles.fixItem}>
                    <CheckCircle size={10} color={ACCENT} />
                    <Text style={styles.fixText} numberOfLines={1}>{fix.message}</Text>
                    <Text style={styles.fixTime}>
                      {new Date(fix.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.infoRow}>
              <Clock size={10} color={theme.colors.textTertiary} />
              <Text style={styles.infoText}>
                Uptime: {Math.floor((stats.uptime || 0) / 60000)}min • Status: {isActive ? 'Aktiv' : 'Inaktiv'}
              </Text>
            </View>
          </View>
        )}

        {expanded && chatOpen && (
          <KeyboardAvoidingView
            style={styles.chatContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {deduplicatedMessages.length === 0 ? (
              <View style={styles.chatEmpty}>
                <ShieldCheck size={28} color={ACCENT + '40'} />
                <Text style={styles.chatEmptyTitle}>Self Healing AI Chat</Text>
                <Text style={styles.chatEmptyText}>
                  Frage mich nach dem App-Status, Fehlern oder gib mir Reparatur-Aufträge.
                </Text>
                <View style={styles.chatSuggestions}>
                  {['App-Status prüfen', 'Fehler-Logs anzeigen', 'Scan starten', 'Erinnerungen abrufen'].map(s => (
                    <TouchableOpacity
                      key={s}
                      style={styles.chatSuggestion}
                      onPress={() => {
                        try {
                          healingAgent.sendMessage(s);
                          setTimeout(() => {
                            try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
                          }, 300);
                        } catch {}
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.chatSuggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={deduplicatedMessages}
                renderItem={renderChatMessage}
                keyExtractor={(item, index) => `sh_${item?.id || 'msg'}_${index}`}
                contentContainerStyle={styles.chatMessages}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={scrollToBottom}
              />
            )}

            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                value={input}
                onChangeText={setInput}
                placeholder="Self Healing AI fragen..."
                placeholderTextColor={theme.colors.textTertiary}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                multiline={false}
              />
              <TouchableOpacity
                style={[styles.chatSendBtn, !input.trim() && styles.chatSendBtnDisabled]}
                onPress={handleSend}
                disabled={!input.trim()}
                activeOpacity={0.7}
              >
                <Send size={14} color={input.trim() ? '#fff' : theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  banner: {
    backgroundColor: BANNER_BG,
    borderRadius: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: ACCENT + '15',
    overflow: 'hidden',
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: ACCENT_GLOW,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT + '20',
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: ACCENT,
    letterSpacing: 0.3,
  },
  bannerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  metaText: {
    fontSize: 10,
    color: theme.colors.textTertiary,
  },
  metaTextActive: {
    fontSize: 10,
    color: ACCENT,
    fontWeight: '500' as const,
  },
  bannerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatToggle: {
    width: 30,
    height: 26,
    borderRadius: 7,
    backgroundColor: ACCENT_GLOW,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT + '20',
  },
  chatToggleActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  expandedContent: {
    overflow: 'hidden',
  },
  statsPanel: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.colors.text,
  },
  statValueGreen: {
    color: ACCENT,
  },
  statLabel: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  memoryRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  memoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ACCENT_GLOW,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ACCENT + '15',
  },
  loopBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  memoryText: {
    fontSize: 9,
    color: ACCENT,
    fontWeight: '600' as const,
  },
  loopText: {
    color: theme.colors.warning,
  },
  fixList: {
    marginBottom: 8,
  },
  fixListTitle: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: theme.colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  fixItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  fixText: {
    flex: 1,
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  fixTime: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  infoText: {
    fontSize: 10,
    color: theme.colors.textTertiary,
  },
  chatContainer: {
    flex: 1,
    backgroundColor: CHAT_BG,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  chatMessages: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chatEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  chatEmptyTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: ACCENT,
    marginTop: 8,
  },
  chatEmptyText: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  chatSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    justifyContent: 'center',
  },
  chatSuggestion: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: ACCENT_GLOW,
    borderWidth: 1,
    borderColor: ACCENT + '20',
  },
  chatSuggestionText: {
    fontSize: 10,
    color: ACCENT,
    fontWeight: '500' as const,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxHeight: 36,
  },
  chatSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendBtnDisabled: {
    backgroundColor: theme.colors.surface,
  },
});
