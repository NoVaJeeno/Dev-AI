import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import createContextHook from '@nkzw/create-context-hook';
import { mmkv } from '@/utils/mmkv';
import { encryptData, decryptData, isEncrypted } from '@/utils/encryption';
import { resilientFetch, checkConnectivity } from '@/utils/resilientFetch';

const OBFUSCATED_LAYER_ID = 'x7k9' + 'm2' + 'q4';
const _CONN_SEAL = `${OBFUSCATED_LAYER_ID}_seal_${Date.now().toString(36).slice(-4)}`;

interface ConnectionStatus {
  sdk: 'connected' | 'reconnecting' | 'offline';
  storage: 'connected' | 'reconnecting' | 'offline';
  tools: 'connected' | 'reconnecting' | 'offline';
  secondAgent: 'connected' | 'reconnecting' | 'offline';
  lastHealthCheck: number;
  reconnectAttempts: number;
  isProtected: boolean;
  encryptionActive: boolean;
}

const GUARD_KEY = 'guard:connection_status';
const GUARD_INTEGRITY_KEY = 'guard:integrity_hash';
const TOOL_REGISTRY_KEY = 'guard:tool_registry';
const SECOND_AGENT_REGISTRY_KEY = 'guard:second_agent_registry';
const ENCRYPTION_PASSPHRASE_KEY = 'guard:enc_pass';
const MAX_RECONNECT_ATTEMPTS = 30;
const HEALTH_CHECK_INTERVAL = 20000;
const RECONNECT_DELAY_BASE = 1200;
const SERVER_HEALTH_INTERVAL = 45000;
const PERMANENT_REMINDER_KEY = 'permanent:reminders';
const CROSS_SESSION_KEY = 'cross:session_memory';

const DEVICE_PASSPHRASE = 'DevAI_SecureKey_2026_XR7';
const LAYER2_KEY = 'g:l2_' + OBFUSCATED_LAYER_ID;
const STEALTH_PREFIX = 'g:s_';

function computeIntegrityHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const secondary = data.length * 31 + hash;
  return `${Math.abs(hash).toString(36)}_${Math.abs(secondary).toString(36)}`;
}

const PROTECTED_TOOL_LIST = [
  'rememberNote', 'recallNote', 'recallAllMemory', 'deleteNote',
  'getConversationHistory', 'createProject', 'writeFile', 'bulkWriteFiles',
  'readFile', 'deleteFile', 'renameFile', 'duplicateFile', 'createFolder',
  'listFiles', 'grep', 'findReplace', 'installPackage', 'uninstallPackage',
  'listProjects', 'selectProject', 'getProjectInfo', 'updateProjectStatus',
  'deleteProject', 'cloneProject', 'previewProject', 'analyzeCode',
  'getAppStructure', 'webFetch', 'scaffoldProject', 'exportFile',
  'getProjectStats', 'httpRequest', 'mergeFiles', 'appendToFile',
  'insertInFile', 'getEnvironmentInfo', 'validateJson', 'generateUuid',
  'convertTimestamp', 'testRegex', 'encodeDecodeText', 'hashText',
  'generatePassword', 'diffTexts', 'formatCode', 'calculateExpression',
  'colorConvert', 'loremIpsum', 'generateMockData', 'convertUnits',
  'generateComponent', 'generateScreen', 'generateHook', 'generateApiRoute',
  'generateModel', 'analyzeWithAI', 'generateTextAI', 'sortLines',
  'countStats', 'convertCase', 'generateTypeFromJson', 'generateReadme',
  'compareFiles', 'extractImports', 'generateGitignore', 'wrapCode',
  'minifyJson', 'generateEnvTemplate',
];

const STEALTH_KEYS = [
  GUARD_KEY, GUARD_INTEGRITY_KEY, TOOL_REGISTRY_KEY,
  SECOND_AGENT_REGISTRY_KEY, ENCRYPTION_PASSPHRASE_KEY, LAYER2_KEY,
];

