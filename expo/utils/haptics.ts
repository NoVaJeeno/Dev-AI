import { Platform } from 'react-native';

/**
 * Safe haptics wrapper that silently no-ops on web and unsupported platforms.
 * Use this instead of importing from 'expo-haptics' directly to prevent
 * crashes when deployed as a web app on Railway.
 */

export const Haptics = {
  async impactAsync(style?: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      const mod = await import('expo-haptics');
      await mod.impactAsync(style as never);
    } catch { /* silently ignore on unsupported platforms */ }
  },

  async notificationAsync(type?: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      const mod = await import('expo-haptics');
      await mod.notificationAsync(type as never);
    } catch { /* silently ignore */ }
  },

  async selectionAsync(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      const mod = await import('expo-haptics');
      await mod.selectionAsync();
    } catch { /* silently ignore */ }
  },

  ImpactFeedbackStyle: {
    Light: 'light' as const,
    Medium: 'medium' as const,
    Heavy: 'heavy' as const,
    Soft: 'soft' as const,
    Rigid: 'rigid' as const,
  },

  NotificationFeedbackType: {
    Success: 'success' as const,
    Warning: 'warning' as const,
    Error: 'error' as const,
  },
};
