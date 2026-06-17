import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ShieldCheck,
  Bug,
  CheckCircle2,
  Copy,
  RotateCcw,
  ScanLine,
  Wrench,
  AlertTriangle,
  Clock,
  Brain,
  Database,
  Zap,
  ChevronRight,
  Circle,
  FileSearch,
  RefreshCw,
  Layers,
  BarChart3,
  Terminal,
  Radar,
  Wifi,
  WifiOff,
  Lock,

  Eye,
  Radio,
  Globe,
  Activity,
} from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useSelfHealing, HealingTask, HealingLogEntry, EnvironmentThreat } from '@/providers/SelfHealingProvider';
import { useBackgroundTasks } from '@/providers/BackgroundTaskProvider';

const ACCENT = '#10b981';
const ACCENT_DIM = 'rgba(16, 185, 129, 0.08)';
const ACCENT_BORDER = 'rgba(16, 185, 129, 0.2)';
const CARD_BG = '#0d1219';
const CARD_BORDER = '#151d28';
const SECTION_BG = '#0a0f16';

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#6b7280',
};

const LOG_COLORS: Record<string, string> = {
  info: '#8b90a0',
  warn: '#f59e0b',
  error: '#ef4444',
  fix: '#10b981',
  scan: '#00c8ff',
};