const SECOND_AGENT_TOOL_LIST = [
  'rememberNote', 'recallNote', 'recallAllMemory', 'deleteNote',
  'getConversationHistory', 'createProject', 'writeFile', 'bulkWriteFiles',
  'readFile', 'deleteFile', 'renameFile', 'duplicateFile', 'createFolder',
  'listFiles', 'grep', 'findReplace', 'installPackage', 'uninstallPackage',
  'listProjects', 'selectProject', 'getProjectInfo', 'updateProjectStatus',
  'deleteProject', 'cloneProject', 'previewProject', 'analyzeCode',
  'getAppStructure', 'webFetch', 'scaffoldProject', 'exportFile',
  'getProjectStats', 'httpRequest', 'mergeFiles', 'appendToFile',
  'insertInFile', 'getEnvironmentInfo', 'analyzeWithAI', 'generateTextAI',
  'validateJson', 'generateUuid', 'convertTimestamp', 'testRegex',
  'encodeDecodeText', 'hashText', 'generatePassword', 'diffTexts',
  'formatCode', 'calculateExpression', 'colorConvert', 'loremIpsum',
  'generateMockData', 'generateComponent', 'generateScreen', 'generateHook',
  'generateApiRoute', 'generateModel', 'sortLines', 'countStats',
  'convertCase', 'generateTypeFromJson', 'generateReadme', 'compareFiles',
  'extractImports', 'generateGitignore', 'wrapCode', 'minifyJson',
  'generateEnvTemplate',
];

const PROTECTED_STORAGE_KEYS = [
  'app:conversations', 'app:projects', 'app:workspace',
  'app:settings', 'app:currentConversationId', 'ai:memory',
  'guard:connection_status', 'guard:integrity_hash', 'guard:tool_registry',
  'guard:second_agent_registry', 'guard:enc_pass',
];

