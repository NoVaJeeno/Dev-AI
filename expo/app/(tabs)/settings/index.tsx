import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Animated,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  Type,
  Save,
  Hash,
  Vibrate,
  Trash2,
  Code,
  Database,
  HardDrive,
  ChevronRight,
  Zap,
  Shield,
  ShieldCheck,
  RefreshCw,
  Wifi,
  WifiOff,
  Monitor,
  Link,
  Link2Off,
  Brain,
  Lock,
} from 'lucide-react-native';
import { useStorage } from '@/providers/StorageProvider';
import { useConnectionGuard } from '@/providers/ConnectionGuard';
import { theme } from '@/constants/theme';
import { mmkv } from '@/utils/mmkv';
import { Haptics } from '@/utils/haptics';

const BRIDGE_CONFIG_KEY = 'bridge:config';
const BRIDGE_STATUS_KEY = 'bridge:status';

interface BridgeConfig {
  host: string;
  port: string;
  autoConnect: boolean;
  enabled: boolean;
}

interface BridgeStatus {
  connected: boolean;
  lastAttempt: number;
  error: string | null;
}

export default function SettingsScreen() {
  const { state, updateSettings, clearAllData } = useStorage();
  const { status: guardStatus, forceReconnect, getProtectedToolCount } = useConnectionGuard();
  const { settings } = state;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shieldPulse = useRef(new Animated.Value(1)).current;

  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>(() => {
    const stored = mmkv.getObject<BridgeConfig>(BRIDGE_CONFIG_KEY);
    return stored || { host: '', port: '22', autoConnect: true, enabled: false };
  });
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ connected: false, lastAttempt: 0, error: null });
  const [showBridgeSetup, setShowBridgeSetup] = useState(false);
  const bridgePulse = useRef(new Animated.Value(0)).current;

  const saveBridgeConfig = useCallback((config: BridgeConfig) => {
    setBridgeConfig(config);
    mmkv.setObject(BRIDGE_CONFIG_KEY, config);
    console.log('[Settings] Bridge config saved:', config.host, config.port);
  }, []);

  const connectBridge = useCallback(async () => {
    if (!bridgeConfig.host) {
      Alert.alert('Fehler', 'Bitte gib die IP-Adresse deines Macs ein.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBridgeStatus({ connected: false, lastAttempt: Date.now(), error: null });
    console.log('[Bridge] Connecting to', bridgeConfig.host, ':', bridgeConfig.port);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
      const response = await fetch(url, {
        signal: controller.signal,
        method: 'GET',
        headers: { 'User-Agent': 'DevAI-Bridge/1.0' },
      }).catch(() => null);
      clearTimeout(timeout);

      if (response && response.ok) {
        setBridgeStatus({ connected: true, lastAttempt: Date.now(), error: null });
        mmkv.setObject(BRIDGE_STATUS_KEY, { connected: true, lastAttempt: Date.now() });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Verbunden', `Verbindung zu ${bridgeConfig.host} hergestellt.`);
      } else {
        setBridgeStatus({ connected: false, lastAttempt: Date.now(), error: `Host erreichbar aber kein gültiger Endpunkt. Starte einen lokalen Server auf Port ${bridgeConfig.port}.` });
        mmkv.setObject(BRIDGE_STATUS_KEY, { connected: false, lastAttempt: Date.now() });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Verbindung fehlgeschlagen';
      setBridgeStatus({ connected: false, lastAttempt: Date.now(), error: errorMsg });
      mmkv.setObject(BRIDGE_STATUS_KEY, { connected: false, lastAttempt: Date.now() });
      console.warn('[Bridge] Connection failed:', errorMsg);
    }
  }, [bridgeConfig]);

  const disconnectBridge = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBridgeStatus({ connected: false, lastAttempt: Date.now(), error: null });
    mmkv.setObject(BRIDGE_STATUS_KEY, { connected: false, lastAttempt: Date.now() });
    console.log('[Bridge] Disconnected');
  }, []);

  useEffect(() => {
    if (bridgeStatus.connected) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(bridgePulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(bridgePulse, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      bridgePulse.stopAnimation();
      bridgePulse.setValue(0);
    }
  }, [bridgeStatus.connected, bridgePulse]);

  const workingMemoryPrimary = mmkv.getObject<{ task: string; timestamp: number }>('agent:primary:working_memory');
  const workingMemorySecondary = mmkv.getObject<{ task: string; timestamp: number }>('agent:secondary:working_memory');

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (guardStatus.isProtected) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shieldPulse, { toValue: 0.7, duration: 2000, useNativeDriver: true }),
          Animated.timing(shieldPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [guardStatus.isProtected, shieldPulse]);

  const handleClearData = () => {
    Alert.alert(
      'Alle Daten löschen',
      'Alle Chats, Projekte und Einstellungen werden gelöscht. Nicht rückgängig machbar.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Löschen', style: 'destructive', onPress: clearAllData },
      ]
    );
  };

  const stats = {
    conversations: state.conversations.length,
    projects: state.projects.length,
    totalFiles: state.projects.reduce((acc, p) => acc + p.files.length, 0),
    totalMessages: state.conversations.reduce((acc, c) => acc + c.messages.length, 0),
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View style={[styles.headerRow, { opacity: fadeAnim }]}>
        <Settings size={24} color={theme.colors.primary} />
        <Text style={styles.title}>Einstellungen</Text>
      </Animated.View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.sectionTitle}>ÜBERSICHT</Text>
          <View style={styles.statsGrid}>
            {[
              { icon: <Database size={20} color={theme.colors.primary} />, value: stats.conversations, label: 'Chats' },
              { icon: <Code size={20} color={theme.colors.accent} />, value: stats.projects, label: 'Projekte' },
              { icon: <HardDrive size={20} color={theme.colors.secondary} />, value: stats.totalFiles, label: 'Dateien' },
              { icon: <Zap size={20} color={theme.colors.warning} />, value: stats.totalMessages, label: 'Nachrichten' },
            ].map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                {stat.icon}
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>EDITOR</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: theme.colors.primary + '15' }]}>
                <Type size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Schriftgröße</Text>
                <Text style={styles.settingValue}>{settings.fontSize}px</Text>
              </View>
            </View>
            <View style={styles.fontSizeControls}>
              <TouchableOpacity
                style={styles.fontSizeButton}
                onPress={() => updateSettings({ fontSize: Math.max(10, settings.fontSize - 1) })}
              >
                <Text style={styles.fontSizeButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.fontSizeDisplay}>{settings.fontSize}</Text>
              <TouchableOpacity
                style={styles.fontSizeButton}
                onPress={() => updateSettings({ fontSize: Math.min(24, settings.fontSize + 1) })}
              >
                <Text style={styles.fontSizeButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: theme.colors.accent + '15' }]}>
                <Hash size={18} color={theme.colors.accent} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Zeilennummern</Text>
                <Text style={styles.settingValue}>Im Editor anzeigen</Text>
              </View>
            </View>
            <Switch
              value={settings.showLineNumbers}
              onValueChange={(v) => updateSettings({ showLineNumbers: v })}
              trackColor={{ false: theme.colors.surface, true: theme.colors.primary + '60' }}
              thumbColor={settings.showLineNumbers ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: theme.colors.secondary + '15' }]}>
                <Save size={18} color={theme.colors.secondary} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Save</Text>
                <Text style={styles.settingValue}>Automatisch speichern</Text>
              </View>
            </View>
            <Switch
              value={settings.autoSave}
              onValueChange={(v) => updateSettings({ autoSave: v })}
              trackColor={{ false: theme.colors.surface, true: theme.colors.primary + '60' }}
              thumbColor={settings.autoSave ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>

          <Text style={styles.sectionTitle}>FEEDBACK</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: theme.colors.warning + '15' }]}>
                <Vibrate size={18} color={theme.colors.warning} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Haptik</Text>
                <Text style={styles.settingValue}>Vibrationen</Text>
              </View>
            </View>
            <Switch
              value={settings.enableHaptics}
              onValueChange={(v) => updateSettings({ enableHaptics: v })}
              trackColor={{ false: theme.colors.surface, true: theme.colors.primary + '60' }}
              thumbColor={settings.enableHaptics ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>

          <Text style={styles.sectionTitle}>KI ARBEITSSPEICHER</Text>

          <View style={styles.memoryCard}>
            <View style={styles.memoryCardHeader}>
              <Brain size={20} color={theme.colors.secondary} />
              <Text style={styles.memoryCardTitle}>Working Memory</Text>
            </View>
            {workingMemoryPrimary ? (
              <View style={styles.memoryEntry}>
                <Text style={styles.memoryAgentLabel}>Agent 1</Text>
                <Text style={styles.memoryTaskText} numberOfLines={2}>{workingMemoryPrimary.task}</Text>
                <Text style={styles.memoryTimeText}>
                  {new Date(workingMemoryPrimary.timestamp).toLocaleString('de-DE')}
                </Text>
              </View>
            ) : (
              <View style={styles.memoryEntry}>
                <Text style={styles.memoryAgentLabel}>Agent 1</Text>
                <Text style={styles.memoryEmptyText}>Kein gespeicherter Task</Text>
              </View>
            )}
            {workingMemorySecondary ? (
              <View style={[styles.memoryEntry, { borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
                <Text style={[styles.memoryAgentLabel, { color: '#f97316' }]}>Agent 2</Text>
                <Text style={styles.memoryTaskText} numberOfLines={2}>{workingMemorySecondary.task}</Text>
                <Text style={styles.memoryTimeText}>
                  {new Date(workingMemorySecondary.timestamp).toLocaleString('de-DE')}
                </Text>
              </View>
            ) : (
              <View style={[styles.memoryEntry, { borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
                <Text style={[styles.memoryAgentLabel, { color: '#f97316' }]}>Agent 2</Text>
                <Text style={styles.memoryEmptyText}>Kein gespeicherter Task</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>MAC BRIDGE</Text>

          <View style={styles.bridgeCard}>
            <View style={styles.bridgeHeader}>
              <Animated.View style={[
                styles.bridgeIconWrap,
                bridgeStatus.connected && { opacity: Animated.add(0.6, Animated.multiply(bridgePulse, 0.4)) },
              ]}>
                <Monitor size={24} color={bridgeStatus.connected ? theme.colors.accent : theme.colors.textSecondary} />
              </Animated.View>
              <View style={styles.bridgeHeaderText}>
                <Text style={styles.bridgeTitle}>
                  {bridgeStatus.connected ? 'Verbunden mit Mac' : 'Mac Bridge'}
                </Text>
                <Text style={styles.bridgeSubtitle}>
                  {bridgeStatus.connected
                    ? `${bridgeConfig.host}:${bridgeConfig.port}`
                    : 'WLAN-Verbindung zum Terminal'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.bridgeToggle, bridgeStatus.connected && styles.bridgeToggleActive]}
                onPress={() => bridgeStatus.connected ? disconnectBridge() : setShowBridgeSetup(!showBridgeSetup)}
                activeOpacity={0.7}
              >
                {bridgeStatus.connected ? (
                  <Link2Off size={16} color={theme.colors.error} />
                ) : (
                  <Link size={16} color={theme.colors.primary} />
                )}
              </TouchableOpacity>
            </View>

            {showBridgeSetup && !bridgeStatus.connected && (
              <View style={styles.bridgeSetup}>
                <View style={styles.bridgeInputRow}>
                  <Text style={styles.bridgeInputLabel}>IP-Adresse</Text>
                  <TextInput
                    style={styles.bridgeInput}
                    value={bridgeConfig.host}
                    onChangeText={(t) => saveBridgeConfig({ ...bridgeConfig, host: t })}
                    placeholder="192.168.1.xxx"
                    placeholderTextColor={theme.colors.textTertiary}
                    keyboardType="numeric"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.bridgeInputRow}>
                  <Text style={styles.bridgeInputLabel}>Port</Text>
                  <TextInput
                    style={[styles.bridgeInput, { width: 80 }]}
                    value={bridgeConfig.port}
                    onChangeText={(t) => saveBridgeConfig({ ...bridgeConfig, port: t })}
                    placeholder="22"
                    placeholderTextColor={theme.colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.bridgeAutoRow}>
                  <Text style={styles.bridgeAutoLabel}>Auto-Reconnect</Text>
                  <Switch
                    value={bridgeConfig.autoConnect}
                    onValueChange={(v) => saveBridgeConfig({ ...bridgeConfig, autoConnect: v })}
                    trackColor={{ false: theme.colors.surface, true: theme.colors.primary + '60' }}
                    thumbColor={bridgeConfig.autoConnect ? theme.colors.primary : theme.colors.textTertiary}
                  />
                </View>
                <TouchableOpacity style={styles.bridgeConnectBtn} onPress={connectBridge} activeOpacity={0.7}>
                  <Wifi size={16} color="#fff" />
                  <Text style={styles.bridgeConnectText}>Verbinden</Text>
                </TouchableOpacity>
              </View>
            )}

            {bridgeStatus.error && (
              <View style={styles.bridgeError}>
                <WifiOff size={12} color={theme.colors.error} />
                <Text style={styles.bridgeErrorText} numberOfLines={2}>{bridgeStatus.error}</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>DATENSCHUTZ</Text>

          <View style={styles.privacyCard}>
            <View style={styles.privacyRow}>
              <Lock size={16} color={theme.colors.accent} />
              <View style={styles.privacyInfo}>
                <Text style={styles.privacyLabel}>Chat-Verschlüsselung</Text>
                <Text style={styles.privacyValue}>
                  {guardStatus.encryptionActive ? 'Chats verschlüsselt (Hintergrund)' : 'Bereit – verschlüsselt beim Verlassen'}
                </Text>
              </View>
              <View style={[styles.privacyBadge, guardStatus.encryptionActive && styles.privacyBadgeActive]}>
                <Text style={[styles.privacyBadgeText, guardStatus.encryptionActive && styles.privacyBadgeTextActive]}>
                  {guardStatus.encryptionActive ? 'Aktiv' : 'Bereit'}
                </Text>
              </View>
            </View>
            <View style={[styles.privacyRow, { borderTopWidth: 1, borderTopColor: theme.colors.border }]}>
              <Database size={16} color={theme.colors.secondary} />
              <View style={styles.privacyInfo}>
                <Text style={styles.privacyLabel}>Lokale Speicherung</Text>
                <Text style={styles.privacyValue}>Alle Daten bleiben auf dem Gerät</Text>
              </View>
              <View style={styles.privacyBadge}>
                <Text style={styles.privacyBadgeText}>Lokal</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>SCHUTZ & VERBINDUNG</Text>

          <View style={styles.guardCard}>
            <View style={styles.guardHeader}>
              <Animated.View style={[styles.shieldWrap, { opacity: shieldPulse }]}>
                {guardStatus.isProtected ? (
                  <ShieldCheck size={28} color={theme.colors.accent} />
                ) : (
                  <Shield size={28} color={theme.colors.warning} />
                )}
              </Animated.View>
              <View style={styles.guardHeaderText}>
                <Text style={styles.guardTitle}>
                  {guardStatus.isProtected ? 'Vollständig geschützt' : 'Wiederherstellung...'}
                </Text>
                <Text style={styles.guardSubtitle}>
                  {getProtectedToolCount()} Tools · Auto-Recovery aktiv
                </Text>
              </View>
            </View>
            <View style={styles.guardStatusGrid}>
              <View style={styles.guardStatusItem}>
                {guardStatus.sdk === 'connected' ? (
                  <Wifi size={14} color={theme.colors.accent} />
                ) : (
                  <WifiOff size={14} color={theme.colors.error} />
                )}
                <Text style={[
                  styles.guardStatusText,
                  { color: guardStatus.sdk === 'connected' ? theme.colors.accent : theme.colors.error }
                ]}>SDK</Text>
              </View>
              <View style={styles.guardStatusItem}>
                {guardStatus.storage === 'connected' ? (
                  <Database size={14} color={theme.colors.accent} />
                ) : (
                  <Database size={14} color={theme.colors.error} />
                )}
                <Text style={[
                  styles.guardStatusText,
                  { color: guardStatus.storage === 'connected' ? theme.colors.accent : theme.colors.error }
                ]}>Storage</Text>
              </View>
              <View style={styles.guardStatusItem}>
                {guardStatus.tools === 'connected' ? (
                  <Code size={14} color={theme.colors.accent} />
                ) : (
                  <Code size={14} color={theme.colors.error} />
                )}
                <Text style={[
                  styles.guardStatusText,
                  { color: guardStatus.tools === 'connected' ? theme.colors.accent : theme.colors.error }
                ]}>Tools</Text>
              </View>
            </View>
            {!guardStatus.isProtected && (
              <TouchableOpacity style={styles.reconnectButton} onPress={forceReconnect} activeOpacity={0.7}>
                <RefreshCw size={14} color={theme.colors.primary} />
                <Text style={styles.reconnectText}>Verbindung wiederherstellen</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.sectionTitle}>SYSTEM</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>AI Engine</Text>
            <Text style={styles.infoValueText}>@rork-ai/toolkit-sdk</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Speicher</Text>
            <Text style={styles.infoValueText}>MMKV Cache (persistent)</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Tools</Text>
            <Text style={styles.infoValueText}>{getProtectedToolCount()} geschützte Tools</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Terminal</Text>
            <Text style={styles.infoValueText}>Real HTTP, fetch, pkg mgr</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Self-Healing</Text>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Aktiv</Text>
            </View>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Connection Guard</Text>
            <View style={[styles.activeBadge, guardStatus.isProtected ? {} : { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Text style={[styles.activeBadgeText, guardStatus.isProtected ? {} : { color: theme.colors.warning }]}>
                {guardStatus.isProtected ? 'Geschützt' : 'Wiederherstellung'}
              </Text>
            </View>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Task Recovery</Text>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Anti-Loop aktiv</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.dangerButton} onPress={handleClearData} activeOpacity={0.7}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Trash2 size={18} color={theme.colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerButtonText}>Alle Daten löschen</Text>
              <Text style={styles.dangerButtonSubtext}>Chats, Projekte, Einstellungen</Text>
            </View>
            <ChevronRight size={18} color={theme.colors.error} />
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Developer AI Chat</Text>
            <Text style={styles.footerVersion}>v2.0.0 · Expo SDK 54 · Production</Text>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 26, fontWeight: '700' as const, color: theme.colors.text },
  content: { flex: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700' as const, color: theme.colors.textTertiary, letterSpacing: 1.2, paddingHorizontal: 20, marginTop: 24, marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20 },
  statCard: { flex: 1, minWidth: '44%' as unknown as number, backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  statValue: { fontSize: 24, fontWeight: '700' as const, color: theme.colors.text, marginTop: 6 },
  statLabel: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  settingItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 13, marginHorizontal: 20, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 14, fontWeight: '500' as const, color: theme.colors.text },
  settingValue: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 1 },
  fontSizeControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fontSizeButton: { width: 30, height: 30, borderRadius: 8, backgroundColor: theme.colors.backgroundTertiary, alignItems: 'center', justifyContent: 'center' },
  fontSizeButtonText: { fontSize: 16, fontWeight: '600' as const, color: theme.colors.text },
  fontSizeDisplay: { fontSize: 15, fontWeight: '600' as const, color: theme.colors.primary, minWidth: 26, textAlign: 'center' as const },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, marginHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  infoLabel: { fontSize: 13, color: theme.colors.textSecondary },
  infoValueText: { fontSize: 12, fontWeight: '500' as const, color: theme.colors.text },
  activeBadge: { backgroundColor: theme.colors.accentGlow, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  activeBadgeText: { fontSize: 11, fontWeight: '600' as const, color: theme.colors.accent },
  dangerButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 14, padding: 13, marginHorizontal: 20, marginTop: 16, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.25)', gap: 10 },
  dangerButtonText: { fontSize: 14, fontWeight: '500' as const, color: theme.colors.error },
  dangerButtonSubtext: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 1 },
  footer: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 },
  footerText: { fontSize: 13, color: theme.colors.textSecondary, fontWeight: '500' as const },
  footerVersion: { fontSize: 11, color: theme.colors.textTertiary, marginTop: 3 },
  memoryCard: { backgroundColor: theme.colors.surface, borderRadius: 16, marginHorizontal: 20, borderWidth: 1, borderColor: theme.colors.secondary + '25', overflow: 'hidden' as const },
  memoryCardHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  memoryCardTitle: { fontSize: 15, fontWeight: '600' as const, color: theme.colors.text },
  memoryEntry: { paddingHorizontal: 16, paddingVertical: 10 },
  memoryAgentLabel: { fontSize: 10, fontWeight: '700' as const, color: theme.colors.primary, letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 4 },
  memoryTaskText: { fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  memoryTimeText: { fontSize: 10, color: theme.colors.textTertiary, marginTop: 4 },
  memoryEmptyText: { fontSize: 12, color: theme.colors.textTertiary, fontStyle: 'italic' as const },
  bridgeCard: { backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, marginHorizontal: 20, borderWidth: 1, borderColor: theme.colors.border },
  bridgeHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  bridgeIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: theme.colors.backgroundTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  bridgeHeaderText: { flex: 1 },
  bridgeTitle: { fontSize: 15, fontWeight: '600' as const, color: theme.colors.text },
  bridgeSubtitle: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  bridgeToggle: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.primaryMuted, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: theme.colors.primary + '30' },
  bridgeToggleActive: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' },
  bridgeSetup: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border },
  bridgeInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  bridgeInputLabel: { fontSize: 13, color: theme.colors.textSecondary, fontWeight: '500' as const, width: 90 },
  bridgeInput: { flex: 1, backgroundColor: theme.colors.backgroundTertiary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.border },
  bridgeAutoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 12 },
  bridgeAutoLabel: { fontSize: 13, color: theme.colors.textSecondary },
  bridgeConnectBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12 },
  bridgeConnectText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  bridgeError: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: 8 },
  bridgeErrorText: { flex: 1, fontSize: 11, color: theme.colors.error },
  privacyCard: { backgroundColor: theme.colors.surface, borderRadius: 16, marginHorizontal: 20, borderWidth: 1, borderColor: theme.colors.accent + '20', overflow: 'hidden' as const },
  privacyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  privacyInfo: { flex: 1 },
  privacyLabel: { fontSize: 13, fontWeight: '500' as const, color: theme.colors.text },
  privacyValue: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  privacyBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.colors.accentGlow },
  privacyBadgeActive: { backgroundColor: theme.colors.accent },
  privacyBadgeText: { fontSize: 10, fontWeight: '700' as const, color: theme.colors.accent },
  privacyBadgeTextActive: { color: '#fff' },
  guardCard: { backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, marginHorizontal: 20, borderWidth: 1, borderColor: theme.colors.accent + '30' },
  guardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  shieldWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: theme.colors.accentGlow, alignItems: 'center', justifyContent: 'center' },
  guardHeaderText: { flex: 1 },
  guardTitle: { fontSize: 15, fontWeight: '600' as const, color: theme.colors.text },
  guardSubtitle: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
  guardStatusGrid: { flexDirection: 'row', gap: 8 },
  guardStatusItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.colors.backgroundTertiary, borderRadius: 10, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border },
  guardStatusText: { fontSize: 11, fontWeight: '600' as const },
  reconnectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.primaryMuted, borderWidth: 1, borderColor: theme.colors.primary + '30' },
  reconnectText: { fontSize: 12, fontWeight: '600' as const, color: theme.colors.primary },
});
