import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import createContextHook from '@nkzw/create-context-hook';
import { mmkv } from '@/utils/mmkv';
import { generateId } from '@/utils/helpers';

const KEYS = {
  bgState: 'bg:state',
  bgTasks: 'bg:tasks',
  bgHistory: 'bg:history',
  bgStats: 'bg:stats',
};

export interface BackgroundTask {
  id: string;
  name: string;
  type: 'ai_task' | 'scan' | 'sync' | 'healing' | 'network' | 'custom';
  status: 'running' | 'paused' | 'completed' | 'failed';
  startedAt: number;
  pausedAt?: number;
  resumedAt?: number;
  completedAt?: number;
  progress?: number;
  details?: string;
}

export interface BackgroundSession {
  id: string;
  wentBackgroundAt: number;
  returnedAt?: number;
  duration: number;
  tasksCompleted: number;
  tasksPaused: number;
  wasActive: boolean;
}

export interface BackgroundStats {
  totalBackgroundSessions: number;
  totalBackgroundTime: number;
  tasksCompletedInBackground: number;
  lastBackgroundAt: number;
  lastForegroundAt: number;
  isInBackground: boolean;
  currentSessionStart: number;
}

const MAX_HISTORY = 50;
const MAX_TASKS = 30;

export const [BackgroundTaskProvider, useBackgroundTasks] = createContextHook(() => {
  const [isBackground, setIsBackground] = useState(false);
  const [activeTasks, setActiveTasks] = useState<BackgroundTask[]>([]);
  const [sessionHistory, setSessionHistory] = useState<BackgroundSession[]>([]);
  const [stats, setStats] = useState<BackgroundStats>({
    totalBackgroundSessions: 0,
    totalBackgroundTime: 0,
    tasksCompletedInBackground: 0,
    lastBackgroundAt: 0,
    lastForegroundAt: Date.now(),
    isInBackground: false,
    currentSessionStart: Date.now(),
  });
  const [returnBanner, setReturnBanner] = useState<{
    visible: boolean;
    duration: number;
    tasksCompleted: number;
    tasksContinued: number;
  }>({ visible: false, duration: 0, tasksCompleted: 0, tasksContinued: 0 });

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backgroundStartRef = useRef<number>(0);
  const currentSessionRef = useRef<string>('');
  const sessionHistoryRef = useRef(sessionHistory);
  sessionHistoryRef.current = sessionHistory;

  const loadPersistedState = useCallback(() => {
    try {
      const storedTasks = mmkv.getObject<BackgroundTask[]>(KEYS.bgTasks);
      if (storedTasks && Array.isArray(storedTasks)) {
        const resumed = storedTasks.map(t => {
          if (t.status === 'running' || t.status === 'paused') {
            return { ...t, status: 'running' as const, resumedAt: Date.now() };
          }
          return t;
        });
        setActiveTasks(resumed.slice(-MAX_TASKS));
      }
    } catch {}

    try {
      const storedHistory = mmkv.getObject<BackgroundSession[]>(KEYS.bgHistory);
      if (storedHistory && Array.isArray(storedHistory)) {
        setSessionHistory(storedHistory.slice(-MAX_HISTORY));
      }
    } catch {}

    try {
      const storedStats = mmkv.getObject<BackgroundStats>(KEYS.bgStats);
      if (storedStats) {
        setStats(prev => ({ ...prev, ...storedStats, isInBackground: false, lastForegroundAt: Date.now() }));
      }
    } catch {}

    console.log('[BackgroundTask] Provider initialized');
  }, []);

  const handleGoBackground = useCallback(() => {
    const now = Date.now();
    backgroundStartRef.current = now;
    currentSessionRef.current = generateId();
    setIsBackground(true);

    setStats(prev => ({
      ...prev,
      isInBackground: true,
      lastBackgroundAt: now,
    }));

    setActiveTasks(prev => prev.map(t => {
      if (t.status === 'running') {
        return { ...t, status: 'running' as const, details: (t.details || '') + ' [BG]' };
      }
      return t;
    }));

    try {
      mmkv.setObject(KEYS.bgState, {
        isBackground: true,
        startedAt: now,
        sessionId: currentSessionRef.current,
      });
    } catch {}

    if (Platform.OS !== 'web') {
      backgroundTimerRef.current = setInterval(() => {
        setActiveTasks(prev => prev.map(t => {
          if (t.status === 'running' && t.progress !== undefined && t.progress < 100) {
            return { ...t, progress: Math.min(100, t.progress + 5) };
          }
          return t;
        }));
      }, 3000);
    }

    console.log('[BackgroundTask] App went to background');
  }, []);

  const handleReturnForeground = useCallback(() => {
    const now = Date.now();
    const bgDuration = backgroundStartRef.current > 0 ? now - backgroundStartRef.current : 0;
    setIsBackground(false);

    if (backgroundTimerRef.current) {
      clearInterval(backgroundTimerRef.current);
      backgroundTimerRef.current = null;
    }

    let completedCount = 0;
    let continuedCount = 0;

    setActiveTasks(prev => {
      return prev.map(t => {
        if (t.status === 'running') {
          if (t.progress !== undefined && t.progress >= 100) {
            completedCount++;
            return { ...t, status: 'completed' as const, completedAt: now };
          }
          continuedCount++;
          const newDetails = (t.details || '').replace(' [BG]', '');
          return { ...t, details: newDetails, resumedAt: now };
        }
        return t;
      });
    });

    const session: BackgroundSession = {
      id: currentSessionRef.current || generateId(),
      wentBackgroundAt: backgroundStartRef.current,
      returnedAt: now,
      duration: bgDuration,
      tasksCompleted: completedCount,
      tasksPaused: continuedCount,
      wasActive: completedCount > 0 || continuedCount > 0,
    };

    setSessionHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), session]);
    try {
      mmkv.setObject(KEYS.bgHistory, [...sessionHistoryRef.current.slice(-(MAX_HISTORY - 1)), session]);
    } catch {}

    setStats(prev => ({
      ...prev,
      isInBackground: false,
      lastForegroundAt: now,
      totalBackgroundSessions: prev.totalBackgroundSessions + 1,
      totalBackgroundTime: prev.totalBackgroundTime + bgDuration,
      tasksCompletedInBackground: prev.tasksCompletedInBackground + completedCount,
    }));

    if (bgDuration > 2000) {
      setReturnBanner({
        visible: true,
        duration: bgDuration,
        tasksCompleted: completedCount,
        tasksContinued: continuedCount,
      });

      setTimeout(() => {
        setReturnBanner(prev => ({ ...prev, visible: false }));
      }, 5000);
    }

    try {
      mmkv.setObject(KEYS.bgState, { isBackground: false, returnedAt: now });
    } catch {}

    backgroundStartRef.current = 0;
    console.log('[BackgroundTask] App returned to foreground after', Math.round(bgDuration / 1000), 's');
  }, []);

  const handleAppStateChange = useCallback((nextAppState: AppStateStatus) => {
    const prevState = appStateRef.current;
    appStateRef.current = nextAppState;

    if (prevState === 'active' && (nextAppState === 'inactive' || nextAppState === 'background')) {
      handleGoBackground();
    } else if ((prevState === 'inactive' || prevState === 'background') && nextAppState === 'active') {
      handleReturnForeground();
    }
  }, [handleGoBackground, handleReturnForeground]);

  useEffect(() => {
    loadPersistedState();
  }, [loadPersistedState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      if (backgroundTimerRef.current) clearInterval(backgroundTimerRef.current);
    };
  }, [handleAppStateChange]);

  useEffect(() => {
    try {
      if (activeTasks.length > 0) {
        mmkv.setObject(KEYS.bgTasks, activeTasks.slice(-MAX_TASKS));
      }
    } catch {}
  }, [activeTasks]);

  useEffect(() => {
    try {
      mmkv.setObject(KEYS.bgStats, stats);
    } catch {}
  }, [stats]);

  const registerTask = useCallback((name: string, type: BackgroundTask['type'], details?: string): string => {
    const task: BackgroundTask = {
      id: generateId(),
      name,
      type,
      status: 'running',
      startedAt: Date.now(),
      progress: 0,
      details,
    };
    setActiveTasks(prev => [...prev.slice(-(MAX_TASKS - 1)), task]);
    console.log('[BackgroundTask] Registered:', name);
    return task.id;
  }, []);

  const updateTaskProgress = useCallback((taskId: string, progress: number, details?: string) => {
    setActiveTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updates: Partial<BackgroundTask> = { progress: Math.min(100, progress) };
        if (details) updates.details = details;
        if (progress >= 100) {
          updates.status = 'completed';
          updates.completedAt = Date.now();
        }
        return { ...t, ...updates };
      }
      return t;
    }));
  }, []);

  const completeTask = useCallback((taskId: string, result?: string) => {
    setActiveTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, status: 'completed' as const, completedAt: Date.now(), progress: 100, details: result || t.details };
      }
      return t;
    }));
  }, []);

  const failTask = useCallback((taskId: string, error?: string) => {
    setActiveTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, status: 'failed' as const, completedAt: Date.now(), details: error || t.details };
      }
      return t;
    }));
  }, []);

  const dismissReturnBanner = useCallback(() => {
    setReturnBanner(prev => ({ ...prev, visible: false }));
  }, []);

  const runningTasks = useMemo(() => {
    return activeTasks.filter(t => t.status === 'running');
  }, [activeTasks]);

  const recentCompleted = useMemo(() => {
    return activeTasks.filter(t => t.status === 'completed').slice(-10);
  }, [activeTasks]);

  return {
    isBackground,
    activeTasks,
    runningTasks,
    recentCompleted,
    sessionHistory,
    stats,
    returnBanner,
    registerTask,
    updateTaskProgress,
    completeTask,
    failTask,
    dismissReturnBanner,
  };
});