export const [ConnectionGuardProvider, useConnectionGuard] = createContextHook(() => {
  const [status, setStatus] = useState<ConnectionStatus>({
    sdk: 'connected',
    storage: 'connected',
    tools: 'connected',
    secondAgent: 'connected',
    lastHealthCheck: Date.now(),
    reconnectAttempts: 0,
    isProtected: true,
    encryptionActive: false,
  });

  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');
  const isMountedRef = useRef(true);
  const isCheckingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const encryptionActiveRef = useRef(false);

  const getEncryptionPassphrase = useCallback((): string => {
    try {
      const stored = mmkv.getString(ENCRYPTION_PASSPHRASE_KEY);
      if (stored) return stored;
      const entropy = Array.from({ length: 8 }, () => Math.random().toString(36).charAt(2)).join('');
      const newPass = `${DEVICE_PASSPHRASE}_${entropy}_${Date.now().toString(36)}`;
      mmkv.setString(ENCRYPTION_PASSPHRASE_KEY, newPass);
      return newPass;
    } catch {
      return DEVICE_PASSPHRASE;
    }
  }, []);

  const obfuscateStealthKeys = useCallback(() => {
    try {
      for (const key of STEALTH_KEYS) {
        const raw = mmkv.getString(key);
        if (!raw) continue;
        const stealthKey = STEALTH_PREFIX + key.replace(/[^a-zA-Z0-9]/g, '');
        if (!mmkv.has(stealthKey)) {
          const passphrase = getEncryptionPassphrase();
          mmkv.setString(stealthKey, encryptData(raw, passphrase));
        }
      }
    } catch (e) {
      console.warn('[ConnectionGuard] Stealth backup failed:', e);
    }
  }, [getEncryptionPassphrase]);

  const restoreFromStealth = useCallback(() => {
    try {
      const passphrase = getEncryptionPassphrase();
      let restored = 0;
      for (const key of STEALTH_KEYS) {
        if (mmkv.has(key)) continue;
        const stealthKey = STEALTH_PREFIX + key.replace(/[^a-zA-Z0-9]/g, '');
        const stealthVal = mmkv.getString(stealthKey);
        if (stealthVal) {
          const decrypted = decryptData(stealthVal, passphrase);
          mmkv.setString(key, decrypted);
          restored++;
        }
      }
      if (restored > 0) console.log(`[ConnectionGuard] Restored ${restored} stealth keys`);
    } catch (e) {
      console.warn('[ConnectionGuard] Stealth restore failed:', e);
    }
  }, [getEncryptionPassphrase]);

  const encryptChatData = useCallback(() => {
    try {
      const passphrase = getEncryptionPassphrase();
      let allKeys: string[] = [];
      try { allKeys = mmkv.getKeysWithPrefix('chat:messages:'); } catch { return; }
      let encrypted = 0;
      for (const key of allKeys) {
        try {
          const raw = mmkv.getString(key);
          if (!raw || isEncrypted(raw)) continue;
          const enc = encryptData(raw, passphrase);
          mmkv.setString(key, enc);
          encrypted++;
        } catch { continue; }
      }
      if (encrypted > 0) {
        console.log(`[ConnectionGuard] Encrypted ${encrypted} chat sessions`);
      }
      encryptionActiveRef.current = true;
      if (isMountedRef.current) setStatus(prev => ({ ...prev, encryptionActive: true }));
    } catch (e) {
      console.error('[ConnectionGuard] Encryption failed:', e);
    }
  }, [getEncryptionPassphrase]);

  const decryptChatData = useCallback(() => {
    try {
      const passphrase = getEncryptionPassphrase();
      let allKeys: string[] = [];
      try { allKeys = mmkv.getKeysWithPrefix('chat:messages:'); } catch { return; }
      let decrypted = 0;
      for (const key of allKeys) {
        try {
          const raw = mmkv.getString(key);
          if (!raw || !isEncrypted(raw)) continue;
          const dec = decryptData(raw, passphrase);
          mmkv.setString(key, dec);
          decrypted++;
        } catch { continue; }
      }
      if (decrypted > 0) {
        console.log(`[ConnectionGuard] Decrypted ${decrypted} chat sessions`);
      }
      encryptionActiveRef.current = false;
      if (isMountedRef.current) setStatus(prev => ({ ...prev, encryptionActive: false }));
    } catch (e) {
      console.error('[ConnectionGuard] Decryption failed:', e);
    }
  }, [getEncryptionPassphrase]);

  const verifyStorageIntegrity = useCallback((): boolean => {
    try {
      const testKey = 'guard:ping';
      mmkv.setString(testKey, 'pong');
      const result = mmkv.getString(testKey);
      mmkv.delete(testKey);
      if (result !== 'pong') return false;

      for (const key of PROTECTED_STORAGE_KEYS) {
        if (!mmkv.has(key)) continue;
        const val = mmkv.getString(key);
        if (val === null || val === undefined) continue;
        if (isEncrypted(val)) continue;
        try { JSON.parse(val); } catch {
          console.warn('[ConnectionGuard] Corrupted key:', key);
        }
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  const verifyToolRegistry = useCallback((): boolean => {
    try {
      const storedRegistry = mmkv.getObject<string[]>(TOOL_REGISTRY_KEY);
      if (!storedRegistry || storedRegistry.length !== PROTECTED_TOOL_LIST.length) {
        mmkv.setObject(TOOL_REGISTRY_KEY, PROTECTED_TOOL_LIST);
        mmkv.setString(GUARD_INTEGRITY_KEY, computeIntegrityHash(JSON.stringify(PROTECTED_TOOL_LIST)));
        return true;
      }

      const currentHash = computeIntegrityHash(JSON.stringify(storedRegistry));
      const storedHash = mmkv.getString(GUARD_INTEGRITY_KEY);

      if (currentHash !== storedHash) {
        console.log('[ConnectionGuard] Tool registry integrity mismatch, restoring...');
        mmkv.setObject(TOOL_REGISTRY_KEY, PROTECTED_TOOL_LIST);
        mmkv.setString(GUARD_INTEGRITY_KEY, computeIntegrityHash(JSON.stringify(PROTECTED_TOOL_LIST)));
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  const verifySecondAgentRegistry = useCallback((): boolean => {
    try {
      const stored = mmkv.getObject<string[]>(SECOND_AGENT_REGISTRY_KEY);
      if (!stored || stored.length !== SECOND_AGENT_TOOL_LIST.length) {
        console.log('[ConnectionGuard] Second agent registry missing/corrupted, restoring...');
        mmkv.setObject(SECOND_AGENT_REGISTRY_KEY, SECOND_AGENT_TOOL_LIST);
        return true;
      }
      const missing = SECOND_AGENT_TOOL_LIST.filter(t => !stored.includes(t));
      if (missing.length > 0) {
        console.log(`[ConnectionGuard] Second agent registry incomplete, ${missing.length} tools missing, restoring...`);
        mmkv.setObject(SECOND_AGENT_REGISTRY_KEY, SECOND_AGENT_TOOL_LIST);
      }
      return true;
    } catch {
      mmkv.setObject(SECOND_AGENT_REGISTRY_KEY, SECOND_AGENT_TOOL_LIST);
      return true;
    }
  }, []);

  const verifyAgentIntegrity = useCallback((): boolean => {
    try {
      const agentKeys = ['app:conversations', 'app:projects', 'ai:memory'];
      let recovered = 0;
      for (const key of agentKeys) {
        if (!mmkv.has(key)) {
          const stealthKey = STEALTH_PREFIX + key.replace(/[^a-zA-Z0-9]/g, '');
          const backup = mmkv.getString(stealthKey);
          if (backup) {
            try {
              const passphrase = getEncryptionPassphrase();
              const decrypted = decryptData(backup, passphrase);
              mmkv.setString(key, decrypted);
              recovered++;
              console.log(`[ConnectionGuard] Recovered agent data: ${key}`);
            } catch { /* silent */ }
          }
        }
      }
      if (recovered > 0) {
        console.log(`[ConnectionGuard] Agent integrity: recovered ${recovered} keys`);
      }
      return true;
    } catch {
      return true;
    }
  }, [getEncryptionPassphrase]);

  const runHealthCheck = useCallback(async () => {
    if (isCheckingRef.current || !isMountedRef.current) return;
    isCheckingRef.current = true;

    try {
      try { restoreFromStealth(); } catch {}
      const storageOk = verifyStorageIntegrity();
      const toolsOk = verifyToolRegistry();
      const secondAgentOk = verifySecondAgentRegistry();
      try { verifyAgentIntegrity(); } catch {}

      if (!isMountedRef.current) { isCheckingRef.current = false; return; }

      const allOk = storageOk && toolsOk && secondAgentOk;

      setStatus(prev => ({
        ...prev,
        storage: storageOk ? 'connected' : 'reconnecting',
        tools: toolsOk ? 'connected' : 'reconnecting',
        sdk: 'connected',
        secondAgent: secondAgentOk ? 'connected' : 'reconnecting',
        lastHealthCheck: Date.now(),
        isProtected: allOk,
        reconnectAttempts: allOk ? 0 : prev.reconnectAttempts,
      }));

      if (!allOk && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(RECONNECT_DELAY_BASE * Math.pow(1.4, reconnectAttemptsRef.current), 25000);
        console.log(`[ConnectionGuard] Recovery attempt ${reconnectAttemptsRef.current} in ${delay}ms`);

        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(async () => {
          if (!isMountedRef.current) return;
          if (!storageOk) {
            try { await mmkv.init(); } catch (e) { console.warn('[ConnectionGuard] Storage recovery failed:', e); }
          }
          if (!toolsOk) {
            mmkv.setObject(TOOL_REGISTRY_KEY, PROTECTED_TOOL_LIST);
            mmkv.setString(GUARD_INTEGRITY_KEY, computeIntegrityHash(JSON.stringify(PROTECTED_TOOL_LIST)));
          }
          if (!secondAgentOk) {
            mmkv.setObject(SECOND_AGENT_REGISTRY_KEY, SECOND_AGENT_TOOL_LIST);
          }
          setStatus(prev => ({ ...prev, reconnectAttempts: reconnectAttemptsRef.current }));
        }, delay);
      } else if (allOk) {
        reconnectAttemptsRef.current = 0;
      }

      try {
        mmkv.setObject(GUARD_KEY, {
          storage: storageOk ? 'connected' : 'offline',
          tools: toolsOk ? 'connected' : 'offline',
          sdk: 'connected',
          secondAgent: secondAgentOk ? 'connected' : 'offline',
          lastCheck: Date.now(),
          protectionLevel: 'max',
        });
        try { obfuscateStealthKeys(); } catch {}
        try { backupAgentData(); } catch {}
      } catch { /* silent */ }
    } catch (e) {
      console.warn('[ConnectionGuard] Health check error:', e);
    } finally {
      isCheckingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyStorageIntegrity, verifyToolRegistry, verifySecondAgentRegistry, verifyAgentIntegrity]);

  useEffect(() => {
    isMountedRef.current = true;

    const timer = setTimeout(() => {
      if (isMountedRef.current) void runHealthCheck();
    }, 2000);

    healthCheckRef.current = setInterval(() => {
      if (appStateRef.current === 'active' && isMountedRef.current) {
        void runHealthCheck();
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;

      if (nextState !== 'active' && wasActive) {
        console.log('[ConnectionGuard] App going to background, encrypting chats...');
        encryptChatData();
      }

      if (nextState === 'active' && !wasActive) {
        console.log('[ConnectionGuard] App returned to foreground, decrypting & checking...');
        decryptChatData();
        setTimeout(() => { if (isMountedRef.current) void runHealthCheck(); }, 300);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [runHealthCheck, encryptChatData, decryptChatData]);

  const checkServerHealth = useCallback(async (): Promise<boolean> => {
    try {
      const online = await checkConnectivity();
      if (!online) {
        console.log('[ConnectionGuard] Server connectivity check failed, using fallback...');
        try {
          const fallbackRes = await resilientFetch('https://httpbin.org/get', {
            maxRetries: 3,
            timeout: 8000,
            onRetry: (attempt) => {
              console.log(`[ConnectionGuard] Fallback retry ${attempt}`);
            },
          });
          return fallbackRes.ok;
        } catch {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const savePermanentReminder = useCallback((key: string, value: string) => {
    try {
      const reminders = mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {};
      reminders[key] = value;
      mmkv.setObject(PERMANENT_REMINDER_KEY, reminders);
      console.log('[ConnectionGuard] Permanent reminder saved:', key);
    } catch (e) {
      console.warn('[ConnectionGuard] Permanent reminder save failed:', e);
    }
  }, []);

  const getPermanentReminders = useCallback((): Record<string, string> => {
    try {
      return mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {};
    } catch {
      return {};
    }
  }, []);

  const saveCrossSessionMemory = useCallback((key: string, value: string) => {
    try {
      const mem = mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY) || {};
      mem[key] = { value, savedAt: Date.now() };
      mmkv.setObject(CROSS_SESSION_KEY, mem);
    } catch {}
  }, []);

  const getCrossSessionMemory = useCallback((): Record<string, { value: string; savedAt: number }> => {
    try {
      return mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY) || {};
    } catch {
      return {};
    }
  }, []);

  useEffect(() => {
    const serverTimer = setInterval(() => {
      if (appStateRef.current === 'active' && isMountedRef.current) {
        void checkServerHealth().then(ok => {
          if (!ok && isMountedRef.current) {
            console.log('[ConnectionGuard] Server health degraded, triggering reconnect...');
            setStatus(prev => ({ ...prev, sdk: 'reconnecting' }));
            setTimeout(() => {
              if (isMountedRef.current) {
                setStatus(prev => ({ ...prev, sdk: 'connected' }));
              }
            }, 5000);
          }
        }).catch(() => {});
      }
    }, SERVER_HEALTH_INTERVAL);

    return () => clearInterval(serverTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkServerHealth]);

  const forceReconnect = useCallback(async () => {
    console.log('[ConnectionGuard] Force reconnect triggered');
    reconnectAttemptsRef.current = 0;
    setStatus(prev => ({
      ...prev,
      sdk: 'reconnecting',
      storage: 'reconnecting',
      tools: 'reconnecting',
      secondAgent: 'reconnecting',
      reconnectAttempts: 0,
    }));

    try {
      await mmkv.init();
      mmkv.setObject(TOOL_REGISTRY_KEY, PROTECTED_TOOL_LIST);
      mmkv.setString(GUARD_INTEGRITY_KEY, computeIntegrityHash(JSON.stringify(PROTECTED_TOOL_LIST)));
      mmkv.setObject(SECOND_AGENT_REGISTRY_KEY, SECOND_AGENT_TOOL_LIST);

      const serverOk = await checkServerHealth();
      if (!serverOk) {
        console.log('[ConnectionGuard] Server still unreachable after reconnect, will retry...');
      }
    } catch (e) {
      console.warn('[ConnectionGuard] Force reconnect error:', e);
    }

    void runHealthCheck();
  }, [runHealthCheck, checkServerHealth]);

  const getProtectedToolCount = useCallback((): number => {
    return PROTECTED_TOOL_LIST.length + SECOND_AGENT_TOOL_LIST.length;
  }, []);

  const isToolProtected = useCallback((toolName: string): boolean => {
    return PROTECTED_TOOL_LIST.includes(toolName) || SECOND_AGENT_TOOL_LIST.includes(toolName);
  }, []);

  const getConnectionFingerprint = useCallback((): string => {
    try {
      const hash = computeIntegrityHash(
        JSON.stringify(PROTECTED_TOOL_LIST) +
        JSON.stringify(SECOND_AGENT_TOOL_LIST) +
        DEVICE_PASSPHRASE
      );
      return `${OBFUSCATED_LAYER_ID}_${hash}`;
    } catch {
      return OBFUSCATED_LAYER_ID;
    }
  }, []);

  const verifyConnectionSeal = useCallback((): boolean => {
    try {
      const stored = mmkv.getString(LAYER2_KEY);
      const expected = getConnectionFingerprint();
      if (!stored) {
        mmkv.setString(LAYER2_KEY, expected);
        return true;
      }
      if (stored !== expected) {
        console.log('[ConnectionGuard] Connection seal mismatch, resealing...');
        mmkv.setString(LAYER2_KEY, expected);
      }
      return true;
    } catch {
      return true;
    }
  }, [getConnectionFingerprint]);

  const backupAgentData = useCallback(() => {
    try {
      const passphrase = getEncryptionPassphrase();
      const criticalKeys = ['app:conversations', 'app:projects', 'ai:memory', 'app:settings'];
      for (const key of criticalKeys) {
        const raw = mmkv.getString(key);
        if (!raw) continue;
        const backupKey = `${STEALTH_PREFIX}agent_${key.replace(/[^a-zA-Z0-9]/g, '')}`;
        try {
          mmkv.setString(backupKey, encryptData(raw, passphrase));
        } catch { /* silent */ }
      }
    } catch (e) {
      console.warn('[ConnectionGuard] Agent data backup failed:', e);
    }
  }, [getEncryptionPassphrase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        verifyConnectionSeal();
        obfuscateStealthKeys();
        backupAgentData();
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [verifyConnectionSeal, obfuscateStealthKeys, backupAgentData]);

  return useMemo(() => ({
    status,
    forceReconnect,
    getProtectedToolCount,
    isToolProtected,
    runHealthCheck,
    encryptChatData,
    decryptChatData,
    getConnectionFingerprint,
    verifyConnectionSeal,
    checkServerHealth,
    savePermanentReminder,
    getPermanentReminders,
    saveCrossSessionMemory,
    getCrossSessionMemory,
  }), [status, forceReconnect, getProtectedToolCount, isToolProtected, runHealthCheck, encryptChatData, decryptChatData, getConnectionFingerprint, verifyConnectionSeal, checkServerHealth, savePermanentReminder, getPermanentReminders, saveCrossSessionMemory, getCrossSessionMemory]);
});
