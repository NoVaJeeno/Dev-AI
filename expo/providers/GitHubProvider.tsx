import { useState, useEffect, useCallback } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import {
  getStoredToken,
  getStoredUser,
  getActiveRepo,
  storeToken,
  clearToken,
  checkTokenValidity,
  type GitHubUserInfo,
} from '@/utils/github';

export const [GitHubProvider, useGitHub] = createContextHook(() => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [user, setUser] = useState<GitHubUserInfo | null>(null);
  const [tokenExists, setTokenExists] = useState(false);

  useEffect(() => {
    checkExistingConnection();
  }, []);

  const checkExistingConnection = async () => {
    setIsChecking(true);
    try {
      const token = getStoredToken();
      if (token) {
        setTokenExists(true);
        const storedUser = getStoredUser();
        if (storedUser) {
          setUser(storedUser);
        }
        const valid = await checkTokenValidity();
        setIsConnected(valid);
        if (!valid) {
          console.warn('[GitHub] Stored token is invalid');
        }
      } else {
        setTokenExists(false);
        setIsConnected(false);
      }
    } catch (e) {
      console.warn('[GitHub] Connection check failed:', e);
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  };

  const connect = useCallback(async (token: string): Promise<boolean> => {
    setIsChecking(true);
    try {
      const success = await storeToken(token);
      if (success) {
        const storedUser = getStoredUser();
        if (storedUser) setUser(storedUser);
        setIsConnected(true);
        setTokenExists(true);
      }
      return success;
    } catch (e) {
      console.error('[GitHub] Connect failed:', e);
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearToken();
    setIsConnected(false);
    setTokenExists(false);
    setUser(null);
    console.log('[GitHub] Disconnected');
  }, []);

  const refreshConnection = useCallback(async () => {
    await checkExistingConnection();
  }, []);

  return {
    isConnected,
    isChecking,
    user,
    tokenExists,
    activeRepo: getActiveRepo(),
    connect,
    disconnect,
    refreshConnection,
  };
});
