import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';

const cache = new Map<string, string>();
let initialized = false;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const PREFIX = '@mmkv:';
const CRITICAL_KEYS = new Set([
  'ai:memory', 'app:conversations', 'app:projects', 'app:settings',
  'app:currentConversationId', 'selfhealing:memory', 'selfhealing:stats',
  'selfhealing:knowledge_base', 'selfhealing:agent:memory',
  'selfhealing:agent:knowledge', 'agent:primary:working_memory',
  'agent:secondary:working_memory', 'permanent:reminders',
  'cross:session_memory', 'guard:connection_status',
]);
const dirtyKeys = new Set<string>();
let flushInProgress = false;
let appStateListener: { remove: () => void } | null = null;

async function init() {
  if (initialized) return;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mmkvKeys = (keys || []).filter(k => k.startsWith(PREFIX));
    if (mmkvKeys.length > 0) {
      const pairs = await AsyncStorage.multiGet(mmkvKeys);
      for (const pair of pairs) {
        if (pair && pair[0] && pair[1] != null) {
          cache.set(pair[0].replace(PREFIX, ''), pair[1]);
        }
      }
    }
    initialized = true;
    console.log('[MMKV] Initialized with', cache.size, 'keys');

    if (!appStateListener && Platform.OS !== 'web') {
      appStateListener = AppState.addEventListener('change', handleAppStateChange);
    }
  } catch (e) {
    console.warn('[MMKV] Init failed, continuing with empty cache:', e);
    initialized = true;
  }
}

function handleAppStateChange(nextState: AppStateStatus) {
  if (nextState === 'background' || nextState === 'inactive') {
    void flushDirtyKeys();
  }
}

async function flushDirtyKeys(): Promise<void> {
  if (flushInProgress || dirtyKeys.size === 0) return;
  flushInProgress = true;

  try {
    const keysToFlush = Array.from(dirtyKeys);
    dirtyKeys.clear();

    const setPairs: [string, string][] = [];
    const removeKeys: string[] = [];

    for (const key of keysToFlush) {
      const val = cache.get(key);
      if (val !== undefined) {
        setPairs.push([PREFIX + key, val]);
      } else {
        removeKeys.push(PREFIX + key);
      }
    }

    if (setPairs.length > 0) {
      await AsyncStorage.multiSet(setPairs);
    }
    if (removeKeys.length > 0) {
      await AsyncStorage.multiRemove(removeKeys);
    }

    console.log('[MMKV] Flushed', keysToFlush.length, 'dirty keys');
  } catch (e) {
    console.error('[MMKV] Flush dirty keys failed:', e);
  } finally {
    flushInProgress = false;
  }
}

function scheduleWrite(key: string, value: string | null) {
  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing);

  dirtyKeys.add(key);

  const isCritical = CRITICAL_KEYS.has(key) || key.startsWith('permanent:') || key.startsWith('cross:');

  if (isCritical) {
    void (async () => {
      try {
        if (value === null) {
          await AsyncStorage.removeItem(PREFIX + key);
        } else {
          await AsyncStorage.setItem(PREFIX + key, value);
        }
        dirtyKeys.delete(key);
        pendingWrites.delete(key);
      } catch (e) {
        console.error('[MMKV] Critical write failed for', key, e);
      }
    })();
    return;
  }

  const timer = setTimeout(async () => {
    try {
      if (value === null) {
        await AsyncStorage.removeItem(PREFIX + key);
      } else {
        await AsyncStorage.setItem(PREFIX + key, value);
      }
      dirtyKeys.delete(key);
      pendingWrites.delete(key);
    } catch (e) {
      console.error('[MMKV] Write failed for', key, e);
    }
  }, 100);

  pendingWrites.set(key, timer);
}

export const mmkv = {
  init,

  getString(key: string): string | null {
    return cache.get(key) ?? null;
  },

  setString(key: string, value: string): void {
    cache.set(key, value);
    scheduleWrite(key, value);
  },

  getObject<T>(key: string): T | null {
    const raw = cache.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setObject(key: string, value: unknown): void {
    try {
      const json = JSON.stringify(value);
      cache.set(key, json);
      scheduleWrite(key, json);
    } catch (e) {
      console.error('[MMKV] setObject failed:', e);
    }
  },

  getNumber(key: string): number | null {
    const raw = cache.get(key);
    if (raw == null) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  },

  setNumber(key: string, value: number): void {
    cache.set(key, String(value));
    scheduleWrite(key, String(value));
  },

  getBoolean(key: string): boolean | null {
    const raw = cache.get(key);
    if (raw == null) return null;
    return raw === 'true';
  },

  setBoolean(key: string, value: boolean): void {
    cache.set(key, String(value));
    scheduleWrite(key, String(value));
  },

  delete(key: string): void {
    cache.delete(key);
    scheduleWrite(key, null);
  },

  has(key: string): boolean {
    return cache.has(key);
  },

  getAllKeys(): string[] {
    return Array.from(cache.keys());
  },

  getKeysWithPrefix(prefix: string): string[] {
    return Array.from(cache.keys()).filter(k => k.startsWith(prefix));
  },

  async flush(): Promise<void> {
    await flushDirtyKeys();

    const entries = Array.from(cache.entries());
    const pairs: [string, string][] = entries.map(([k, v]) => [PREFIX + k, v]);
    try {
      const batchSize = 50;
      for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        await AsyncStorage.multiSet(batch);
      }
      console.log('[MMKV] Full flush complete:', pairs.length, 'keys');
    } catch (e) {
      console.error('[MMKV] Flush failed:', e);
    }
  },

  async flushCritical(): Promise<void> {
    const criticalEntries: [string, string][] = [];
    for (const key of CRITICAL_KEYS) {
      const val = cache.get(key);
      if (val !== undefined) {
        criticalEntries.push([PREFIX + key, val]);
      }
    }
    if (criticalEntries.length > 0) {
      try {
        await AsyncStorage.multiSet(criticalEntries);
        console.log('[MMKV] Critical flush:', criticalEntries.length, 'keys');
      } catch (e) {
        console.error('[MMKV] Critical flush failed:', e);
      }
    }
  },

  clear(): void {
    const keys = Array.from(cache.keys());
    cache.clear();
    dirtyKeys.clear();
    keys.forEach(k => scheduleWrite(k, null));
  },

  getSize(): number {
    return cache.size;
  },

  getCacheSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    cache.forEach((v, k) => { snapshot[k] = v; });
    return snapshot;
  },

  markCritical(key: string): void {
    CRITICAL_KEYS.add(key);
  },
};
