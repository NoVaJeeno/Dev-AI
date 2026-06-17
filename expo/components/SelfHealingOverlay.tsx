import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { ShieldCheck, Wrench, ScanLine, RefreshCw, Info, X, Radar } from 'lucide-react-native';
import { theme } from '@/constants/theme';
import { useSelfHealing, HealingNotification } from '@/providers/SelfHealingProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const NOTIFICATION_DURATION = 3500;

const NotificationToast = React.memo(function NotificationToast({ notification, onDismiss, index }: {
  notification: HealingNotification;
  onDismiss: (id: string) => void;
  index: number;
}) {
  const slideAnim = useRef(new Animated.Value(100)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;
  const dismissedRef = useRef(false);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 90, friction: 12, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    Animated.timing(progressAnim, { toValue: 0, duration: NOTIFICATION_DURATION, useNativeDriver: false }).start();

    const timer = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 100, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        onDismiss(notification.id);
      });
    }, NOTIFICATION_DURATION);

    return () => clearTimeout(timer);
  }, [notification.id, slideAnim, opacityAnim, progressAnim, onDismiss]);

  const handleDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 100, duration: 150, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start(() => {
      onDismiss(notification.id);
    });
  }, [notification.id, slideAnim, opacityAnim, onDismiss]);

  const iconMap: Record<string, React.ReactNode> = {
    fix: <Wrench size={12} color="#22c55e" />,
    scan: <ScanLine size={12} color={theme.colors.primary} />,
    protect: <ShieldCheck size={12} color="#f59e0b" />,
    update: <RefreshCw size={12} color={theme.colors.secondary} />,
    info: <Info size={12} color={theme.colors.primary} />,
    env_scan: <Radar size={12} color="#00c8ff" />,
  };

  const accentMap: Record<string, string> = {
    fix: '#22c55e',
    scan: theme.colors.primary,
    protect: '#f59e0b',
    update: theme.colors.secondary,
    info: theme.colors.primary,
    env_scan: '#00c8ff',
  };

  const accent = accentMap[notification.type] || theme.colors.primary;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
          marginBottom: index > 0 ? 4 : 0,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.toastInner}>
        <View style={[styles.toastAccent, { backgroundColor: accent }]} />
        <View style={styles.toastContent}>
          <View style={[styles.toastIconWrap, { backgroundColor: accent + '18' }]}>
            {iconMap[notification.type] || iconMap.info}
          </View>
          <View style={styles.toastTextWrap}>
            <Text style={styles.toastLabel}>Self Healing AI</Text>
            <Text style={styles.toastMessage} numberOfLines={1}>{notification.message}</Text>
          </View>
          <TouchableOpacity
            style={styles.toastDismiss}
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={10} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressWidth, backgroundColor: accent }]} />
        </View>
      </View>
    </Animated.View>
  );
});

export const SelfHealingOverlay = React.memo(function SelfHealingOverlay() {
  const { notifications, dismissNotification } = useSelfHealing();
  const insets = useSafeAreaInsets();

  const handleDismiss = useCallback((id: string) => {
    dismissNotification(id);
  }, [dismissNotification]);

  const visibleNotifs = notifications.filter(n => !n.silent).slice(-2);

  if (visibleNotifs.length === 0) return null;

  return (
    <View
      style={[styles.container, { bottom: insets.bottom + 90 }]}
      pointerEvents="box-none"
    >
      {visibleNotifs.map((notif, index) => (
        <NotificationToast
          key={notif.id}
          notification={notif}
          onDismiss={handleDismiss}
          index={index}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 90,
    gap: 4,
  },
  toast: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  toastInner: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  toastAccent: {
    height: 0,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  toastIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastTextWrap: {
    flex: 1,
  },
  toastLabel: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: '#10b981',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 1,
  },
  toastMessage: {
    fontSize: 11,
    color: theme.colors.text,
    lineHeight: 14,
  },
  toastDismiss: {
    width: 20,
    height: 20,
    borderRadius: 5,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 2,
    backgroundColor: theme.colors.border,
  },
  progressBar: {
    height: 2,
    borderRadius: 1,
  },
});
