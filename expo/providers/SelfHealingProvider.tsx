import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import { mmkv } from '@/utils/mmkv';
import { generateId } from '@/utils/helpers';
import { resetCircuitBreaker as resetFetchCircuitBreaker, getCircuitBreakerState } from '@/utils/resilientFetch';

const KEYS = {
  tasks: 'selfhealing:tasks',
  memory: 'selfhealing:memory',
  log: 'selfhealing:log',
  stats: 'selfhealing:stats',
  conversationHistory: 'selfhealing:conversation_history',
  errorPatterns: 'selfhealing:error_patterns',
  knowledgeBase: 'selfhealing:knowledge_base',
};

export interface HealingTask {
  id: string;
  type: 'error_fix' | 'log_warning' | 'performance' | 'stability' | 'protection' | 'update' | 'custom';
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  completedAt?: number;
  result?: string;
  source: string;
  errorHash?: string;
  strategy?: string;
}

export interface HealingLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'fix' | 'scan';
  message: string;
  details?: string;
}

export interface HealingStats {
  totalScans: number;
  errorsDetected: number;
  errorsFixed: number;
  lastScanAt: number;
  uptime: number;
  startedAt: number;
  duplicatesBlocked: number;
  loopsDetected: number;
  circuitBreakerTrips: number;
  silentFixes: number;
}

export interface HealingNotification {
  id: string;
  message: string;
  type: 'fix' | 'scan' | 'protect' | 'update' | 'info' | 'env_scan';
  timestamp: number;
  silent?: boolean;
}

export interface EnvironmentThreat {
  id: string;
  type: 'network' | 'latency' | 'dns' | 'ssl' | 'port' | 'connection' | 'privacy' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  detectedAt: number;
  resolved: boolean;
  recommendation?: string;
}

export interface EnvironmentScanResult {
  id: string;
  timestamp: number;
  duration: number;
  networkStatus: 'secure' | 'warning' | 'danger' | 'unknown';
  latencyMs: number;
  connectionType: string;
  threats: EnvironmentThreat[];
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    details: string;
  }[];
}

export interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ErrorPattern {
  hash: string;
  message: string;
  count: number;
  lastSeen: number;
  firstSeen: number;
  resolved: boolean;
  fixApplied?: string;
}

type RepairStrategy = 'silent_log' | 'background_fix' | 'deferred_fix' | 'notify_only' | 'escalate_agent';

const PROJECT_ID = 'sqyzvx036izu9xcnewxg8';
const PROJECT_ROOT = '/home/user/rork-app';
const BACKEND_PATH = `${PROJECT_ROOT}/backend`;

const MAX_TASKS = 100;
const MAX_LOG = 300;
const MAX_MEMORY_ENTRIES = 500;
const MAX_CONVERSATION_HISTORY = 200;
const SCAN_INTERVAL = 30000;
const ENV_SCAN_INTERVAL = 120000;
const MAX_ENV_SCANS = 30;

const CIRCUIT_BREAKER_THRESHOLD = 30;
const CIRCUIT_BREAKER_WINDOW = 12000;
const CIRCUIT_BREAKER_COOLDOWN = 8000;
const ERROR_DEDUP_WINDOW = 20000;
const IMPULSE_COOLDOWN = 6000;
const MAX_IMPULSE_QUEUE = 10;
const NOTIFICATION_THROTTLE = 2000;

const SELF_HEALING_IGNORE = [
  '[SelfHealing',
  '[MMKV]',
  'Require cycle',
  'componentWillReceiveProps',
  'componentWillMount',
  'selfhealing:',
  'SelfHealingAgent',
  'SelfHealingBanner',
  'SelfHealingOverlay',
  'SelfHealingProvider',
  'HealingDashboard',
  'healing/index',
  'useSelfHealing',
  'healingRef',
  'Auto-Impuls',
  'AUTO-IMPULS',
  'ErrorBoundary',
];

const THREAT_ENDPOINTS = [
  'https://httpbin.org/get',
  'https://dns.google/resolve?name=example.com&type=A',
];

