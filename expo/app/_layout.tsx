import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { StorageProvider } from "@/providers/StorageProvider";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ConnectionGuardProvider } from "@/providers/ConnectionGuard";
import { SelfHealingProvider } from "@/providers/SelfHealingProvider";
import { BackgroundTaskProvider } from "@/providers/BackgroundTaskProvider";
import { GitHubProvider } from "@/providers/GitHubProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BackgroundIndicator } from "@/components/BackgroundIndicator";
import { theme } from "@/constants/theme";

try {
  SplashScreen.preventAutoHideAsync();
} catch (e) {
  console.warn('[Layout] SplashScreen.preventAutoHideAsync failed:', e);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const inLoginPage = (segments[0] as string) === 'login';

    try {
      if (!isAuthenticated && !inLoginPage) {
        if (!hasNavigated.current) {
          hasNavigated.current = true;
          console.log('[AuthGate] Not authenticated, redirecting to login');
          setTimeout(() => {
            try { router.replace('/login' as never); } catch (e) { console.warn('[AuthGate] Nav error:', e); }
            hasNavigated.current = false;
          }, 50);
        }
      } else if (isAuthenticated && inLoginPage) {
        if (!hasNavigated.current) {
          hasNavigated.current = true;
          console.log('[AuthGate] Authenticated, redirecting to tabs');
          setTimeout(() => {
            try { router.replace('/' as never); } catch (e) { console.warn('[AuthGate] Nav error:', e); }
            hasNavigated.current = false;
          }, 50);
        }
      } else {
        hasNavigated.current = false;
      }
    } catch (e) {
      console.error('[AuthGate] Navigation error:', e);
      hasNavigated.current = false;
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }} testID="auth-loading">
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

function SafeProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary fallbackMessage="Provider-Initialisierung fehlgeschlagen...">
      <AuthProvider>
        <StorageProvider>
          <ConnectionGuardProvider>
            <SelfHealingProvider>
              <GitHubProvider>
                <BackgroundTaskProvider>
                  {children}
                </BackgroundTaskProvider>
              </GitHubProvider>
            </SelfHealingProvider>
          </ConnectionGuardProvider>
        </StorageProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default function RootLayout() {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        SplashScreen.hideAsync();
      } catch (e) {
        console.warn('[Layout] SplashScreen.hideAsync failed:', e);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ErrorBoundary fallbackMessage="Die App wird automatisch repariert...">
      <QueryClientProvider client={queryClient}>
        <SafeProviders>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <StatusBar style="light" />
            <AuthGate>
              <RootLayoutNav />
              <BackgroundIndicator />
            </AuthGate>
          </GestureHandlerRootView>
        </SafeProviders>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
