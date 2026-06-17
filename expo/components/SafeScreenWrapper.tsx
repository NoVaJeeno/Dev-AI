import React, { Suspense, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { theme } from '@/constants/theme';

interface SafeScreenWrapperProps {
  children: React.ReactNode;
  screenName: string;
}

function LoadingFallback() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={styles.loadingText}>Lädt...</Text>
    </View>
  );
}

export function SafeScreenWrapper({ children, screenName }: SafeScreenWrapperProps) {
  const mountAttempts = useRef(0);
  const mountKey = useRef(`${screenName}_${Date.now()}`);

  React.useEffect(() => {
    mountAttempts.current++;
    if (mountAttempts.current > 5) {
      console.error(`[SafeScreen] ${screenName}: Too many mount attempts (${mountAttempts.current}), possible crash loop`);
    }
  });

  return (
    <ErrorBoundary
      key={mountKey.current}
      fallbackMessage={`${screenName} konnte nicht geladen werden.`}
    >
      <Suspense fallback={<LoadingFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontWeight: '500' as const,
  },
});
