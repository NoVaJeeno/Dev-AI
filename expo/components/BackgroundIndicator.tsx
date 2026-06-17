import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radio, CheckCircle2, X, Zap, Wifi } from 'lucide-react-native';
import { useBackgroundTasks } from '@/providers/BackgroundTaskProvider';
import { theme } from '@/constants/theme';

const BG_ACCENT = '#10b981';
const PILL_BG = '#0a1a14';

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

const BackgroundPill = React.memo(function BackgroundPill() {
  const { runningTasks, isBackground } = useBackgroundTasks();
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  const isVisible = isBackground || runningTasks.length > 0;

  useEffect(() => {
    if (isVisible) {
      Animated.spring(scaleAnim, { toValue: 1, tension: 120, friction: 8, useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [isVisible, scaleAnim, pulseAnim]);

  if (!isVisible) return null;

  return (
    <Animated.View
      style={[
        pillStyles.container,
        {
          top: insets.top + 4,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <Animated.View style={[pillStyles.dot, { opacity: pulseAnim }]} />
      <Radio size={10} color={BG_ACCENT} />
      <Text style={pillStyles.text}>
        {runningTasks.length} Task{runningTasks.length !== 1 ? 's' : ''} aktiv
      </Text>
    </Animated.View>
  );
});

const pillStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: PILL_BG,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BG_ACCENT + '30',
    zIndex: 9999,
    ...(Platform.OS === 'web' ? { position: 'fixed' as never } : {}),
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BG_ACCENT,
  },
  text: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: BG_ACCENT,
    letterSpacing: 0.3,
  },
});

const ReturnBanner = React.memo(function ReturnBanner() {
  const { returnBanner, dismissReturnBanner } = useBackgroundTasks();
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (returnBanner.visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -120, duration: 250, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [returnBanner.visible, slideAnim, opacityAnim]);

  if (!returnBanner.visible && !returnBanner.duration) return null;

  return (
    <Animated.View
      style={[
        returnStyles.container,
        {
          top: insets.top + 8,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <View style={returnStyles.content}>
        <View style={returnStyles.iconRow}>
          <View style={returnStyles.iconBg}>
            <Wifi size={14} color={BG_ACCENT} />
          </View>
          <View style={returnStyles.info}>
            <Text style={returnStyles.title}>Willkommen zurück</Text>
            <Text style={returnStyles.subtitle}>
              {formatDuration(returnBanner.duration)} im Hintergrund
            </Text>
          </View>
          <TouchableOpacity
            style={returnStyles.closeBtn}
            onPress={dismissReturnBanner}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={14} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={returnStyles.statsRow}>
          {returnBanner.tasksCompleted > 0 && (
            <View style={returnStyles.statBadge}>
              <CheckCircle2 size={10} color={BG_ACCENT} />
              <Text style={returnStyles.statText}>{returnBanner.tasksCompleted} erledigt</Text>
            </View>
          )}
          {returnBanner.tasksContinued > 0 && (
            <View style={returnStyles.statBadge}>
              <Zap size={10} color={theme.colors.warning} />
              <Text style={returnStyles.statText}>{returnBanner.tasksContinued} laufend</Text>
            </View>
          )}
          {returnBanner.tasksCompleted === 0 && returnBanner.tasksContinued === 0 && (
            <View style={returnStyles.statBadge}>
              <CheckCircle2 size={10} color={BG_ACCENT} />
              <Text style={returnStyles.statText}>Alle Systeme bereit</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
});

const returnStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9998,
    ...(Platform.OS === 'web' ? { position: 'fixed' as never } : {}),
  },
  content: {
    backgroundColor: '#0a1a14',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BG_ACCENT + '30',
    shadowColor: BG_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: BG_ACCENT + '15',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BG_ACCENT + '25',
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 11,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BG_ACCENT + '10',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BG_ACCENT + '15',
  },
  statText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: BG_ACCENT,
  },
});

export const BackgroundIndicator = React.memo(function BackgroundIndicator() {
  return (
    <>
      <BackgroundPill />
      <ReturnBanner />
    </>
  );
});