function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Gerade eben';
  if (diff < 3600000) return `vor ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `vor ${Math.floor(diff / 3600000)}h`;
  return `vor ${Math.floor(diff / 86400000)}d`;
}

const PulsingDot = React.memo(function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: anim,
      }}
    />
  );
});

const StatCard = React.memo(function StatCard({
  label,
  value,
  icon,
  color,
  isActive,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  isActive?: boolean;
}) {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
        ])
      ).start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
  }, [isActive, glowAnim]);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [CARD_BORDER, color + '60'],
  });

  return (
    <Animated.View style={[statStyles.card, { borderColor }]}>
      <View style={[statStyles.iconBg, { backgroundColor: color + '12' }]}>
        {icon}
      </View>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {isActive && (
        <View style={statStyles.activeBadge}>
          <PulsingDot color={color} size={5} />
        </View>
      )}
    </Animated.View>
  );
});

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    minHeight: 105,
    justifyContent: 'center',
  },
  iconBg: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 22,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 3,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    fontWeight: '600' as const,
  },
  activeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
});

const ToolUsageCard = React.memo(function ToolUsageCard({ entry }: { entry: HealingLogEntry }) {
  const isFixLog = entry.level === 'fix';
  const isScanLog = entry.level === 'scan';
  const color = LOG_COLORS[entry.level] || theme.colors.textSecondary;

  let toolIcon = <Wrench size={13} color={color} />;
  if (isScanLog) toolIcon = <ScanLine size={13} color={color} />;
  if (isFixLog) toolIcon = <CheckCircle2 size={13} color={color} />;
  if (entry.level === 'error') toolIcon = <Bug size={13} color={color} />;
  if (entry.level === 'warn') toolIcon = <AlertTriangle size={13} color={color} />;

  const statusText = isFixLog ? 'Behoben' : isScanLog ? 'Abgeschlossen' : entry.level === 'error' ? 'Fehler' : 'Info';

  return (
    <View style={toolUsageStyles.card}>
      <View style={[toolUsageStyles.iconBg, { backgroundColor: color + '15' }]}>
        {toolIcon}
      </View>
      <View style={toolUsageStyles.content}>
        <Text style={toolUsageStyles.name} numberOfLines={1}>{entry.message}</Text>
        {entry.details && (
          <Text style={toolUsageStyles.details} numberOfLines={2}>{entry.details}</Text>
        )}
        <Text style={toolUsageStyles.time}>{formatTime(entry.timestamp)}</Text>
      </View>
      <View style={[toolUsageStyles.badge, { backgroundColor: color + '15' }]}>
        <Text style={[toolUsageStyles.badgeText, { color }]}>{statusText}</Text>
      </View>
    </View>
  );
});

const toolUsageStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginBottom: 6,
    gap: 10,
  },
  iconBg: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  name: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.text,
    marginBottom: 2,
  },
  details: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    lineHeight: 14,
    marginBottom: 2,
  },
  time: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
});

interface ErrorPatternData {
  hash: string;
  message: string;
  count: number;
  lastSeen: number;
  firstSeen: number;
  resolved: boolean;
  fixApplied?: string;
}

const ErrorPatternRow = React.memo(function ErrorPatternRow({ pattern }: { pattern: ErrorPatternData }) {
  return (
    <View style={patternStyles.row}>
      <View style={patternStyles.left}>
        <View style={[patternStyles.dot, { backgroundColor: pattern.resolved ? ACCENT : '#ef4444' }]} />
        <View style={patternStyles.info}>
          <Text style={patternStyles.message} numberOfLines={1}>{pattern.message}</Text>
          <View style={patternStyles.meta}>
            <Text style={patternStyles.metaText}>{pattern.count}x aufgetreten</Text>
            <Text style={patternStyles.metaSep}>·</Text>
            <Text style={patternStyles.metaText}>{formatTimeAgo(pattern.lastSeen)}</Text>
          </View>
        </View>
      </View>
      {pattern.resolved ? (
        <View style={patternStyles.fixedBadge}>
          <CheckCircle2 size={9} color={ACCENT} />
          <Text style={patternStyles.fixedText}>Fixed</Text>
        </View>
      ) : (
        <View style={patternStyles.openBadge}>
          <Circle size={9} color="#ef4444" />
          <Text style={patternStyles.openText}>Offen</Text>
        </View>
      )}
    </View>
  );
});

const patternStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    marginRight: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  info: {
    flex: 1,
  },
  message: {
    fontSize: 11,
    color: theme.colors.text,
    fontWeight: '500' as const,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  metaText: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
  metaSep: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
  fixedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: ACCENT + '15',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  fixedText: {
    fontSize: 9,
    color: ACCENT,
    fontWeight: '700' as const,
  },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  openText: {
    fontSize: 9,
    color: '#ef4444',
    fontWeight: '700' as const,
  },
});

const TaskRow = React.memo(function TaskRow({ task }: { task: HealingTask }) {
  const priorityColor = PRIORITY_COLORS[task.priority] || theme.colors.textTertiary;
  const isActive = task.status === 'in_progress';

  return (
    <View style={taskStyles.row}>
      <View style={[taskStyles.priorityBar, { backgroundColor: priorityColor }]} />
      <View style={taskStyles.content}>
        <View style={taskStyles.header}>
          <Text style={taskStyles.title} numberOfLines={1}>{task.title}</Text>
          {isActive && <PulsingDot color={priorityColor} size={6} />}
        </View>
        <Text style={taskStyles.desc} numberOfLines={1}>{task.description}</Text>
        <View style={taskStyles.footer}>
          <View style={[taskStyles.statusBadge, { backgroundColor: priorityColor + '15' }]}>
            <Text style={[taskStyles.statusText, { color: priorityColor }]}>
              {task.priority.toUpperCase()}
            </Text>
          </View>
          <Text style={taskStyles.time}>{formatTimeAgo(task.createdAt)}</Text>
        </View>
      </View>
    </View>
  );
});

const taskStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    marginBottom: 6,
  },
  priorityBar: {
    width: 3,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.text,
    flex: 1,
  },
  desc: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    marginTop: 3,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 9,
    color: theme.colors.textTertiary,
  },
});

const CompletedTaskRow = React.memo(function CompletedTaskRow({ task }: { task: HealingTask }) {
  return (
    <View style={completedStyles.row}>
      <View style={completedStyles.timeline}>
        <CheckCircle2 size={14} color={ACCENT} />
        <View style={completedStyles.line} />
      </View>
      <View style={completedStyles.content}>
        <Text style={completedStyles.title} numberOfLines={1}>{task.title}</Text>
        {task.result && (
          <Text style={completedStyles.result} numberOfLines={2}>{task.result}</Text>
        )}
        <Text style={completedStyles.time}>
          {task.completedAt ? formatTime(task.completedAt) : formatTimeAgo(task.createdAt)}
        </Text>
      </View>
    </View>
  );
});

const completedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 2,
  },
  timeline: {
    alignItems: 'center',
    width: 20,
  },
  line: {
    flex: 1,
    width: 1,
    backgroundColor: ACCENT + '25',
    marginTop: 4,
    minHeight: 20,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  result: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    marginTop: 2,
    lineHeight: 14,
  },
  time: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 3,
  },
});

const LogRow = React.memo(function LogRow({ entry }: { entry: HealingLogEntry }) {
  const color = LOG_COLORS[entry.level] || theme.colors.textSecondary;

  return (
    <View style={logStyles.row}>
      <View style={[logStyles.levelDot, { backgroundColor: color }]} />
      <Text style={[logStyles.level, { color }]}>{entry.level.toUpperCase()}</Text>
      <Text style={logStyles.message} numberOfLines={1}>{entry.message}</Text>
      <Text style={logStyles.time}>{formatTime(entry.timestamp)}</Text>
    </View>
  );
});

const logStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 37, 56, 0.5)',
    gap: 6,
  },
  levelDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  level: {
    fontSize: 8,
    fontWeight: '800' as const,
    width: 36,
    letterSpacing: 0.3,
  },
  message: {
    flex: 1,
    fontSize: 10,
    color: theme.colors.textSecondary,
  },
  time: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginLeft: 4,
  },
});

function SectionHeader({ title, icon, count }: { title: string; icon: React.ReactNode; count?: number }) {
  return (
    <View style={sectionStyles.header}>
      {icon}
      <Text style={sectionStyles.title}>{title}</Text>
      {count !== undefined && (
        <View style={sectionStyles.countBadge}>
          <Text style={sectionStyles.countText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 20,
  },
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.colors.text,
    letterSpacing: 0.2,
    flex: 1,
  },
  countBadge: {
    backgroundColor: ACCENT + '18',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: ACCENT,
  },
});

const THREAT_SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#6b7280',
};

const ENV_STATUS_COLORS: Record<string, string> = {
  secure: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  unknown: '#6b7280',
};

const ThreatRow = React.memo(function ThreatRow({ threat }: { threat: EnvironmentThreat }) {
  const color = THREAT_SEVERITY_COLORS[threat.severity] || '#6b7280';
  return (
    <View style={threatStyles.row}>
      <View style={[threatStyles.severityBar, { backgroundColor: color }]} />
      <View style={threatStyles.content}>
        <View style={threatStyles.header}>
          <Text style={threatStyles.title} numberOfLines={1}>{threat.title}</Text>
          <View style={[threatStyles.badge, { backgroundColor: color + '18' }]}>
            <Text style={[threatStyles.badgeText, { color }]}>{threat.severity.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={threatStyles.desc} numberOfLines={2}>{threat.description}</Text>
        {threat.recommendation && (
          <Text style={threatStyles.rec} numberOfLines={2}>{threat.recommendation}</Text>
        )}
        <Text style={threatStyles.time}>{formatTimeAgo(threat.detectedAt)}</Text>
      </View>
    </View>
  );
});

const threatStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    marginBottom: 6,
  },
  severityBar: {
    width: 3,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.colors.text,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  desc: {
    fontSize: 10,
    color: theme.colors.textTertiary,
    marginTop: 3,
    lineHeight: 14,
  },
  rec: {
    fontSize: 10,
    color: '#10b981',
    marginTop: 3,
    lineHeight: 14,
    fontStyle: 'italic',
  },
  time: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 4,
  },
});

const EnvCheckRow = React.memo(function EnvCheckRow({ check }: { check: { name: string; status: 'pass' | 'warn' | 'fail'; details: string } }) {
  const statusColor = check.status === 'pass' ? '#10b981' : check.status === 'warn' ? '#f59e0b' : '#ef4444';
  const StatusIcon = check.status === 'pass' ? CheckCircle2 : check.status === 'warn' ? AlertTriangle : Circle;
  return (
    <View style={envCheckStyles.row}>
      <StatusIcon size={12} color={statusColor} />
      <Text style={envCheckStyles.name}>{check.name}</Text>
      <Text style={[envCheckStyles.details, { color: statusColor }]}>{check.details}</Text>
    </View>
  );
});

const envCheckStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 37, 56, 0.4)',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500' as const,
    color: theme.colors.text,
  },
  details: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
});

const BgTaskRow = React.memo(function BgTaskRow({ task }: { task: { id: string; name: string; type: string; status: string; startedAt: number; progress?: number } }) {
  const isRunning = task.status === 'running';
  return (
    <View style={bgTaskStyles.row}>
      <View style={[bgTaskStyles.dot, { backgroundColor: isRunning ? '#10b981' : task.status === 'completed' ? '#3b82f6' : '#ef4444' }]} />
      <View style={bgTaskStyles.info}>
        <Text style={bgTaskStyles.name} numberOfLines={1}>{task.name}</Text>
        <Text style={bgTaskStyles.type}>{task.type}</Text>
      </View>
      {task.progress !== undefined && isRunning && (
        <View style={bgTaskStyles.progressWrap}>
          <View style={bgTaskStyles.progressBar}>
            <View style={[bgTaskStyles.progressFill, { width: `${Math.min(100, task.progress)}%` }]} />
          </View>
          <Text style={bgTaskStyles.progressText}>{Math.round(task.progress)}%</Text>
        </View>
      )}
      <View style={[bgTaskStyles.statusBadge, { backgroundColor: isRunning ? '#10b98118' : task.status === 'completed' ? '#3b82f618' : '#ef444418' }]}>
        <Text style={[bgTaskStyles.statusText, { color: isRunning ? '#10b981' : task.status === 'completed' ? '#3b82f6' : '#ef4444' }]}>
          {isRunning ? 'Aktiv' : task.status === 'completed' ? 'Fertig' : 'Fehler'}
        </Text>
      </View>
    </View>
  );
});

const bgTaskStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 37, 56, 0.4)',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: theme.colors.text,
  },
  type: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 1,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressBar: {
    width: 40,
    height: 3,
    backgroundColor: 'rgba(30, 37, 56, 0.6)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    fontWeight: '600' as const,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
});

export default function HealingDashboard() {
  const insets = useSafeAreaInsets();
  const {
    stats,
    activeTasks,
    recentCompletedTasks,
    log,
    isScanning,
    runScan,
    getErrorPatterns,
    getAllMemory,
    getKnowledgeBase,
    conversationHistory,
    isEnvScanning,
    activeThreats,
    latestEnvScan,
    runEnvironmentScan,
  } = useSelfHealing();
  const bgTasks = useBackgroundTasks();

  const [refreshing, setRefreshing] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const scanPulse = useRef(new Animated.Value(1)).current;
  const headerGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(headerGlow, { toValue: 1, duration: 3000, useNativeDriver: false }),
        Animated.timing(headerGlow, { toValue: 0, duration: 3000, useNativeDriver: false }),
      ])
    ).start();
  }, [headerGlow]);

  const envScanPulse = useRef(new Animated.Value(1)).current;

  const handleScan = useCallback(() => {
    Animated.sequence([
      Animated.timing(scanPulse, { toValue: 0.85, duration: 100, useNativeDriver: true }),
      Animated.timing(scanPulse, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    runScan();
  }, [runScan, scanPulse]);

  const handleEnvScan = useCallback(() => {
    Animated.sequence([
      Animated.timing(envScanPulse, { toValue: 0.85, duration: 100, useNativeDriver: true }),
      Animated.timing(envScanPulse, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    runEnvironmentScan();
  }, [runEnvironmentScan, envScanPulse]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    runScan();
    setTimeout(() => setRefreshing(false), 1000);
  }, [runScan]);

  const errorPatterns = useMemo(() => {
    try {
      return getErrorPatterns().sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 20);
    } catch {
      return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getErrorPatterns, stats.errorsDetected]);

  const toolUsageLogs = useMemo(() => {
    try {
      return log.filter(l => l.level === 'fix' || l.level === 'scan' || l.level === 'error').slice(-15).reverse();
    } catch {
      return [];
    }
  }, [log]);

  const displayLogs = useMemo(() => {
    try {
      const sorted = [...log].reverse();
      return showAllLogs ? sorted.slice(0, 100) : sorted.slice(0, 20);
    } catch {
      return [];
    }
  }, [log, showAllLogs]);

  const memoryStats = useMemo(() => {
    try {
      const mem = getAllMemory();
      const kb = getKnowledgeBase();
      return {
        memories: Object.keys(mem).length,
        knowledge: Object.keys(kb).length,
        conversations: conversationHistory.length,
      };
    } catch {
      return { memories: 0, knowledge: 0, conversations: 0 };
    }
  }, [getAllMemory, getKnowledgeBase, conversationHistory.length]);

  const uptimeStr = useMemo(() => {
    const ms = stats.uptime || (Date.now() - stats.startedAt);
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }, [stats.uptime, stats.startedAt]);

  const lastScanStr = useMemo(() => {
    if (!stats.lastScanAt) return 'Nie';
    return formatTimeAgo(stats.lastScanAt);
  }, [stats.lastScanAt]);

  const headerBorderColor = headerGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [ACCENT + '10', ACCENT + '35'],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Animated.View style={[styles.header, { borderBottomColor: headerBorderColor }]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <ShieldCheck size={22} color={ACCENT} />
            {isScanning && (
              <View style={styles.scanningIndicator}>
                <PulsingDot color={ACCENT} size={8} />
              </View>
            )}
          </View>
          <View>
            <Text style={styles.headerTitle}>Self Healing AI</Text>
            <Text style={styles.headerSub}>Dashboard & Monitoring</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.statusPill}>
            <PulsingDot color={ACCENT} size={6} />
            <Text style={styles.statusPillText}>Aktiv</Text>
          </View>
        </View>
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ACCENT}
            colors={[ACCENT]}
          />
        }
      >
        <View style={styles.quickInfo}>
          <View style={styles.quickInfoItem}>
            <Clock size={11} color={theme.colors.textTertiary} />
            <Text style={styles.quickInfoText}>Uptime: {uptimeStr}</Text>
          </View>
          <View style={styles.quickInfoDivider} />
          <View style={styles.quickInfoItem}>
            <ScanLine size={11} color={theme.colors.textTertiary} />
            <Text style={styles.quickInfoText}>Letzter Scan: {lastScanStr}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statsRowTop}>
            <StatCard
              label="Scans"
              value={stats.totalScans}
              icon={<ScanLine size={16} color="#00c8ff" />}
              color="#00c8ff"
              isActive={isScanning}
            />
            <StatCard
              label="Erkannt"
              value={stats.errorsDetected}
              icon={<Bug size={16} color="#f97316" />}
              color="#f97316"
            />
            <StatCard
              label="Behoben"
              value={stats.errorsFixed}
              icon={<CheckCircle2 size={16} color={ACCENT} />}
              color={ACCENT}
            />
          </View>
          <View style={styles.statsRowBottom}>
            <StatCard
              label="Duplikate"
              value={stats.duplicatesBlocked}
              icon={<Copy size={16} color="#8b5cf6" />}
              color="#8b5cf6"
            />
            <StatCard
              label="Loops"
              value={stats.loopsDetected}
              icon={<RotateCcw size={16} color="#ef4444" />}
              color="#ef4444"
            />
          </View>
        </View>

        <Animated.View style={{ transform: [{ scale: scanPulse }] }}>
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanButtonActive]}
            onPress={handleScan}
            activeOpacity={0.8}
            testID="scan-button"
          >
            {isScanning ? (
              <RefreshCw size={16} color="#fff" />
            ) : (
              <ScanLine size={16} color="#fff" />
            )}
            <Text style={styles.scanButtonText}>
              {isScanning ? 'Scanning...' : 'Manuellen Scan starten'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {toolUsageLogs.length > 0 && (
          <>
            <SectionHeader
              title="Tool-Nutzung"
              icon={<Wrench size={14} color={ACCENT} />}
              count={toolUsageLogs.length}
            />
            <View style={styles.sectionCard}>
              {toolUsageLogs.slice(0, 8).map(entry => (
                <ToolUsageCard key={entry.id} entry={entry} />
              ))}
            </View>
          </>
        )}

        {errorPatterns.length > 0 && (
          <>
            <SectionHeader
              title="Fehler-Patterns"
              icon={<FileSearch size={14} color="#f97316" />}
              count={errorPatterns.length}
            />
            <View style={styles.sectionCard}>
              {errorPatterns.slice(0, 10).map(pattern => (
                <ErrorPatternRow key={pattern.hash} pattern={pattern} />
              ))}
            </View>
          </>
        )}

        {activeTasks.length > 0 && (
          <>
            <SectionHeader
              title="Aktive Tasks"
              icon={<Zap size={14} color="#f59e0b" />}
              count={activeTasks.length}
            />
            <View style={styles.sectionCard}>
              {activeTasks.slice(0, 10).map(task => (
                <TaskRow key={task.id} task={task} />
              ))}
            </View>
          </>
        )}

        {recentCompletedTasks.length > 0 && (
          <>
            <SectionHeader
              title="Abgeschlossene Tasks"
              icon={<CheckCircle2 size={14} color={ACCENT} />}
              count={recentCompletedTasks.length}
            />
            <View style={styles.sectionCard}>
              {[...recentCompletedTasks].reverse().slice(0, 8).map(task => (
                <CompletedTaskRow key={task.id} task={task} />
              ))}
            </View>
          </>
        )}

        <SectionHeader
          title="Logs"
          icon={<Terminal size={14} color="#00c8ff" />}
          count={log.length}
        />
        <View style={[styles.sectionCard, styles.logSection]}>
          {displayLogs.length === 0 ? (
            <Text style={styles.emptyText}>Keine Logs vorhanden</Text>
          ) : (
            <>
              {displayLogs.map(entry => (
                <LogRow key={entry.id} entry={entry} />
              ))}
              {log.length > 20 && (
                <TouchableOpacity
                  style={styles.showMoreBtn}
                  onPress={() => setShowAllLogs(prev => !prev)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.showMoreText}>
                    {showAllLogs ? 'Weniger anzeigen' : `Alle ${log.length} Logs anzeigen`}
                  </Text>
                  <ChevronRight size={12} color={ACCENT} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <SectionHeader
          title="Umgebungs-Scanner"
          icon={<Radar size={14} color="#00c8ff" />}
          count={activeThreats.length}
        />
        <View style={styles.sectionCard}>
          {latestEnvScan ? (
            <>
              <View style={styles.envStatusRow}>
                <View style={[styles.envStatusBadge, { backgroundColor: (ENV_STATUS_COLORS[latestEnvScan.networkStatus] || '#6b7280') + '15' }]}>
                  {latestEnvScan.networkStatus === 'secure' ? (
                    <Lock size={14} color={ENV_STATUS_COLORS[latestEnvScan.networkStatus]} />
                  ) : latestEnvScan.networkStatus === 'danger' ? (
                    <WifiOff size={14} color={ENV_STATUS_COLORS[latestEnvScan.networkStatus]} />
                  ) : (
                    <Wifi size={14} color={ENV_STATUS_COLORS[latestEnvScan.networkStatus] || '#6b7280'} />
                  )}
                  <Text style={[styles.envStatusText, { color: ENV_STATUS_COLORS[latestEnvScan.networkStatus] || '#6b7280' }]}>
                    {latestEnvScan.networkStatus === 'secure' ? 'Sicher' : latestEnvScan.networkStatus === 'warning' ? 'Warnung' : latestEnvScan.networkStatus === 'danger' ? 'Gefahr' : 'Unbekannt'}
                  </Text>
                </View>
                <View style={styles.envMetaRow}>
                  <View style={styles.envMetaBadge}>
                    <Activity size={9} color={theme.colors.textTertiary} />
                    <Text style={styles.envMetaText}>{latestEnvScan.latencyMs}ms</Text>
                  </View>
                  <View style={styles.envMetaBadge}>
                    <Globe size={9} color={theme.colors.textTertiary} />
                    <Text style={styles.envMetaText}>{latestEnvScan.connectionType}</Text>
                  </View>
                </View>
              </View>

              {latestEnvScan.checks.map((check, i) => (
                <EnvCheckRow key={`envcheck-${i}`} check={check} />
              ))}

              <Text style={styles.envScanTime}>
                Scan-Dauer: {latestEnvScan.duration}ms · {formatTimeAgo(latestEnvScan.timestamp)}
              </Text>
            </>
          ) : (
            <View style={styles.envEmpty}>
              <Eye size={20} color={theme.colors.textTertiary} />
              <Text style={styles.emptyText}>Erster Umgebungs-Scan wird vorbereitet...</Text>
            </View>
          )}
        </View>

        <Animated.View style={{ transform: [{ scale: envScanPulse }] }}>
          <TouchableOpacity
            style={[styles.envScanButton, isEnvScanning && styles.envScanButtonActive]}
            onPress={handleEnvScan}
            activeOpacity={0.8}
            testID="env-scan-button"
          >
            {isEnvScanning ? (
              <RefreshCw size={14} color="#fff" />
            ) : (
              <Radar size={14} color="#fff" />
            )}
            <Text style={styles.envScanButtonText}>
              {isEnvScanning ? 'Scannt Umgebung...' : 'Umgebungs-Scan starten'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {activeThreats.length > 0 && (
          <>
            <SectionHeader
              title="Aktive Bedrohungen"
              icon={<AlertTriangle size={14} color="#ef4444" />}
              count={activeThreats.length}
            />
            <View style={styles.sectionCard}>
              {activeThreats.map(threat => (
                <ThreatRow key={threat.id} threat={threat} />
              ))}
            </View>
          </>
        )}

        {(bgTasks.runningTasks.length > 0 || bgTasks.recentCompleted.length > 0) && (
          <>
            <SectionHeader
              title="Hintergrund-Tasks"
              icon={<Radio size={14} color={ACCENT} />}
              count={bgTasks.runningTasks.length}
            />
            <View style={styles.sectionCard}>
              {bgTasks.runningTasks.map(task => (
                <BgTaskRow key={task.id} task={task} />
              ))}
              {bgTasks.recentCompleted.slice(-5).reverse().map(task => (
                <BgTaskRow key={task.id} task={task} />
              ))}
            </View>
          </>
        )}

        {bgTasks.stats.totalBackgroundSessions > 0 && (
          <>
            <SectionHeader
              title="Hintergrund-Statistiken"
              icon={<Wifi size={14} color="#8b5cf6" />}
            />
            <View style={styles.bgStatsRow}>
              <View style={styles.bgStatCard}>
                <Text style={styles.bgStatValue}>{bgTasks.stats.totalBackgroundSessions}</Text>
                <Text style={styles.bgStatLabel}>Sessions</Text>
              </View>
              <View style={styles.bgStatCard}>
                <Text style={styles.bgStatValue}>
                  {bgTasks.stats.totalBackgroundTime < 60000
                    ? `${Math.round(bgTasks.stats.totalBackgroundTime / 1000)}s`
                    : `${Math.floor(bgTasks.stats.totalBackgroundTime / 60000)}m`}
                </Text>
                <Text style={styles.bgStatLabel}>BG-Zeit</Text>
              </View>
              <View style={styles.bgStatCard}>
                <Text style={styles.bgStatValue}>{bgTasks.stats.tasksCompletedInBackground}</Text>
                <Text style={styles.bgStatLabel}>BG-Tasks</Text>
              </View>
            </View>
          </>
        )}

        <SectionHeader
          title="Speicher"
          icon={<Database size={14} color="#8b5cf6" />}
        />
        <View style={styles.storageGrid}>
          <View style={styles.storageCard}>
            <Brain size={18} color={ACCENT} />
            <Text style={styles.storageValue}>{memoryStats.memories}</Text>
            <Text style={styles.storageLabel}>Erinnerungen</Text>
          </View>
          <View style={styles.storageCard}>
            <Layers size={18} color="#00c8ff" />
            <Text style={styles.storageValue}>{memoryStats.knowledge}</Text>
            <Text style={styles.storageLabel}>Knowledge Base</Text>
          </View>
          <View style={styles.storageCard}>
            <BarChart3 size={18} color="#8b5cf6" />
            <Text style={styles.storageValue}>{memoryStats.conversations}</Text>
            <Text style={styles.storageLabel}>Konversationen</Text>
          </View>
        </View>
      </ScrollView>
    </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT + '15',
    backgroundColor: SECTION_BG,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: ACCENT_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  scanningIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: ACCENT,
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: ACCENT_DIM,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: ACCENT,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  quickInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  quickInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickInfoText: {
    fontSize: 10,
    color: theme.colors.textTertiary,
  },
  quickInfoDivider: {
    width: 1,
    height: 12,
    backgroundColor: theme.colors.border,
  },
  statsGrid: {
    gap: 8,
    marginBottom: 16,
  },
  statsRowTop: {
    flexDirection: 'row',
    gap: 8,
  },
  statsRowBottom: {
    flexDirection: 'row',
    gap: 8,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 4,
  },
  scanButtonActive: {
    backgroundColor: '#0d9668',
  },
  scanButtonText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff',
  },
  sectionCard: {
    backgroundColor: SECTION_BG,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  logSection: {
    maxHeight: 400,
  },
  emptyText: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    textAlign: 'center',
    paddingVertical: 20,
  },
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  showMoreText: {
    fontSize: 11,
    color: ACCENT,
    fontWeight: '600' as const,
  },
  storageGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  storageCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 6,
  },
  storageValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: theme.colors.text,
  },
  storageLabel: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    fontWeight: '600' as const,
    textAlign: 'center',
  },
  envStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  envStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  envStatusText: {
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  envMetaRow: {
    flexDirection: 'row',
    gap: 6,
  },
  envMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(30, 37, 56, 0.5)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  envMetaText: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    fontWeight: '600' as const,
  },
  envScanTime: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    marginTop: 6,
    textAlign: 'center',
  },
  envEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  envScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0891b2',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  envScanButtonActive: {
    backgroundColor: '#0e7490',
  },
  envScanButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#fff',
  },
  bgStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  bgStatCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  bgStatValue: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: theme.colors.text,
  },
  bgStatLabel: {
    fontSize: 9,
    color: theme.colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    fontWeight: '600' as const,
    marginTop: 3,
  },
});