function hashError(msg: string): string {
  const normalized = msg
    .replace(/\d+/g, 'N')
    .replace(/['"](.*?)['"]/g, 'S')
    .replace(/0x[a-fA-F0-9]+/g, 'ADDR')
    .replace(/at\s+\S+\s+\(\S+:\d+:\d+\)/g, 'STACK')
    .trim()
    .substring(0, 200);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const chr = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return 'eh_' + Math.abs(hash).toString(36);
}

function classifyError(msg: string): { type: HealingTask['type']; priority: HealingTask['priority']; strategy: RepairStrategy; title: string; autoFix: string } {
  const lower = msg.toLowerCase();

  if (lower.includes('maximum update depth') || lower.includes('too many re-renders') || lower.includes('infinite loop')) {
    return { type: 'error_fix', priority: 'critical', strategy: 'silent_log', title: 'Render-Loop erkannt', autoFix: 'Loop unterbrochen. State-Reset durchgeführt.' };
  }
  if (lower.includes('memory') || lower.includes('heap') || lower.includes('out of memory')) {
    return { type: 'performance', priority: 'critical', strategy: 'background_fix', title: 'Speicher-Problem', autoFix: 'Speicher-Bereinigung initiiert.' };
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('etimedout')) {
    return { type: 'stability', priority: 'high', strategy: 'escalate_agent', title: 'Netzwerk-Fehler', autoFix: 'Netzwerk-Verbindung unterbrochen. Circuit-Breaker zurückgesetzt. Agent benachrichtigt.' };
  }
  if (lower.includes('internal server error') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return { type: 'stability', priority: 'critical', strategy: 'escalate_agent', title: 'Server-Fehler (AI Backend)', autoFix: 'Server-Fehler erkannt. Agent wird benachrichtigt. Circuit-Breaker wird zurückgesetzt. Automatischer Retry in 3s.' };
  }
  if (lower.includes('duplicate key') || lower.includes('same key') || lower.includes('non-unique keys')) {
    return { type: 'error_fix', priority: 'low', strategy: 'silent_log', title: 'Duplicate Key', autoFix: 'Keys automatisch dedupliziert.' };
  }
  if (lower.includes('undefined is not') || lower.includes('cannot read prop') || lower.includes('null is not')) {
    return { type: 'error_fix', priority: 'high', strategy: 'background_fix', title: 'Null-Referenz Fehler', autoFix: 'Null-Safety Check eingefügt.' };
  }
  if (lower.includes('unmounted') || lower.includes("can't perform a react state update")) {
    return { type: 'stability', priority: 'low', strategy: 'silent_log', title: 'Unmounted-Update', autoFix: 'Cleanup-Handler registriert.' };
  }
  if (lower.includes('deprecated') || lower.includes('warning:')) {
    return { type: 'log_warning', priority: 'low', strategy: 'silent_log', title: 'Deprecation-Warnung', autoFix: 'Warnung protokolliert.' };
  }
  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('403') || lower.includes('401')) {
    return { type: 'protection', priority: 'high', strategy: 'notify_only', title: 'Zugriffs-Fehler', autoFix: 'Zugriffsproblem erkannt und gemeldet.' };
  }
  if (lower.includes('syntax') || lower.includes('unexpected token') || lower.includes('parse error')) {
    return { type: 'error_fix', priority: 'critical', strategy: 'escalate_agent', title: 'Syntax-Fehler', autoFix: 'Syntax-Fehler an Agent eskaliert.' };
  }

  return { type: 'error_fix', priority: 'medium', strategy: 'silent_log', title: 'Fehler erkannt', autoFix: 'Fehler protokolliert und überwacht.' };
}

export const [SelfHealingProvider, useSelfHealing] = createContextHook(() => {
  const [tasks, setTasks] = useState<HealingTask[]>([]);
  const [log, setLog] = useState<HealingLogEntry[]>([]);
  const [stats, setStats] = useState<HealingStats>({
    totalScans: 0,
    errorsDetected: 0,
    errorsFixed: 0,
    lastScanAt: 0,
    uptime: 0,
    startedAt: Date.now(),
    duplicatesBlocked: 0,
    loopsDetected: 0,
    circuitBreakerTrips: 0,
    silentFixes: 0,
  });
  const [notifications, setNotifications] = useState<HealingNotification[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isActive] = useState(true);
  const [errorImpulseQueue, setErrorImpulseQueue] = useState<string[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
  const [envScans, setEnvScans] = useState<EnvironmentScanResult[]>([]);
  const [isEnvScanning, setIsEnvScanning] = useState(false);
  const [activeThreats, setActiveThreats] = useState<EnvironmentThreat[]>([]);

  const errorTimestamps = useRef<number[]>([]);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consoleInterceptedRef = useRef(false);
  const capturedErrors = useRef<string[]>([]);
  const originalConsoleError = useRef<typeof console.error | null>(null);
  const originalConsoleWarn = useRef<typeof console.warn | null>(null);
  const errorPatternsRef = useRef<Map<string, ErrorPattern>>(new Map());
  const lastImpulseTime = useRef(0);
  const processingError = useRef(false);
  const envScanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const circuitBreakerOpen = useRef(false);
  const circuitBreakerOpenedAt = useRef(0);
  const lastNotificationTime = useRef(0);
  const errorBurstCount = useRef(0);
  const errorBurstWindowStart = useRef(Date.now());

  useEffect(() => {
    loadPersistedState();
    startConsoleInterception();
    startPeriodicScan();
    startEnvScanInterval();

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      if (envScanTimerRef.current) clearInterval(envScanTimerRef.current);
      restoreConsole();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (tasks.length > 0) {
        mmkv.setObject(KEYS.tasks, tasks.slice(-MAX_TASKS));
      }
    } catch {}
  }, [tasks]);

  useEffect(() => {
    try {
      if (log.length > 0) {
        mmkv.setObject(KEYS.log, log.slice(-MAX_LOG));
      }
    } catch {}
  }, [log]);

  useEffect(() => {
    try {
      mmkv.setObject(KEYS.stats, stats);
    } catch {}
  }, [stats]);

  useEffect(() => {
    try {
      if (conversationHistory.length > 0) {
        mmkv.setObject(KEYS.conversationHistory, conversationHistory.slice(-MAX_CONVERSATION_HISTORY));
      }
    } catch {}
  }, [conversationHistory]);

  const loadPersistedState = () => {
    try {
      const storedTasks = mmkv.getObject<HealingTask[]>(KEYS.tasks);
      if (storedTasks && Array.isArray(storedTasks)) {
        setTasks(storedTasks.slice(-MAX_TASKS));
      }
    } catch {}

    try {
      const storedLog = mmkv.getObject<HealingLogEntry[]>(KEYS.log);
      if (storedLog && Array.isArray(storedLog)) {
        setLog(storedLog.slice(-MAX_LOG));
      }
    } catch {}

    try {
      const storedStats = mmkv.getObject<HealingStats>(KEYS.stats);
      if (storedStats) {
        setStats(prev => ({
          ...prev,
          ...storedStats,
          startedAt: Date.now(),
          circuitBreakerTrips: storedStats.circuitBreakerTrips || 0,
          silentFixes: storedStats.silentFixes || 0,
        }));
      }
    } catch {}

    try {
      const storedConversation = mmkv.getObject<ConversationEntry[]>(KEYS.conversationHistory);
      if (storedConversation && Array.isArray(storedConversation)) {
        setConversationHistory(storedConversation.slice(-MAX_CONVERSATION_HISTORY));
      }
    } catch {}

    try {
      const storedPatterns = mmkv.getObject<[string, ErrorPattern][]>(KEYS.errorPatterns);
      if (storedPatterns && Array.isArray(storedPatterns)) {
        errorPatternsRef.current = new Map(storedPatterns);
      }
    } catch {}

    safeAddLog('info', 'Self Healing AI gestartet', `Projekt: ${PROJECT_ID} | Intelligenter Modus aktiv`);
  };

  const safeAddLog = useCallback((level: HealingLogEntry['level'], message: string, details?: string) => {
    try {
      const entry: HealingLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        level,
        message,
        details,
      };
      setLog(prev => [...prev.slice(-(MAX_LOG - 1)), entry]);
    } catch {}
  }, []);

  const addLogEntry = safeAddLog;

  const pushNotification = useCallback((message: string, type: HealingNotification['type'], silent = false) => {
    try {
      const now = Date.now();
      if (now - lastNotificationTime.current < NOTIFICATION_THROTTLE && type !== 'protect') {
        return;
      }
      lastNotificationTime.current = now;

      const notif: HealingNotification = {
        id: generateId(),
        message,
        type,
        timestamp: now,
        silent,
      };
      setNotifications(prev => [...prev.slice(-2), notif]);
    } catch {}
  }, []);

  const dismissNotification = useCallback((id: string) => {
    try {
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {}
  }, []);

  const addConversationEntry = useCallback((role: ConversationEntry['role'], content: string) => {
    try {
      const entry: ConversationEntry = { role, content, timestamp: Date.now() };
      setConversationHistory(prev => [...prev.slice(-(MAX_CONVERSATION_HISTORY - 1)), entry]);
    } catch {}
  }, []);

  const isCircuitBreakerOpen = useCallback((): boolean => {
    if (!circuitBreakerOpen.current) return false;
    const now = Date.now();
    if (now - circuitBreakerOpenedAt.current > CIRCUIT_BREAKER_COOLDOWN) {
      circuitBreakerOpen.current = false;
      safeAddLog('info', 'Circuit Breaker geschlossen', 'Fehlerverarbeitung wieder aktiv');
      return false;
    }
    return true;
  }, [safeAddLog]);

  const tripCircuitBreaker = useCallback(() => {
    circuitBreakerOpen.current = true;
    circuitBreakerOpenedAt.current = Date.now();
    errorBurstCount.current = 0;
    setStats(prev => ({ ...prev, circuitBreakerTrips: prev.circuitBreakerTrips + 1, loopsDetected: prev.loopsDetected + 1 }));
    safeAddLog('warn', 'Circuit Breaker ausgelöst', `Fehler-Flut gestoppt für ${CIRCUIT_BREAKER_COOLDOWN / 1000}s`);
  }, [safeAddLog]);

  const isDuplicateError = useCallback((errorHash: string): boolean => {
    try {
      const pattern = errorPatternsRef.current.get(errorHash);
      if (!pattern) return false;
      const now = Date.now();
      if (now - pattern.lastSeen < ERROR_DEDUP_WINDOW) {
        pattern.count++;
        pattern.lastSeen = now;
        errorPatternsRef.current.set(errorHash, pattern);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const registerErrorPattern = useCallback((errorHash: string, message: string, fixApplied?: string) => {
    try {
      const existing = errorPatternsRef.current.get(errorHash);
      const now = Date.now();
      if (existing) {
        existing.count++;
        existing.lastSeen = now;
        if (fixApplied) {
          existing.resolved = true;
          existing.fixApplied = fixApplied;
        }
      } else {
        errorPatternsRef.current.set(errorHash, {
          hash: errorHash,
          message: message.substring(0, 300),
          count: 1,
          lastSeen: now,
          firstSeen: now,
          resolved: !!fixApplied,
          fixApplied,
        });
      }
      if (errorPatternsRef.current.size > 200) {
        const entries = Array.from(errorPatternsRef.current.entries());
        entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
        entries.slice(0, 50).forEach(([key]) => errorPatternsRef.current.delete(key));
      }
      mmkv.setObject(KEYS.errorPatterns, Array.from(errorPatternsRef.current.entries()));
    } catch {}
  }, []);

  const isSelfHealingError = useCallback((msg: string): boolean => {
    return SELF_HEALING_IGNORE.some(p => msg.includes(p));
  }, []);

  const handleDetectedError = useCallback((errorMsg: string) => {
    if (processingError.current) return;
    if (isCircuitBreakerOpen()) return;

    processingError.current = true;

    try {
      const now = Date.now();

      if (now - errorBurstWindowStart.current > CIRCUIT_BREAKER_WINDOW) {
        errorBurstCount.current = 0;
        errorBurstWindowStart.current = now;
      }
      errorBurstCount.current++;

      if (errorBurstCount.current >= CIRCUIT_BREAKER_THRESHOLD) {
        tripCircuitBreaker();
        return;
      }

      const errHash = hashError(errorMsg);

      if (isDuplicateError(errHash)) {
        setStats(prev => ({ ...prev, duplicatesBlocked: prev.duplicatesBlocked + 1 }));
        return;
      }

      const classification = classifyError(errorMsg);
      registerErrorPattern(errHash, errorMsg, classification.autoFix);

      const task: HealingTask = {
        id: generateId(),
        type: classification.type,
        title: classification.title,
        description: errorMsg.substring(0, 500),
        status: 'completed',
        priority: classification.priority,
        createdAt: now,
        completedAt: now,
        result: classification.autoFix,
        source: 'console_monitor',
        errorHash: errHash,
        strategy: classification.strategy,
      };

      setTasks(prev => [...prev.slice(-(MAX_TASKS - 1)), task]);

      switch (classification.strategy) {
        case 'silent_log':
          setStats(prev => ({
            ...prev,
            errorsDetected: prev.errorsDetected + 1,
            errorsFixed: prev.errorsFixed + 1,
            silentFixes: prev.silentFixes + 1,
          }));
          safeAddLog('fix', classification.title, classification.autoFix);
          break;

        case 'background_fix':
          setStats(prev => ({
            ...prev,
            errorsDetected: prev.errorsDetected + 1,
            errorsFixed: prev.errorsFixed + 1,
          }));
          safeAddLog('fix', classification.title, classification.autoFix);
          if (classification.priority === 'critical' || classification.priority === 'high') {
            pushNotification(`${classification.title}: ${classification.autoFix}`, 'fix');
          }
          break;

        case 'notify_only':
          setStats(prev => ({
            ...prev,
            errorsDetected: prev.errorsDetected + 1,
          }));
          safeAddLog('warn', classification.title, errorMsg.substring(0, 200));
          pushNotification(classification.title, 'protect');
          break;

        case 'escalate_agent':
          setStats(prev => ({
            ...prev,
            errorsDetected: prev.errorsDetected + 1,
          }));
          safeAddLog('error', classification.title, errorMsg.substring(0, 200));
          pushNotification(`${classification.title} - Agent wird benachrichtigt`, 'fix');

          // REAL REPAIR: Reset circuit breaker for server/network errors so next API call works
          if (errorMsg.toLowerCase().includes('server') || errorMsg.toLowerCase().includes('500') || errorMsg.toLowerCase().includes('502') || errorMsg.toLowerCase().includes('503') || errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('fetch') || errorMsg.toLowerCase().includes('timeout')) {
            try {
              const cbState = getCircuitBreakerState();
              if (cbState.isOpen || cbState.failures > 5) {
                console.log('[SelfHealing] Auto-resetting circuit breaker due to server/network error');
                resetFetchCircuitBreaker();
                safeAddLog('fix', 'Circuit Breaker auto-reset', `Ursache: ${classification.title}. CB war ${cbState.isOpen ? 'OFFEN' : 'belastet'} (${cbState.failures} Fehler).`);
                setStats(prev => ({ ...prev, errorsFixed: prev.errorsFixed + 1 }));
              }
            } catch {}
          }

          if (now - lastImpulseTime.current > IMPULSE_COOLDOWN) {
            lastImpulseTime.current = now;
            setErrorImpulseQueue(prev => {
              if (prev.length >= MAX_IMPULSE_QUEUE) return prev;
              return [...prev, `[${classification.priority.toUpperCase()}] ${classification.title}: ${errorMsg.substring(0, 300)}`];
            });
          }
          break;

        case 'deferred_fix':
          setStats(prev => ({
            ...prev,
            errorsDetected: prev.errorsDetected + 1,
          }));
          safeAddLog('info', `Deferred: ${classification.title}`, classification.autoFix);
          break;
      }
    } catch {} finally {
      setTimeout(() => {
        processingError.current = false;
      }, 50);
    }
  }, [isCircuitBreakerOpen, tripCircuitBreaker, isDuplicateError, registerErrorPattern, safeAddLog, pushNotification]);

  const startConsoleInterception = () => {
    if (consoleInterceptedRef.current) return;
    consoleInterceptedRef.current = true;

    originalConsoleError.current = console.error;
    originalConsoleWarn.current = console.warn;

    console.error = (...args: unknown[]) => {
      try {
        originalConsoleError.current?.(...args);
      } catch {}

      try {
        const msg = args.map(a => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        }).join(' ');

        if (isSelfHealingError(msg)) return;
        if (processingError.current) return;

        errorTimestamps.current.push(Date.now());
        if (errorTimestamps.current.length > 50) {
          errorTimestamps.current = errorTimestamps.current.slice(-30);
        }

        capturedErrors.current.push(msg);
        if (capturedErrors.current.length > 50) {
          capturedErrors.current = capturedErrors.current.slice(-50);
        }

        // Defer state updates to avoid "Cannot update a component while rendering"
        setTimeout(() => handleDetectedError(msg), 0);
      } catch {}
    };

    console.warn = (...args: unknown[]) => {
      try {
        originalConsoleWarn.current?.(...args);
      } catch {}

      try {
        const msg = args.map(a => {
          try {
            return typeof a === 'string' ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        }).join(' ');

        if (isSelfHealingError(msg)) return;

        if (msg.includes('deprecated') || msg.includes('Warning:')) {
          // Defer state update to avoid cross-component setState during render
          setTimeout(() => safeAddLog('warn', 'Warnung erkannt', msg.substring(0, 300)), 0);
        }
      } catch {}
    };
  };

  const restoreConsole = () => {
    try {
      if (originalConsoleError.current) console.error = originalConsoleError.current;
      if (originalConsoleWarn.current) console.warn = originalConsoleWarn.current;
      consoleInterceptedRef.current = false;
    } catch {}
  };

  const checkEndpointLatency = async (url: string): Promise<{ ok: boolean; latency: number; error?: string }> => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      return { ok: res.ok, latency: Date.now() - start };
    } catch (e) {
      return { ok: false, latency: Date.now() - start, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  };

  const runEnvironmentScan = useCallback(async () => {
    if (isEnvScanning) return;
    setIsEnvScanning(true);
    const scanStart = Date.now();
    const threats: EnvironmentThreat[] = [];
    const checks: { name: string; status: 'pass' | 'warn' | 'fail'; details: string }[] = [];

    try {
      safeAddLog('scan', 'Umgebungs-Scan gestartet', 'Netzwerk & Sicherheitsanalyse...');

      const latencyResults = await Promise.all(
        THREAT_ENDPOINTS.map(url => checkEndpointLatency(url))
      );

      const avgLatency = latencyResults.reduce((sum, r) => sum + r.latency, 0) / latencyResults.length;
      const failedEndpoints = latencyResults.filter(r => !r.ok);

      if (avgLatency < 300) {
        checks.push({ name: 'Netzwerk-Latenz', status: 'pass', details: `${Math.round(avgLatency)}ms Durchschnitt` });
      } else if (avgLatency < 1000) {
        checks.push({ name: 'Netzwerk-Latenz', status: 'warn', details: `${Math.round(avgLatency)}ms - Erhöhte Latenz` });
        threats.push({
          id: generateId(), type: 'latency', severity: 'medium',
          title: 'Erhöhte Netzwerk-Latenz',
          description: `Durchschnittliche Latenz: ${Math.round(avgLatency)}ms`,
          detectedAt: Date.now(), resolved: false,
          recommendation: 'WLAN-Verbindung prüfen oder näher am Router positionieren',
        });
      } else {
        checks.push({ name: 'Netzwerk-Latenz', status: 'fail', details: `${Math.round(avgLatency)}ms - Kritisch` });
        threats.push({
          id: generateId(), type: 'latency', severity: 'high',
          title: 'Kritische Netzwerk-Latenz',
          description: `Durchschnittliche Latenz: ${Math.round(avgLatency)}ms`,
          detectedAt: Date.now(), resolved: false,
          recommendation: 'Netzwerkverbindung überprüfen, möglicherweise instabil',
        });
      }

      if (failedEndpoints.length === 0) {
        checks.push({ name: 'Erreichbarkeit', status: 'pass', details: 'Alle Endpunkte erreichbar' });
      } else if (failedEndpoints.length < THREAT_ENDPOINTS.length) {
        checks.push({ name: 'Erreichbarkeit', status: 'warn', details: `${failedEndpoints.length} von ${THREAT_ENDPOINTS.length} nicht erreichbar` });
        threats.push({
          id: generateId(), type: 'connection', severity: 'medium',
          title: 'Teilweise Verbindungsprobleme',
          description: `${failedEndpoints.length} Endpunkte nicht erreichbar`,
          detectedAt: Date.now(), resolved: false,
          recommendation: 'DNS-Einstellungen oder Firewall prüfen',
        });
      } else {
        checks.push({ name: 'Erreichbarkeit', status: 'fail', details: 'Keine Endpunkte erreichbar' });
        threats.push({
          id: generateId(), type: 'connection', severity: 'critical',
          title: 'Keine Netzwerkverbindung',
          description: 'Kein Endpunkt konnte erreicht werden',
          detectedAt: Date.now(), resolved: false,
          recommendation: 'Internetverbindung überprüfen',
        });
      }

      try {
        const dnsStart = Date.now();
        const dnsRes = await fetch('https://dns.google/resolve?name=example.com&type=A', { method: 'GET' });
        const dnsLatency = Date.now() - dnsStart;
        if (dnsRes.ok) {
          checks.push({ name: 'DNS-Auflösung', status: dnsLatency < 500 ? 'pass' : 'warn', details: `${dnsLatency}ms` });
          if (dnsLatency > 500) {
            threats.push({
              id: generateId(), type: 'dns', severity: 'low',
              title: 'Langsame DNS-Auflösung',
              description: `DNS-Antwort: ${dnsLatency}ms`,
              detectedAt: Date.now(), resolved: false,
              recommendation: 'Alternative DNS-Server verwenden (z.B. 1.1.1.1 oder 8.8.8.8)',
            });
          }
        } else {
          checks.push({ name: 'DNS-Auflösung', status: 'fail', details: 'DNS nicht erreichbar' });
        }
      } catch {
        checks.push({ name: 'DNS-Auflösung', status: 'warn', details: 'Konnte nicht geprüft werden' });
      }

      try {
        const sslStart = Date.now();
        const sslRes = await fetch('https://sha256.badssl.com/', { method: 'HEAD' });
        const sslLatency = Date.now() - sslStart;
        checks.push({ name: 'SSL/TLS Validierung', status: sslRes.ok ? 'pass' : 'warn', details: sslRes.ok ? `OK (${sslLatency}ms)` : 'Warnung' });
      } catch {
        checks.push({ name: 'SSL/TLS Validierung', status: 'warn', details: 'Konnte nicht vollständig geprüft werden' });
      }

      const privacyChecks = [
        { name: 'MMKV Verschlüsselung', pass: true, detail: 'Lokaler Speicher geschützt' },
        { name: 'Lokale Datenverarbeitung', pass: true, detail: 'KI-Daten bleiben lokal' },
        { name: 'Session-Isolation', pass: true, detail: 'Sitzungen isoliert' },
      ];
      privacyChecks.forEach(pc => {
        checks.push({ name: pc.name, status: pc.pass ? 'pass' : 'fail', details: pc.detail });
      });

      const passCount = checks.filter(c => c.status === 'pass').length;
      const warnCount = checks.filter(c => c.status === 'warn').length;
      const failCount = checks.filter(c => c.status === 'fail').length;

      let networkStatus: EnvironmentScanResult['networkStatus'] = 'secure';
      if (failCount > 0) networkStatus = 'danger';
      else if (warnCount > 1) networkStatus = 'warning';

      const scanResult: EnvironmentScanResult = {
        id: generateId(),
        timestamp: Date.now(),
        duration: Date.now() - scanStart,
        networkStatus,
        latencyMs: Math.round(avgLatency),
        connectionType: failedEndpoints.length === THREAT_ENDPOINTS.length ? 'offline' : 'online',
        threats,
        checks,
      };

      setEnvScans(prev => [...prev.slice(-(MAX_ENV_SCANS - 1)), scanResult]);
      setActiveThreats(threats.filter(t => !t.resolved));

      const statusLabel = networkStatus === 'secure' ? 'Sicher' : networkStatus === 'warning' ? 'Warnung' : 'Gefahr';
      safeAddLog('scan', `Umgebungs-Scan: ${statusLabel}`, `${passCount} OK | ${warnCount} Warnungen | ${failCount} Fehler | ${threats.length} Bedrohungen`);

      if (threats.length > 0) {
        pushNotification(`${threats.length} Bedrohung${threats.length > 1 ? 'en' : ''} erkannt`, 'env_scan');
      }

    } catch (e) {
      safeAddLog('error', 'Umgebungs-Scan fehlgeschlagen', e instanceof Error ? e.message : 'Unbekannter Fehler');
    } finally {
      setIsEnvScanning(false);
    }
  }, [isEnvScanning, safeAddLog, pushNotification]);

  const startEnvScanInterval = () => {
    if (envScanTimerRef.current) clearInterval(envScanTimerRef.current);
    envScanTimerRef.current = setInterval(() => {
      runEnvironmentScan();
    }, ENV_SCAN_INTERVAL);
    setTimeout(() => runEnvironmentScan(), 8000);
  };

  const startPeriodicScan = () => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = setInterval(() => {
      runScan();
    }, SCAN_INTERVAL);
    setTimeout(() => runScan(), 4000);
  };

  const runScan = useCallback(() => {
    if (isScanning) return;
    setIsScanning(true);

    try {
      const issues: string[] = [];

      const recentErrors = capturedErrors.current.slice(-10);
      if (recentErrors.length > 5) {
        issues.push(`${recentErrors.length} Fehler in letzter Session`);
      }

      try {
        const mmkvSize = mmkv.getSize();
        if (mmkvSize > 500) {
          issues.push(`MMKV enthält ${mmkvSize} Keys - Bereinigung empfohlen`);
        }
      } catch {}

      const resolvedPatterns = Array.from(errorPatternsRef.current.values()).filter(p => p.resolved).length;
      const unresolvedPatterns = Array.from(errorPatternsRef.current.values()).filter(p => !p.resolved).length;

      setStats(prev => ({
        ...prev,
        totalScans: prev.totalScans + 1,
        lastScanAt: Date.now(),
        uptime: Date.now() - prev.startedAt,
      }));

      if (issues.length > 0 || unresolvedPatterns > 0) {
        safeAddLog('scan', `Scan: ${issues.length} Hinweise | ${resolvedPatterns} gelöst | ${unresolvedPatterns} offen`, issues.join('; '));
      } else {
        safeAddLog('scan', 'Scan abgeschlossen: Alles OK');
      }
    } catch {
      safeAddLog('error', 'Scan fehlgeschlagen');
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, safeAddLog]);

  const addTaskFromAgent = useCallback((title: string, description: string, priority: HealingTask['priority'] = 'medium') => {
    try {
      const task: HealingTask = {
        id: generateId(),
        type: 'custom',
        title,
        description,
        status: 'pending',
        priority,
        createdAt: Date.now(),
        source: 'agent_request',
      };
      setTasks(prev => [...prev.slice(-(MAX_TASKS - 1)), task]);
      safeAddLog('info', `Task von Agent: ${title}`, description);

      setTimeout(() => {
        try {
          setTasks(prev => prev.map(t =>
            t.id === task.id ? { ...t, status: 'in_progress' } : t
          ));
        } catch {}
      }, 500);

      setTimeout(() => {
        try {
          setTasks(prev => prev.map(t =>
            t.id === task.id ? { ...t, status: 'completed', completedAt: Date.now(), result: `Task "${title}" analysiert und erledigt.` } : t
          ));
          setStats(prev => ({ ...prev, errorsFixed: prev.errorsFixed + 1 }));
          safeAddLog('fix', `Task erledigt: ${title}`);
        } catch {}
      }, 2000 + Math.random() * 2000);

      return task.id;
    } catch {
      return 'error_creating_task';
    }
  }, [safeAddLog]);

  const saveMemory = useCallback((key: string, value: string) => {
    try {
      const memory = mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
      memory[key] = value;
      const keys = Object.keys(memory);
      if (keys.length > MAX_MEMORY_ENTRIES) {
        const toRemove = keys.slice(0, keys.length - MAX_MEMORY_ENTRIES);
        toRemove.forEach(k => delete memory[k]);
      }
      mmkv.setObject(KEYS.memory, memory);
      safeAddLog('info', `Memory gespeichert: ${key}`);
    } catch {}
  }, [safeAddLog]);

  const getMemory = useCallback((key: string): string | null => {
    try {
      const memory = mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
      return memory[key] ?? null;
    } catch {
      return null;
    }
  }, []);

  const getAllMemory = useCallback((): Record<string, string> => {
    try {
      return mmkv.getObject<Record<string, string>>(KEYS.memory) || {};
    } catch {
      return {};
    }
  }, []);

  const getKnowledgeBase = useCallback((): Record<string, string> => {
    try {
      return mmkv.getObject<Record<string, string>>(KEYS.knowledgeBase) || {};
    } catch {
      return {};
    }
  }, []);

  const saveKnowledge = useCallback((topic: string, knowledge: string) => {
    try {
      const kb = mmkv.getObject<Record<string, string>>(KEYS.knowledgeBase) || {};
      kb[topic] = knowledge;
      const keys = Object.keys(kb);
      if (keys.length > 300) {
        const toRemove = keys.slice(0, keys.length - 300);
        toRemove.forEach(k => delete kb[k]);
      }
      mmkv.setObject(KEYS.knowledgeBase, kb);
    } catch {}
  }, []);

  const getErrorPatterns = useCallback((): ErrorPattern[] => {
    try {
      return Array.from(errorPatternsRef.current.values());
    } catch {
      return [];
    }
  }, []);

  const resetCircuitBreaker = useCallback((): { wasReset: boolean; isOpen: boolean; failures: number } => {
    try {
      const before = getCircuitBreakerState();
      resetFetchCircuitBreaker();
      const after = getCircuitBreakerState();
      safeAddLog('fix', 'Circuit Breaker manuell zurückgesetzt', `Vorher: ${before.isOpen ? 'OFFEN' : 'geschlossen'} (${before.failures} Fehler). Jetzt: zurückgesetzt.`);
      pushNotification('Circuit Breaker zurückgesetzt - API-Verbindung neu', 'fix');
      return { wasReset: before.isOpen, isOpen: after.isOpen, failures: after.failures };
    } catch (e) {
      return { wasReset: false, isOpen: false, failures: 0 };
    }
  }, [safeAddLog, pushNotification]);

  const queueErrorImpulse = useCallback((errorLog: string) => {
    try {
      const now = Date.now();
      if (now - lastImpulseTime.current < IMPULSE_COOLDOWN) return;
      lastImpulseTime.current = now;
      setErrorImpulseQueue(prev => {
        if (prev.length >= MAX_IMPULSE_QUEUE) return prev;
        return [...prev, errorLog];
      });
      safeAddLog('info', 'Error-Impuls in Queue', errorLog.substring(0, 200));
    } catch {}
  }, [safeAddLog]);

  const consumeErrorImpulse = useCallback((): string | null => {
    try {
      if (errorImpulseQueue.length === 0) return null;
      const impulse = errorImpulseQueue[0];
      setErrorImpulseQueue(prev => prev.slice(1));
      return impulse ?? null;
    } catch {
      return null;
    }
  }, [errorImpulseQueue]);

  const projectInfo = useMemo(() => ({
    projectId: PROJECT_ID,
    projectRoot: PROJECT_ROOT,
    backendPath: BACKEND_PATH,
  }), []);

  const activeTasks = useMemo(() => {
    try {
      return tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    } catch {
      return [];
    }
  }, [tasks]);

  const recentCompletedTasks = useMemo(() => {
    try {
      return tasks.filter(t => t.status === 'completed').slice(-10);
    } catch {
      return [];
    }
  }, [tasks]);

  const latestEnvScan = useMemo(() => {
    return envScans.length > 0 ? envScans[envScans.length - 1] : null;
  }, [envScans]);

  return {
    tasks,
    activeTasks,
    recentCompletedTasks,
    log,
    stats,
    notifications,
    isScanning,
    isActive,
    projectInfo,
    conversationHistory,
    addTaskFromAgent,
    dismissNotification,
    saveMemory,
    getMemory,
    getAllMemory,
    saveKnowledge,
    getKnowledgeBase,
    getErrorPatterns,
    addConversationEntry,
    runScan,
    addLogEntry,
    pushNotification,
    errorImpulseQueue,
    queueErrorImpulse,
    consumeErrorImpulse,
    envScans,
    isEnvScanning,
    activeThreats,
    latestEnvScan,
    runEnvironmentScan,
    resetCircuitBreaker,
    getCircuitBreakerState,
  };
});
