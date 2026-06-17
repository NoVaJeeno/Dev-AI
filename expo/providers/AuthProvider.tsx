import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

const AUTH_KEY = 'developer_ai_auth';
const CORRECT_PASSWORD = 'JayBozz0406';

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const stored = await AsyncStorage.getItem(AUTH_KEY);
      if (stored === 'true') {
        setIsAuthenticated(true);
        console.log('[Auth] User authenticated from storage');
      }
    } catch (e) {
      console.error('[Auth] Check failed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (password: string): Promise<boolean> => {
    if (password === CORRECT_PASSWORD) {
      setIsAuthenticated(true);
      try {
        await AsyncStorage.setItem(AUTH_KEY, 'true');
      } catch (e) {
        console.error('[Auth] Save failed:', e);
      }
      console.log('[Auth] Login successful');
      return true;
    }
    console.log('[Auth] Login failed - wrong password');
    return false;
  }, []);

  const logout = useCallback(async () => {
    setIsAuthenticated(false);
    try {
      await AsyncStorage.removeItem(AUTH_KEY);
    } catch (e) {
      console.error('[Auth] Logout failed:', e);
    }
    console.log('[Auth] Logged out');
  }, []);

  return { isAuthenticated, isLoading, login, logout };
});
