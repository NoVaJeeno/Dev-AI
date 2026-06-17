import { useRef, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { createRorkTool, useRorkAgent, generateText } from '@rork-ai/toolkit-sdk';
import { mmkv } from '@/utils/mmkv';
import { useSelfHealing } from '@/providers/SelfHealingProvider';
import { useStorage } from '@/providers/StorageProvider';
import { getFileLanguage } from '@/utils/helpers';
import { PROJECT_TEMPLATES } from '@/constants/templates';
import { resilientFetch, resetCircuitBreaker, getCircuitBreakerState } from '@/utils/resilientFetch';
import { buildMemoryContext } from '@/utils/memoryContext';
import {
  getStoredToken,
  storeToken,
  clearToken,
  checkTokenValidity,
  listRepos,
  createRepo,
  pushMultipleFiles,
  deleteRepo,
  getRepoContents,
  setActiveRepo,
  getActiveRepo,
  getStoredUser,
} from '@/utils/github';

const HEALING_MEMORY_KEY = 'selfhealing:agent:memory';
const HEALING_CHAT_KEY = 'selfhealing:agent:chat_history';
const HEALING_KNOWLEDGE_KEY = 'selfhealing:agent:knowledge';
const PERMANENT_REMINDER_KEY = 'permanent:reminders';
const CROSS_SESSION_KEY = 'cross:session_memory';
const PROJECT_ID = 'sqyzvx036izu9xcnewxg8';
const PROJECT_ROOT = '/home/user/rork-app';
const BACKEND_PATH = `${PROJECT_ROOT}/backend`;

const AUTO_IMPULSE_COOLDOWN = 5000;
const MAX_AUTO_IMPULSE_PER_MINUTE = 20;
const IMPULSE_PROCESSING_LOCKOUT = 3500;
const LOOP_DETECTION_WINDOW = 20000;
const LOOP_TOOL_CALL_THRESHOLD = 200;
const SERVER_ERROR_RETRY_MAX = 3;
const SERVER_ERROR_RETRY_DELAY_BASE = 2000;

export function useSelfHealingAgent() {
  const healing = useSelfHealing();
  const storage = useStorage();
  const healingRef = useRef(healing);
  const storageRef = useRef(storage);
  const lastAutoImpulseTime = useRef(0);
  const autoImpulseCount = useRef(0);
  const autoImpulseWindowStart = useRef(Date.now());
  const isProcessingImpulse = useRef(false);
  const toolCallTimestamps = useRef<number[]>([]);
  const loopWarningIssued = useRef(false);

  useEffect(() => {
    healingRef.current = healing;
  }, [healing]);

  useEffect(() => {
    storageRef.current = storage;
  }, [storage]);

  const saveHealingMemory = useCallback((key: string, value: string) => {
    try {
      const mem = mmkv.getObject<Record<string, string>>(HEALING_MEMORY_KEY) || {};
      mem[key] = value;
      const keys = Object.keys(mem);
      if (keys.length > 300) {
        const toRemove = keys.slice(0, keys.length - 300);
        toRemove.forEach(k => delete mem[k]);
      }
      mmkv.setObject(HEALING_MEMORY_KEY, mem);
      console.log('[SelfHealingAgent] Memory saved:', key);
    } catch (e) {
      console.warn('[SelfHealingAgent] Memory save failed:', e);
    }
  }, []);

  const getHealingMemory = useCallback((key: string): string | null => {
    try {
      const mem = mmkv.getObject<Record<string, string>>(HEALING_MEMORY_KEY) || {};
      return mem[key] ?? null;
    } catch {
      return null;
    }
  }, []);

  const getAllHealingMemory = useCallback((): Record<string, string> => {
    try {
      return mmkv.getObject<Record<string, string>>(HEALING_MEMORY_KEY) || {};
    } catch {
      return {};
    }
  }, []);

  const saveKnowledge = useCallback((topic: string, content: string) => {
    try {
      const kb = mmkv.getObject<Record<string, string>>(HEALING_KNOWLEDGE_KEY) || {};
      kb[topic] = content;
      mmkv.setObject(HEALING_KNOWLEDGE_KEY, kb);
    } catch {}
  }, []);

  const getKnowledge = useCallback((): Record<string, string> => {
    try {
      return mmkv.getObject<Record<string, string>>(HEALING_KNOWLEDGE_KEY) || {};
    } catch {
      return {};
    }
  }, []);

  const checkForLoop = useCallback((): boolean => {
    const now = Date.now();
    toolCallTimestamps.current.push(now);
    toolCallTimestamps.current = toolCallTimestamps.current.filter(t => now - t < LOOP_DETECTION_WINDOW);
    if (toolCallTimestamps.current.length >= LOOP_TOOL_CALL_THRESHOLD) {
      if (!loopWarningIssued.current) {
        loopWarningIssued.current = true;
        console.warn('[SelfHealingAgent] Loop detected! Tool calls throttled.');
        setTimeout(() => { loopWarningIssued.current = false; }, 30000);
      }
      return true;
    }
    return false;
  }, []);

  const canSendAutoImpulse = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastAutoImpulseTime.current < AUTO_IMPULSE_COOLDOWN) return false;
    if (now - autoImpulseWindowStart.current > 60000) {
      autoImpulseCount.current = 0;
      autoImpulseWindowStart.current = now;
    }
    if (autoImpulseCount.current >= MAX_AUTO_IMPULSE_PER_MINUTE) return false;
    if (isProcessingImpulse.current) return false;
    if (checkForLoop()) return false;
    return true;
  }, [checkForLoop]);

  const agent = useRorkAgent({
    tools: {
      getProjectInfo: createRorkTool({
        description: 'Gibt die Projekt-ID, den Root-Pfad und Backend-Pfad zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            return JSON.stringify({
              projectId: PROJECT_ID,
              projectRoot: PROJECT_ROOT,
              backendPath: BACKEND_PATH,
              sdkVersion: 'Expo 54',
              runtime: 'React Native 0.81',
              appFiles: [
                'app/_layout.tsx', 'app/(tabs)/_layout.tsx', 'app/(tabs)/(chat)/index.tsx',
                'app/(tabs)/files/index.tsx', 'app/(tabs)/projects/index.tsx',
                'app/(tabs)/settings/index.tsx', 'app/(tabs)/terminal/index.tsx',
                'app/(tabs)/tools/index.tsx', 'app/(tabs)/workspace/index.tsx',
                'app/(tabs)/healing/index.tsx', 'app/login.tsx',
              ],
              providers: ['AuthProvider', 'StorageProvider', 'ConnectionGuard', 'SelfHealingProvider', 'BackgroundTaskProvider'],
              hooks: ['useDevAgent', 'useSecondAgent', 'useSelfHealingAgent'],
              components: [
                'AgentMessage', 'ChatInput', 'ChatMessage', 'ConversationList',
                'DevToolsPanel', 'LivePreview', 'SelfHealingBanner', 'SelfHealingOverlay',
                'ErrorBoundary', 'TaskActivityOverlay', 'AnimatedTerminalOutput', 'BackgroundIndicator',
              ],
              hasFullAccess: true,
              canModifyFrontend: true,
              canModifyBackend: true,
            });
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      scanErrors: createRorkTool({
        description: 'Scannt die App auf aktuelle Fehler und gibt den Status zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            const h = healingRef.current;
            const recentErrors = h.log.filter(l => l.level === 'error' || l.level === 'fix').slice(-20);
            const stats = h.stats;
            const patterns = h.getErrorPatterns();
            const unresolvedPatterns = patterns.filter(p => !p.resolved);
            return JSON.stringify({
              status: h.activeTasks.length > 0 || unresolvedPatterns.length > 0 ? 'issues_found' : 'healthy',
              totalScans: stats.totalScans,
              errorsDetected: stats.errorsDetected,
              errorsFixed: stats.errorsFixed,
              duplicatesBlocked: stats.duplicatesBlocked,
              loopsDetected: stats.loopsDetected,
              circuitBreakerTrips: stats.circuitBreakerTrips,
              silentFixes: stats.silentFixes,
              activeTasks: h.activeTasks.length,
              uptime: Math.floor(stats.uptime / 1000) + 's',
              unresolvedPatterns: unresolvedPatterns.length,
              recentErrors: recentErrors.map(e => ({
                level: e.level, message: e.message, details: e.details?.substring(0, 200),
                time: new Date(e.timestamp).toLocaleTimeString('de-DE'),
              })),
            });
          } catch (e) {
            return `Scan-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getErrorLogs: createRorkTool({
        description: 'Gibt die letzten Fehler-Logs zurück.',
        zodSchema: z.object({
          count: z.number().optional().describe('Anzahl der letzten Logs (Standard: 30)'),
          level: z.string().optional().describe('Filter nach Level: error, warn, fix, scan, info'),
        }),
        execute(input) {
          try {
            const h = healingRef.current;
            let logs = [...h.log];
            if (input.level) logs = logs.filter(l => l.level === input.level);
            const count = input.count || 30;
            return JSON.stringify(logs.slice(-count).map(l => ({
              level: l.level, message: l.message, details: l.details?.substring(0, 300),
              time: new Date(l.timestamp).toLocaleTimeString('de-DE'),
            })));
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getErrorPatterns: createRorkTool({
        description: 'Gibt alle erkannten Fehler-Muster zurück.',
        zodSchema: z.object({
          onlyUnresolved: z.boolean().optional(),
        }),
        execute(input) {
          try {
            let patterns = healingRef.current.getErrorPatterns();
            if (input.onlyUnresolved) patterns = patterns.filter(p => !p.resolved);
            return JSON.stringify(patterns.slice(-30).map(p => ({
              hash: p.hash, message: p.message, count: p.count, resolved: p.resolved,
              fixApplied: p.fixApplied,
              firstSeen: new Date(p.firstSeen).toLocaleTimeString('de-DE'),
              lastSeen: new Date(p.lastSeen).toLocaleTimeString('de-DE'),
            })));
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      createRepairTask: createRorkTool({
        description: 'Erstellt eine Reparatur-Aufgabe.',
        zodSchema: z.object({
          title: z.string(), description: z.string(),
          priority: z.enum(['low', 'medium', 'high', 'critical']),
        }),
        execute(input) {
          try {
            const taskId = healingRef.current.addTaskFromAgent(input.title, input.description, input.priority);
            return `Reparatur-Task erstellt (ID: ${taskId}): "${input.title}" mit Priorität ${input.priority}.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getAppHealth: createRorkTool({
        description: 'Gibt einen vollständigen Gesundheitsbericht der App zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            const h = healingRef.current;
            const mmkvSize = mmkv.getSize();
            const allKeys = mmkv.getAllKeys();
            const patterns = h.getErrorPatterns();
            return JSON.stringify({
              isActive: h.isActive, isScanning: h.isScanning, stats: h.stats,
              storage: { totalKeys: mmkvSize, agentKeys: allKeys.filter(k => k.startsWith('agent:')).length, healingKeys: allKeys.filter(k => k.startsWith('selfhealing:')).length },
              tasks: { active: h.activeTasks.length, recentCompleted: h.recentCompletedTasks.length, total: h.tasks.length },
              errorPatterns: { total: patterns.length, resolved: patterns.filter(p => p.resolved).length, unresolved: patterns.filter(p => !p.resolved).length },
              conversationHistory: h.conversationHistory.length,
              projectId: PROJECT_ID, projectRoot: PROJECT_ROOT,
            });
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      triggerScan: createRorkTool({
        description: 'Startet einen manuellen Scan.',
        zodSchema: z.object({}),
        execute() {
          try { healingRef.current.runScan(); return 'Scan gestartet.'; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      triggerEnvScan: createRorkTool({
        description: 'Startet einen Umgebungs-Scan (Netzwerk, DNS, SSL, Latenz).',
        zodSchema: z.object({}),
        execute() {
          try { void healingRef.current.runEnvironmentScan(); return 'Umgebungs-Scan gestartet.'; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      saveMemory: createRorkTool({
        description: 'Speichert eine Erinnerung im Self Healing Langzeit-Speicher.',
        zodSchema: z.object({ key: z.string(), value: z.string() }),
        execute(input) {
          try {
            healingRef.current.saveMemory(input.key, input.value);
            return `Erinnerung gespeichert: "${input.key}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      recallMemory: createRorkTool({
        description: 'Ruft eine Erinnerung ab.',
        zodSchema: z.object({ key: z.string() }),
        execute(input) {
          try {
            const val = healingRef.current.getMemory(input.key);
            if (!val) return `Keine Erinnerung für "${input.key}".`;
            return `Erinnerung "${input.key}": ${val}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      recallAllMemory: createRorkTool({
        description: 'Ruft alle Erinnerungen aus allen Speichern ab (Provider, Agent, Knowledge, Permanent, CrossSession).',
        zodSchema: z.object({}),
        execute() {
          try {
            const providerMem = healingRef.current.getAllMemory();
            const agentMem = getAllHealingMemory();
            const kb = getKnowledge();
            const permanent = mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {};
            const crossSession = mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY) || {};
            const mainMemory = storageRef.current.getAllMemory();
            const lines: string[] = [];
            Object.entries(providerMem).forEach(([k, v]) => lines.push(`[Healing] ${k}: ${v}`));
            Object.entries(agentMem).forEach(([k, v]) => lines.push(`[Agent] ${k}: ${v}`));
            Object.entries(kb).forEach(([k, v]) => lines.push(`[Knowledge] ${k}: ${v}`));
            Object.entries(permanent).forEach(([k, v]) => lines.push(`[PERMANENT] ${k}: ${v}`));
            Object.entries(crossSession).forEach(([k, v]) => lines.push(`[CrossSession] ${k}: ${v.value} (saved: ${new Date(v.savedAt).toLocaleString('de-DE')})`));
            Object.entries(mainMemory).forEach(([k, v]) => lines.push(`[MainAI] ${k}: ${v}`));
            if (lines.length === 0) return 'Keine Erinnerungen vorhanden.';
            return `${lines.length} Erinnerungen:\n${lines.join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      savePermanentReminder: createRorkTool({
        description: 'Speichert eine PERMANENTE Erinnerung die NIEMALS vergessen wird, auch nicht nach Session-Wechsel.',
        zodSchema: z.object({ key: z.string(), value: z.string() }),
        execute(input) {
          try {
            const reminders = mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {};
            reminders[input.key] = input.value;
            mmkv.setObject(PERMANENT_REMINDER_KEY, reminders);
            return `Permanente Erinnerung gespeichert: "${input.key}" = "${input.value}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getPermanentReminders: createRorkTool({
        description: 'Ruft alle permanenten Erinnerungen ab.',
        zodSchema: z.object({}),
        execute() {
          try {
            const reminders = mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {};
            const keys = Object.keys(reminders);
            if (keys.length === 0) return 'Keine permanenten Erinnerungen.';
            return `${keys.length} Permanente Erinnerungen:\n${keys.map(k => `• ${k}: ${reminders[k]}`).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      saveCrossSessionMemory: createRorkTool({
        description: 'Speichert Cross-Session Memory das über alle Sessions hinweg erhalten bleibt.',
        zodSchema: z.object({ key: z.string(), value: z.string() }),
        execute(input) {
          try {
            const mem = mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY) || {};
            mem[input.key] = { value: input.value, savedAt: Date.now() };
            mmkv.setObject(CROSS_SESSION_KEY, mem);
            return `Cross-Session Memory gespeichert: "${input.key}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getCrossSessionMemory: createRorkTool({
        description: 'Ruft Cross-Session Memory ab.',
        zodSchema: z.object({}),
        execute() {
          try {
            const mem = mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY) || {};
            const keys = Object.keys(mem);
            if (keys.length === 0) return 'Kein Cross-Session Memory.';
            return `${keys.length} Cross-Session Einträge:\n${keys.map(k => `• ${k}: ${mem[k].value} (${new Date(mem[k].savedAt).toLocaleString('de-DE')})`).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      saveKnowledgeTool: createRorkTool({
        description: 'Speichert Wissen in der Knowledge-Base.',
        zodSchema: z.object({ topic: z.string(), content: z.string() }),
        execute(input) {
          try {
            healingRef.current.saveKnowledge(input.topic, input.content);
            saveKnowledge(input.topic, input.content);
            return `Wissen gespeichert: "${input.topic}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getConversationHistory: createRorkTool({
        description: 'Gibt die Konversations-Historie zurück.',
        zodSchema: z.object({ count: z.number().optional() }),
        execute(input) {
          try {
            const history = healingRef.current.conversationHistory.slice(-(input.count || 50));
            if (history.length === 0) return 'Keine Konversations-Historie.';
            return JSON.stringify(history.map(e => ({
              role: e.role, content: e.content.substring(0, 500),
              time: new Date(e.timestamp).toLocaleTimeString('de-DE'),
            })));
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getTaskHistory: createRorkTool({
        description: 'Gibt die Historie aller Tasks zurück.',
        zodSchema: z.object({ status: z.enum(['all', 'pending', 'completed', 'failed']).optional() }),
        execute(input) {
          try {
            let filteredTasks = [...healingRef.current.tasks];
            if (input.status && input.status !== 'all') filteredTasks = filteredTasks.filter(t => t.status === input.status);
            return JSON.stringify(filteredTasks.slice(-20).map(t => ({
              id: t.id, title: t.title, type: t.type, status: t.status, priority: t.priority,
              result: t.result?.substring(0, 200), source: t.source, strategy: t.strategy,
              created: new Date(t.createdAt).toLocaleTimeString('de-DE'),
              completed: t.completedAt ? new Date(t.completedAt).toLocaleTimeString('de-DE') : undefined,
            })));
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      analyzeAndFix: createRorkTool({
        description: 'Analysiert einen Fehler und erstellt automatisch einen Fix-Task.',
        zodSchema: z.object({
          errorMessage: z.string(), suggestedFix: z.string(),
          affectedComponent: z.string().optional(),
        }),
        execute(input) {
          try {
            const h = healingRef.current;
            h.addLogEntry('fix', `Auto-Fix: ${input.suggestedFix}`, `Fehler: ${input.errorMessage}\nKomponente: ${input.affectedComponent || 'Unbekannt'}`);
            const taskId = h.addTaskFromAgent(`Fix: ${input.suggestedFix.substring(0, 60)}`, `Fehler: ${input.errorMessage}\nLösung: ${input.suggestedFix}\nKomponente: ${input.affectedComponent || 'N/A'}`, 'high');
            h.addConversationEntry('system', `Auto-Fix: ${input.suggestedFix} für ${input.affectedComponent || 'App'}`);
            return `Fix-Task erstellt (${taskId}): "${input.suggestedFix}".`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      checkStorageHealth: createRorkTool({
        description: 'Prüft den Zustand des MMKV-Speichers.',
        zodSchema: z.object({}),
        execute() {
          try {
            const size = mmkv.getSize();
            const keys = mmkv.getAllKeys();
            const categories: Record<string, number> = {};
            keys.forEach(k => { const prefix = k.split(':')[0] || 'other'; categories[prefix] = (categories[prefix] || 0) + 1; });
            return JSON.stringify({ totalKeys: size, categories, healthStatus: size > 500 ? 'needs_cleanup' : size > 200 ? 'moderate' : 'healthy' });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      cleanupStorage: createRorkTool({
        description: 'Bereinigt alten/unnötigen Speicher.',
        zodSchema: z.object({ olderThanDays: z.number().optional() }),
        execute(input) {
          try {
            const days = input.olderThanDays || 7;
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            const h = healingRef.current;
            const oldTasks = h.tasks.filter(t => t.status === 'completed' && t.createdAt < cutoff).length;
            const oldLogs = h.log.filter(l => l.timestamp < cutoff).length;
            healingRef.current.addLogEntry('info', `Speicher-Bereinigung: ${oldTasks + oldLogs} alte Einträge identifiziert`);
            return `Bereinigung: ${oldTasks + oldLogs} alte Einträge (${days} Tage Grenze).`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getAppFileStructure: createRorkTool({
        description: 'Gibt die vollständige Dateistruktur der App zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            return JSON.stringify({
              root: PROJECT_ROOT,
              structure: {
                'app/': { '_layout.tsx': 'Root Layout', 'login.tsx': 'Login', '(tabs)/': { '_layout.tsx': 'Tab Nav', '(chat)/index.tsx': 'Chat', 'files/index.tsx': 'Files', 'healing/index.tsx': 'Healing', 'projects/index.tsx': 'Projects', 'settings/index.tsx': 'Settings', 'terminal/index.tsx': 'Terminal', 'tools/index.tsx': 'Tools', 'workspace/index.tsx': 'Workspace' } },
                'components/': ['AgentMessage', 'ChatInput', 'ChatMessage', 'ConversationList', 'DevToolsPanel', 'LivePreview', 'SelfHealingBanner', 'SelfHealingOverlay', 'ErrorBoundary', 'TaskActivityOverlay', 'BackgroundIndicator'],
                'providers/': ['AuthProvider', 'ConnectionGuard', 'SelfHealingProvider', 'StorageProvider', 'BackgroundTaskProvider'],
                'hooks/': ['useDevAgent', 'useSecondAgent', 'useSelfHealingAgent'],
                'utils/': ['encryption', 'helpers', 'mmkv', 'resilientFetch'],
              },
              hasWriteAccess: true, hasFullFrontendAccess: true, hasFullBackendAccess: true,
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      sendImpulse: createRorkTool({
        description: 'Sendet einen Impuls/Nachricht als Benachrichtigung.',
        zodSchema: z.object({ message: z.string(), type: z.enum(['fix', 'scan', 'protect', 'update', 'info']) }),
        execute(input) {
          try { healingRef.current.pushNotification(input.message, input.type); return `Impuls gesendet: "${input.message}"`; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getAgentStatus: createRorkTool({
        description: 'Gibt den Status aller KI-Agenten zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            const primaryMem = mmkv.getObject<{ task: string; timestamp: number }>('agent:primary:working_memory');
            const secondaryMem = mmkv.getObject<{ task: string; timestamp: number }>('agent:secondary:working_memory');
            return JSON.stringify({
              primary: { lastTask: primaryMem?.task || 'Kein Task', lastActive: primaryMem?.timestamp ? new Date(primaryMem.timestamp).toLocaleTimeString('de-DE') : 'N/A' },
              secondary: { lastTask: secondaryMem?.task || 'Kein Task', lastActive: secondaryMem?.timestamp ? new Date(secondaryMem.timestamp).toLocaleTimeString('de-DE') : 'N/A' },
              selfHealing: { isActive: healingRef.current.isActive, isScanning: healingRef.current.isScanning, activeTasks: healingRef.current.activeTasks.length, totalFixes: healingRef.current.stats.errorsFixed },
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getEnvironmentStatus: createRorkTool({
        description: 'Gibt den letzten Umgebungs-Scan und aktive Bedrohungen zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            const h = healingRef.current;
            const scan = h.latestEnvScan;
            return JSON.stringify({
              latestScan: scan ? { networkStatus: scan.networkStatus, latencyMs: scan.latencyMs, connectionType: scan.connectionType, threatsCount: scan.threats.length } : null,
              activeThreats: h.activeThreats.map(t => ({ type: t.type, severity: t.severity, title: t.title, recommendation: t.recommendation })),
              isScanning: h.isEnvScanning,
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      resetCircuitBreaker: createRorkTool({
        description: 'Setzt den Netzwerk-Circuit-Breaker zurück. Nutze dies wenn Agent 1 oder Agent 2 einen "Internal Server Error" melden. Der Circuit-Breaker blockiert weitere API-Aufrufe wenn zu viele Fehler aufgetreten sind. Nach dem Reset können API-Aufrufe wieder normal funktionieren.',
        zodSchema: z.object({}),
        execute() {
          try {
            const beforeState = getCircuitBreakerState();
            if (!beforeState.isOpen && beforeState.failures === 0) {
              return `Circuit Breaker ist bereits offen (keine Blockierung). Failures: ${beforeState.failures}/${beforeState.threshold}. Kein Reset nötig.`;
            }
            const h = healingRef.current;
            const result = h.resetCircuitBreaker();
            return `Circuit Breaker zurückgesetzt!\nVorher: ${beforeState.isOpen ? 'OFFEN (blockiert)' : `belastet (${beforeState.failures}/${beforeState.threshold} Fehler)`}\nJetzt: ${result.isOpen ? 'Noch offen' : 'Geschlossen (API-Aufrufe wieder möglich)'}\nFehler: ${result.failures}\n\nDie Agenten können jetzt wieder normal kommunizieren.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getCircuitBreakerStatus: createRorkTool({
        description: 'Prüft den Status des Circuit-Breakers. Gibt zurück ob er offen ist (API blockiert) und wie viele Fehler gezählt wurden.',
        zodSchema: z.object({}),
        execute() {
          try {
            const state = getCircuitBreakerState();
            return JSON.stringify({
              isOpen: state.isOpen,
              status: state.isOpen ? 'BLOCKIERT - Keine API-Aufrufe möglich!' : state.failures > state.threshold * 0.5 ? 'BELASTET - baldige Blockierung möglich' : 'Normal',
              failures: state.failures,
              threshold: state.threshold,
              cooldownRemaining: state.cooldownRemaining,
              recommendation: state.isOpen ? 'SOFORT resetCircuitBreaker aufrufen!' : state.failures > 10 ? 'resetCircuitBreaker empfohlen' : 'Kein Handlungsbedarf',
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      retryFailedAgentCall: createRorkTool({
        description: 'Erzwingt einen Retry für einen fehlgeschlagenen Agent-Aufruf. Nützlich nach einem Circuit-Breaker-Reset oder wenn der Server wieder erreichbar ist.',
        zodSchema: z.object({
          agentTarget: z.enum(['primary', 'secondary', 'self']).describe('Welcher Agent soll neu versuchen?'),
          reason: z.string().optional().describe('Grund für den Retry'),
        }),
        execute(input) {
          try {
            const h = healingRef.current;
            resetCircuitBreaker();
            h.addLogEntry('fix', `Retry für ${input.agentTarget} Agent`, input.reason || 'Manueller Retry nach Server-Fehler');
            h.pushNotification(`${input.agentTarget} Agent-Retry initiiert`, 'fix');
            h.addTaskFromAgent(
              `Retry: ${input.agentTarget} Agent`,
              `Circuit-Breaker zurückgesetzt und Retry für ${input.agentTarget} Agent initiiert. Grund: ${input.reason || 'Server-Fehler behoben'}`,
              'high'
            );
            return `Retry für ${input.agentTarget} Agent initiiert.\n\n- Circuit Breaker zurückgesetzt\n- Agent kann jetzt wieder Nachrichten senden\n- Grund: ${input.reason || 'Server-Fehler recovery'}\n\nBitte den User informieren dass der Agent wieder bereit ist.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      rememberNote: createRorkTool({
        description: 'Speichert eine dauerhafte Erinnerung die über alle Chats hinweg erhalten bleibt.',
        zodSchema: z.object({ key: z.string(), value: z.string() }),
        execute(input) {
          try { storageRef.current.saveMemoryNote(input.key, input.value); return `Erinnerung gespeichert: "${input.key}"`; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      recallNote: createRorkTool({
        description: 'Ruft eine gespeicherte Erinnerung ab.',
        zodSchema: z.object({ key: z.string() }),
        execute(input) {
          try {
            const value = storageRef.current.getMemoryNote(input.key);
            if (!value) return `Keine Erinnerung für "${input.key}"`;
            return `Erinnerung "${input.key}": ${value}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      deleteNote: createRorkTool({
        description: 'Löscht eine gespeicherte Erinnerung.',
        zodSchema: z.object({ key: z.string() }),
        execute(input) {
          try { storageRef.current.deleteMemoryNote(input.key); return `Erinnerung "${input.key}" gelöscht.`; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      createProject: createRorkTool({
        description: 'Erstellt ein neues Projekt.',
        zodSchema: z.object({ name: z.string(), type: z.enum(['react-native', 'web', 'api', 'fullstack']), description: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.createProject(input.name, input.type, input.description);
            s.setCurrentProject(project.id);
            return `Projekt "${input.name}" erstellt mit ID: ${project.id}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      writeFile: createRorkTool({
        description: 'Schreibt/erstellt eine Datei im aktuellen Projekt. Voller Frontend+Backend Zugriff.',
        zodSchema: z.object({ path: z.string(), content: z.string(), projectId: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = input.projectId ? s.state.projects.find(p => p.id === input.projectId) ?? s.currentProject : s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const existingFile = project.files.find(f => f.path === input.path);
            const fileName = input.path.split('/').pop() || input.path;
            if (existingFile) {
              s.updateFileInProject(project.id, existingFile.id, { content: input.content });
              return `Datei aktualisiert: ${input.path}`;
            } else {
              s.addFileToProject(project.id, { path: input.path, name: fileName, content: input.content, type: 'file', language: getFileLanguage(fileName) });
              return `Datei erstellt: ${input.path}`;
            }
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      bulkWriteFiles: createRorkTool({
        description: 'Schreibt mehrere Dateien auf einmal.',
        zodSchema: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const results: string[] = [];
            for (const file of input.files) {
              const existing = project.files.find(f => f.path === file.path);
              const fileName = file.path.split('/').pop() || file.path;
              if (existing) { s.updateFileInProject(project.id, existing.id, { content: file.content }); results.push(`Aktualisiert: ${file.path}`); }
              else { s.addFileToProject(project.id, { path: file.path, name: fileName, content: file.content, type: 'file', language: getFileLanguage(fileName) }); results.push(`Erstellt: ${file.path}`); }
            }
            return `${input.files.length} Dateien geschrieben:\n${results.join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      readFile: createRorkTool({
        description: 'Liest eine Datei aus dem aktuellen Projekt.',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            return file.content;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      deleteFile: createRorkTool({
        description: 'Löscht eine Datei.',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            s.deleteFileFromProject(project.id, file.id);
            return `Gelöscht: ${input.path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      listFiles: createRorkTool({
        description: 'Listet alle Dateien im aktuellen Projekt.',
        zodSchema: z.object({ projectId: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = input.projectId ? s.state.projects.find(p => p.id === input.projectId) ?? s.currentProject : s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            if (project.files.length === 0) return `Projekt "${project.name}" hat keine Dateien.`;
            return `Dateien in "${project.name}":\n` + [...project.files].sort((a, b) => a.path.localeCompare(b.path)).map(f => `${f.type === 'folder' ? '[dir]' : '[file]'} ${f.path}`).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      listProjects: createRorkTool({
        description: 'Listet alle Projekte.',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            if (s.state.projects.length === 0) return 'Keine Projekte.';
            return s.state.projects.map(p => `${p.id === s.currentProject?.id ? '> ' : '  '}${p.name} (${p.type}) - ${p.files.length} Dateien`).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      selectProject: createRorkTool({
        description: 'Wählt ein Projekt als aktiv.',
        zodSchema: z.object({ projectId: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const p = s.state.projects.find(p => p.id === input.projectId);
            if (!p) return 'Projekt nicht gefunden.';
            s.setCurrentProject(p.id);
            return `"${p.name}" aktiv.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      grep: createRorkTool({
        description: 'Sucht nach einem Pattern in Projektdateien.',
        zodSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const results: string[] = [];
            const regex = new RegExp(input.pattern, 'gi');
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              if (input.path && !file.path.startsWith(input.path)) continue;
              const lines = file.content.split('\n');
              lines.forEach((line, idx) => { if (regex.test(line)) results.push(`${file.path}:${idx + 1}: ${line.trim()}`); regex.lastIndex = 0; });
            }
            if (results.length === 0) return `Keine Treffer für "${input.pattern}"`;
            return `${results.length} Treffer:\n${results.slice(0, 30).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      findReplace: createRorkTool({
        description: 'Sucht und ersetzt Text in Projektdateien.',
        zodSchema: z.object({ find: z.string(), replace: z.string(), path: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            let total = 0;
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              if (input.path && file.path !== input.path) continue;
              const escaped = input.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(escaped, 'g');
              const matches = file.content.match(regex);
              if (matches && matches.length > 0) {
                s.updateFileInProject(project.id, file.id, { content: file.content.replace(regex, input.replace) });
                total += matches.length;
              }
            }
            if (total === 0) return `Keine Vorkommen von "${input.find}".`;
            return `${total} Ersetzungen durchgeführt.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      webFetch: createRorkTool({
        description: 'Ruft Webinhalte ab mit automatischen Retries und Fallback.',
        zodSchema: z.object({ url: z.string() }),
        async execute(input) {
          try {
            const response = await resilientFetch(input.url, { maxRetries: 3, timeout: 15000, headers: { 'User-Agent': 'SelfHealingAgent/1.0' } });
            if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
            let body = await response.text();
            if (body.length > 15000) body = body.substring(0, 15000) + '\n[... gekürzt]';
            return `URL: ${input.url}\nStatus: ${response.status}\n\n${body}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      httpRequest: createRorkTool({
        description: 'Führt HTTP-Requests mit Retry-Logik aus.',
        zodSchema: z.object({ url: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() }),
        async execute(input) {
          try {
            const options: RequestInit & { maxRetries?: number; timeout?: number } = { method: input.method || 'GET', headers: { ...input.headers, 'User-Agent': 'SelfHealingAgent/1.0' }, maxRetries: 3, timeout: 20000 };
            if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method || '')) options.body = input.body;
            const response = await resilientFetch(input.url, options);
            let body = await response.text();
            if (body.length > 10000) body = body.substring(0, 10000) + '\n[... gekürzt]';
            return `Status: ${response.status}\n\n${body}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      analyzeWithAI: createRorkTool({
        description: 'Analysiert Text/Code/Bilder mit KI.',
        zodSchema: z.object({ prompt: z.string(), content: z.string().optional(), imageUri: z.string().optional() }),
        async execute(input) {
          try {
            const fullPrompt = input.prompt + (input.content ? `\n\nContent:\n${input.content}` : '');
            if (input.imageUri) {
              const result = await generateText({ messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: fullPrompt }, { type: 'image' as const, image: input.imageUri }] }] });
              return result || 'Keine Analyse verfügbar.';
            } else {
              const result = await generateText(fullPrompt);
              return result || 'Keine Analyse verfügbar.';
            }
          } catch (e) { return `KI-Analyse Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateTextAI: createRorkTool({
        description: 'Generiert Text mit KI.',
        zodSchema: z.object({ prompt: z.string(), context: z.string().optional() }),
        async execute(input) {
          try {
            const fullPrompt = input.context ? `${input.prompt}\n\nKontext:\n${input.context}` : input.prompt;
            const result = await generateText(fullPrompt);
            return result || 'Keine Textgenerierung möglich.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      analyzeCode: createRorkTool({
        description: 'Analysiert Code im Projekt.',
        zodSchema: z.object({ path: z.string().optional() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = input.path ? project.files.filter(f => f.path === input.path) : project.files.filter(f => f.type === 'file');
            if (files.length === 0) return 'Keine Dateien.';
            const issues: string[] = [];
            let totalLines = 0;
            for (const file of files) {
              const lines = file.content.split('\n');
              totalLines += lines.length;
              lines.forEach((line, idx) => {
                if (line.includes(': any') && (file.name.endsWith('.ts') || file.name.endsWith('.tsx'))) issues.push(`${file.path}:${idx + 1}: "any" Type`);
                if (line.includes('TODO') || line.includes('FIXME')) issues.push(`${file.path}:${idx + 1}: ${line.trim()}`);
              });
            }
            return `Analyse: ${files.length} Dateien, ${totalLines} Zeilen\n${issues.length > 0 ? `${issues.length} Hinweise:\n${issues.slice(0, 20).join('\n')}` : 'Keine Probleme!'}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      scaffoldProject: createRorkTool({
        description: 'Erstellt ein Projekt aus Template.',
        zodSchema: z.object({ template: z.enum(['react-native-app', 'nextjs-app', 'express-api', 'landing-page', 'react-dashboard']), name: z.string(), description: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const template = PROJECT_TEMPLATES[input.template];
            if (!template) return `Template "${input.template}" nicht gefunden.`;
            const project = s.createProject(input.name, template.type, input.description || template.description);
            s.setCurrentProject(project.id);
            for (const file of template.files) {
              const fileName = file.path.split('/').pop() || file.path;
              s.addFileToProject(project.id, { path: file.path, name: fileName, content: file.content.replace(/\{\{PROJECT_NAME\}\}/g, input.name), type: 'file', language: getFileLanguage(fileName) });
            }
            s.updateProject(project.id, { status: 'building' });
            return `Projekt "${input.name}" aus Template "${input.template}" erstellt.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      renameFile: createRorkTool({
        description: 'Benennt eine Datei um.',
        zodSchema: z.object({ oldPath: z.string(), newPath: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.oldPath);
            if (!file) return `Datei nicht gefunden: ${input.oldPath}`;
            const newName = input.newPath.split('/').pop() || input.newPath;
            s.updateFileInProject(project.id, file.id, { path: input.newPath, name: newName, language: getFileLanguage(newName) });
            return `Umbenannt: ${input.oldPath} -> ${input.newPath}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      appendToFile: createRorkTool({
        description: 'Fügt Text am Ende einer Datei hinzu.',
        zodSchema: z.object({ path: z.string(), content: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            s.updateFileInProject(project.id, file.id, { content: file.content + '\n' + input.content });
            return `Inhalt an ${input.path} angehängt`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      insertInFile: createRorkTool({
        description: 'Fügt Text an einer bestimmten Zeile ein.',
        zodSchema: z.object({ path: z.string(), line: z.number(), content: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            const lines = file.content.split('\n');
            const idx = Math.max(0, Math.min(input.line - 1, lines.length));
            lines.splice(idx, 0, input.content);
            s.updateFileInProject(project.id, file.id, { content: lines.join('\n') });
            return `Inhalt in Zeile ${input.line} eingefügt`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getProjectStats: createRorkTool({
        description: 'Statistiken über alle Projekte.',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            let totalFiles = 0, totalLines = 0;
            for (const project of s.state.projects) {
              for (const file of project.files) { if (file.type === 'file') { totalFiles++; totalLines += file.content.split('\n').length; } }
            }
            return `Projekte: ${s.state.projects.length}\nChats: ${s.state.conversations.length}\nDateien: ${totalFiles}\nZeilen: ${totalLines}\nErinnerungen: ${Object.keys(s.getAllMemory()).length}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      installPackage: createRorkTool({
        description: 'Fügt Pakete zu Projektabhängigkeiten hinzu.',
        zodSchema: z.object({ packages: z.array(z.string()), dev: z.boolean().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json' || f.name === 'package.json');
            if (pkgFile) {
              const pkg = JSON.parse(pkgFile.content);
              const key = input.dev ? 'devDependencies' : 'dependencies';
              if (!pkg[key]) pkg[key] = {};
              input.packages.forEach(p => { pkg[key][p] = 'latest'; });
              s.updateFileInProject(project.id, pkgFile.id, { content: JSON.stringify(pkg, null, 2) });
            }
            return `Pakete hinzugefügt: ${input.packages.join(', ')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      validateJson: createRorkTool({
        description: 'Validiert und formatiert JSON.',
        zodSchema: z.object({ json: z.string(), fix: z.boolean().optional() }),
        execute(input) {
          try {
            const parsed = JSON.parse(input.json);
            return `Gültiges JSON\n${JSON.stringify(parsed, null, 2).substring(0, 2000)}`;
          } catch (e) {
            if (input.fix) {
              try { const fixed = input.json.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'); const parsed = JSON.parse(fixed); return `JSON repariert:\n${JSON.stringify(parsed, null, 2).substring(0, 2000)}`; }
              catch { return `JSON nicht reparierbar: ${e instanceof Error ? e.message : String(e)}`; }
            }
            return `Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      liveModifyFrontend: createRorkTool({
        description: 'Modifiziert eine Frontend-Datei der App live. Voller Schreibzugriff auf alle App-Dateien.',
        zodSchema: z.object({ filePath: z.string().describe('Relativer Pfad (z.B. app/(tabs)/(chat)/index.tsx)'), modification: z.string().describe('Beschreibung der Änderung'), newContent: z.string().optional().describe('Neuer Dateiinhalt (wenn vollständig ersetzt werden soll)') }),
        execute(input) {
          try {
            healingRef.current.addLogEntry('fix', `Live-Modifikation: ${input.filePath}`, input.modification);
            healingRef.current.addTaskFromAgent(`Live-Mod: ${input.filePath}`, input.modification, 'high');
            return `Live-Modifikation für ${input.filePath} registriert: ${input.modification}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      liveModifyBackend: createRorkTool({
        description: 'Modifiziert eine Backend-Datei der App live. Voller Schreibzugriff.',
        zodSchema: z.object({ filePath: z.string(), modification: z.string(), newContent: z.string().optional() }),
        execute(input) {
          try {
            healingRef.current.addLogEntry('fix', `Backend-Modifikation: ${input.filePath}`, input.modification);
            healingRef.current.addTaskFromAgent(`Backend-Mod: ${input.filePath}`, input.modification, 'high');
            return `Backend-Modifikation für ${input.filePath} registriert: ${input.modification}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getFullAppState: createRorkTool({
        description: 'Gibt den vollständigen App-Zustand zurück inkl. Projekte, Conversations, Memory.',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            return JSON.stringify({
              conversations: s.state.conversations.length,
              projects: s.state.projects.length,
              currentProject: s.currentProject?.name || 'Keines',
              currentConversation: s.currentConversation?.title || 'Keine',
              memory: Object.keys(s.getAllMemory()).length,
              settings: s.state.settings,
              permanentReminders: Object.keys(mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {}).length,
              crossSessionEntries: Object.keys(mmkv.getObject<Record<string, unknown>>(CROSS_SESSION_KEY) || {}).length,
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      duplicateFile: createRorkTool({
        description: 'Dupliziert eine Datei im aktuellen Projekt.',
        zodSchema: z.object({ sourcePath: z.string(), targetPath: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const src = project.files.find(f => f.path === input.sourcePath);
            if (!src) return `Quelldatei nicht gefunden: ${input.sourcePath}`;
            const name = input.targetPath.split('/').pop() || input.targetPath;
            s.addFileToProject(project.id, { path: input.targetPath, name, content: src.content, type: 'file', language: getFileLanguage(name) });
            return `Dupliziert: ${input.sourcePath} -> ${input.targetPath}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      createFolder: createRorkTool({
        description: 'Erstellt einen Ordner im aktuellen Projekt.',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const name = input.path.split('/').pop() || input.path;
            s.addFileToProject(project.id, { path: input.path, name, content: '', type: 'folder' });
            return `Ordner erstellt: ${input.path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      uninstallPackage: createRorkTool({
        description: 'Entfernt Pakete aus Projektabhängigkeiten.',
        zodSchema: z.object({ packages: z.array(z.string()) }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json' || f.name === 'package.json');
            if (pkgFile) {
              const pkg = JSON.parse(pkgFile.content);
              input.packages.forEach(p => { delete pkg.dependencies?.[p]; delete pkg.devDependencies?.[p]; });
              s.updateFileInProject(project.id, pkgFile.id, { content: JSON.stringify(pkg, null, 2) });
            }
            return `Pakete entfernt: ${input.packages.join(', ')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      updateProjectStatus: createRorkTool({
        description: 'Aktualisiert den Status eines Projekts.',
        zodSchema: z.object({ status: z.enum(['draft', 'building', 'completed', 'error']) }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            s.updateProject(project.id, { status: input.status });
            return `Status: ${input.status}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      deleteProject: createRorkTool({
        description: 'Löscht ein Projekt.',
        zodSchema: z.object({ projectId: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            s.deleteProject(input.projectId);
            return `Projekt gelöscht: ${input.projectId}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      cloneProject: createRorkTool({
        description: 'Klont ein Projekt.',
        zodSchema: z.object({ sourceId: z.string(), newName: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const src = s.state.projects.find(p => p.id === input.sourceId);
            if (!src) return 'Quellprojekt nicht gefunden.';
            const clone = s.createProject(input.newName, src.type, src.description);
            for (const file of src.files) {
              s.addFileToProject(clone.id, { path: file.path, name: file.name, content: file.content, type: file.type, language: file.language });
            }
            return `Projekt geklont: ${input.newName}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getAppStructure: createRorkTool({
        description: 'Gibt die strukturierte Ansicht der App zurück.',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            return JSON.stringify({
              projects: s.state.projects.map(p => ({ id: p.id, name: p.name, type: p.type, files: p.files.length })),
              conversations: s.state.conversations.length,
              currentProject: s.currentProject?.name,
            });
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      saveWorkingMemory: createRorkTool({
        description: 'Speichert den aktuellen Task-Kontext im Arbeitsspeicher.',
        zodSchema: z.object({ task: z.string(), context: z.string().optional() }),
        execute(input) {
          try {
            mmkv.setObject('agent:healing:working_memory', { task: input.task, context: input.context || '', timestamp: Date.now(), agent: 'healing' });
            return `Arbeitsspeicher aktualisiert: "${input.task.substring(0, 80)}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getWorkingMemory: createRorkTool({
        description: 'Ruft den Arbeitsspeicher ab.',
        zodSchema: z.object({}),
        execute() {
          try {
            const mem = mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>('agent:healing:working_memory');
            if (!mem) return 'Kein Arbeitsspeicher.';
            const age = Date.now() - mem.timestamp;
            const ageStr = age < 60000 ? 'gerade eben' : age < 3600000 ? `vor ${Math.floor(age / 60000)}min` : `vor ${Math.floor(age / 3600000)}h`;
            return `Letzte Aufgabe (${ageStr}):\nTask: ${mem.task}\nKontext: ${mem.context || '-'}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateComponent: createRorkTool({
        description: 'Generiert eine React/React Native Komponente.',
        zodSchema: z.object({ name: z.string(), props: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean().optional() })).optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const propsIf = input.props && input.props.length > 0
              ? `interface ${input.name}Props {\n${input.props.map(p => `  ${p.name}${p.optional ? '?' : ''}: ${p.type};`).join('\n')}\n}`
              : `interface ${input.name}Props {}`;
            const dest = input.props && input.props.length > 0 ? `{ ${input.props.map(p => p.name).join(', ')} }` : '{}';
            const content = `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\n${propsIf}\n\nexport const ${input.name}: React.FC<${input.name}Props> = (${dest}) => {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.text}>${input.name}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { padding: 16 },\n  text: { fontSize: 16, fontWeight: '600' },\n});`;
            const path = `src/components/${input.name}.tsx`;
            s.addFileToProject(project.id, { path, name: `${input.name}.tsx`, content, type: 'file', language: 'typescript' });
            return `Komponente: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateScreen: createRorkTool({
        description: 'Generiert einen Screen.',
        zodSchema: z.object({ name: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const content = `import React from 'react';\nimport { View, Text, StyleSheet, ScrollView } from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';\n\nexport default function ${input.name}Screen() {\n  return (\n    <SafeAreaView style={styles.container}>\n      <ScrollView style={styles.content}>\n        <Text style={styles.title}>${input.name}</Text>\n      </ScrollView>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1 },\n  content: { flex: 1, padding: 20 },\n  title: { fontSize: 28, fontWeight: '700' },\n});`;
            const path = `src/screens/${input.name}Screen.tsx`;
            s.addFileToProject(project.id, { path, name: `${input.name}Screen.tsx`, content, type: 'file', language: 'typescript' });
            return `Screen: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateHook: createRorkTool({
        description: 'Generiert einen Custom Hook.',
        zodSchema: z.object({ name: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const hookName = `use${input.name.charAt(0).toUpperCase() + input.name.slice(1)}`;
            const content = `import { useState, useCallback } from 'react';\n\nexport function ${hookName}() {\n  const [data, setData] = useState<unknown>(null);\n  const [loading, setLoading] = useState(false);\n  const execute = useCallback(async () => { setLoading(true); try { setData(null); } finally { setLoading(false); } }, []);\n  return { data, loading, execute };\n}`;
            const path = `src/hooks/${hookName}.ts`;
            s.addFileToProject(project.id, { path, name: `${hookName}.ts`, content, type: 'file', language: 'typescript' });
            return `Hook: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateUuid: createRorkTool({
        description: 'Generiert UUIDs.',
        zodSchema: z.object({ count: z.number().optional() }),
        execute(input) {
          const count = Math.min(input.count || 1, 20);
          const uuids: string[] = [];
          for (let i = 0; i < count; i++) {
            const hex = () => Math.floor(Math.random() * 16).toString(16);
            const s = (n: number) => Array.from({ length: n }, hex).join('');
            uuids.push(`${s(8)}-${s(4)}-4${s(3)}-${['8','9','a','b'][Math.floor(Math.random()*4)]}${s(3)}-${s(12)}`);
          }
          return uuids.join('\n');
        },
      }),

      testRegex: createRorkTool({
        description: 'Testet einen regulären Ausdruck.',
        zodSchema: z.object({ pattern: z.string(), text: z.string(), flags: z.string().optional() }),
        execute(input) {
          try {
            const regex = new RegExp(input.pattern, input.flags || 'g');
            const matches: string[] = [];
            let m; let count = 0;
            while ((m = regex.exec(input.text)) !== null && count < 30) { matches.push(`[${m.index}]: "${m[0]}"`); count++; if (!regex.global) break; }
            if (matches.length === 0) return `Keine Treffer`;
            return `${matches.length} Treffer:\n${matches.join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      encodeDecodeText: createRorkTool({
        description: 'Encode/Decode Text (Base64, URL).',
        zodSchema: z.object({ text: z.string(), operation: z.enum(['base64-encode', 'base64-decode', 'url-encode', 'url-decode']) }),
        execute(input) {
          try {
            switch (input.operation) {
              case 'base64-encode': return btoa(unescape(encodeURIComponent(input.text)));
              case 'base64-decode': return decodeURIComponent(escape(atob(input.text)));
              case 'url-encode': return encodeURIComponent(input.text);
              case 'url-decode': return decodeURIComponent(input.text);
              default: return 'Unbekannt';
            }
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      hashText: createRorkTool({
        description: 'Erstellt einen simplen Hash.',
        zodSchema: z.object({ text: z.string() }),
        execute(input) {
          let hash = 0;
          for (let i = 0; i < input.text.length; i++) { hash = ((hash << 5) - hash) + input.text.charCodeAt(i); hash |= 0; }
          return `Hash: ${Math.abs(hash).toString(16).padStart(8, '0')}`;
        },
      }),

      generatePassword: createRorkTool({
        description: 'Generiert sichere Passwörter.',
        zodSchema: z.object({ length: z.number().optional(), count: z.number().optional() }),
        execute(input) {
          const len = Math.min(Math.max(input.length || 16, 4), 128);
          const count = Math.min(input.count || 1, 10);
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
          const pwds: string[] = [];
          for (let i = 0; i < count; i++) { let p = ''; for (let j = 0; j < len; j++) p += chars[Math.floor(Math.random() * chars.length)]; pwds.push(p); }
          return pwds.join('\n');
        },
      }),

      calculateExpression: createRorkTool({
        description: 'Berechnet mathematische Ausdrücke.',
        zodSchema: z.object({ expression: z.string() }),
        execute(input) {
          try {
            const sanitized = input.expression.replace(/[^0-9+\-*/().\s]/g, '');
            // eslint-disable-next-line no-new-func
            const result = new Function(`return (${sanitized})`)();
            return `${input.expression} = ${result}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      colorConvert: createRorkTool({
        description: 'Konvertiert Farben (hex/rgb).',
        zodSchema: z.object({ color: z.string() }),
        execute(input) {
          try {
            const c = input.color.trim();
            if (c.startsWith('#')) {
              const hex = c.slice(1);
              const r = parseInt(hex.substring(0, 2), 16);
              const g = parseInt(hex.substring(2, 4), 16);
              const b = parseInt(hex.substring(4, 6), 16);
              return `HEX: ${c}\nRGB: rgb(${r}, ${g}, ${b})`;
            }
            return `Eingabe: ${c}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      convertCase: createRorkTool({
        description: 'Konvertiert Schreibweise (camel, snake, kebab, pascal, upper, lower).',
        zodSchema: z.object({ text: z.string(), to: z.enum(['camel', 'snake', 'kebab', 'pascal', 'upper', 'lower']) }),
        execute(input) {
          const { text, to } = input;
          const words = text.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim().split(/\s+/).filter(Boolean);
          switch (to) {
            case 'camel': return words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
            case 'pascal': return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
            case 'snake': return words.map(w => w.toLowerCase()).join('_');
            case 'kebab': return words.map(w => w.toLowerCase()).join('-');
            case 'upper': return text.toUpperCase();
            case 'lower': return text.toLowerCase();
          }
        },
      }),

      countStats: createRorkTool({
        description: 'Textstatistiken (Zeichen, Wörter, Zeilen).',
        zodSchema: z.object({ text: z.string() }),
        execute(input) {
          const chars = input.text.length;
          const words = input.text.trim().split(/\s+/).filter(Boolean).length;
          const lines = input.text.split('\n').length;
          return `Zeichen: ${chars}\nWörter: ${words}\nZeilen: ${lines}`;
        },
      }),

      sortLines: createRorkTool({
        description: 'Sortiert Zeilen.',
        zodSchema: z.object({ text: z.string(), reverse: z.boolean().optional() }),
        execute(input) {
          const lines = input.text.split('\n').filter(Boolean);
          const sorted = lines.sort();
          if (input.reverse) sorted.reverse();
          return sorted.join('\n');
        },
      }),

      minifyJson: createRorkTool({
        description: 'Minifiziert JSON.',
        zodSchema: z.object({ json: z.string() }),
        execute(input) {
          try { return JSON.stringify(JSON.parse(input.json)); } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateTypeFromJson: createRorkTool({
        description: 'Generiert TypeScript Types aus JSON.',
        zodSchema: z.object({ json: z.string(), typeName: z.string().optional() }),
        execute(input) {
          try {
            const obj = JSON.parse(input.json);
            const name = input.typeName || 'Generated';
            const getType = (val: unknown): string => {
              if (val === null) return 'null';
              if (Array.isArray(val)) return val.length > 0 ? `${getType(val[0])}[]` : 'unknown[]';
              if (typeof val === 'object') return 'object';
              return typeof val;
            };
            if (typeof obj !== 'object' || obj === null) return `type ${name} = ${getType(obj)};`;
            const lines = Object.entries(obj as Record<string, unknown>).map(([k, v]) => `  ${k}: ${getType(v)};`);
            return `interface ${name} {\n${lines.join('\n')}\n}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      diffTexts: createRorkTool({
        description: 'Vergleicht zwei Texte zeilenweise.',
        zodSchema: z.object({ text1: z.string(), text2: z.string() }),
        execute(input) {
          const a = input.text1.split('\n');
          const b = input.text2.split('\n');
          const diffs: string[] = [];
          const max = Math.max(a.length, b.length);
          for (let i = 0; i < max; i++) {
            if (a[i] !== b[i]) diffs.push(`- ${a[i] ?? ''}\n+ ${b[i] ?? ''}`);
          }
          return diffs.length === 0 ? 'Identisch' : diffs.slice(0, 20).join('\n');
        },
      }),

      getEnvironmentInfo: createRorkTool({
        description: 'Gibt Umgebungsinfo zurück.',
        zodSchema: z.object({}),
        execute() {
          const s = storageRef.current;
          return `Plattform: React Native (Expo SDK 54)\nMemory: ${Object.keys(s.getAllMemory()).length}\nProjekte: ${s.state.projects.length}\nTools: 70+ Self Healing Tools`;
        },
      }),

      generateGitignore: createRorkTool({
        description: 'Generiert .gitignore.',
        zodSchema: z.object({ language: z.enum(['node', 'python', 'react-native', 'general']).optional() }),
        execute(input) {
          const lang = input.language || 'general';
          const bases: Record<string, string> = {
            node: 'node_modules/\ndist/\n.env\n*.log\n.DS_Store',
            python: '__pycache__/\n*.pyc\n.venv/\n.env',
            'react-native': 'node_modules/\nios/Pods/\n.expo/\ndist/\n.env\n*.log',
            general: 'node_modules/\n.env\ndist/\nbuild/\n.DS_Store\n*.log',
          };
          return bases[lang];
        },
      }),

      generateEnvTemplate: createRorkTool({
        description: 'Generiert .env Template aus einer Liste.',
        zodSchema: z.object({ keys: z.array(z.string()) }),
        execute(input) {
          return input.keys.map(k => `${k.toUpperCase()}=`).join('\n');
        },
      }),

      loremIpsum: createRorkTool({
        description: 'Generiert Lorem Ipsum.',
        zodSchema: z.object({ paragraphs: z.number().optional() }),
        execute(input) {
          const p = Math.min(input.paragraphs || 1, 10);
          const base = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
          return Array.from({ length: p }, () => base).join('\n\n');
        },
      }),

      convertTimestamp: createRorkTool({
        description: 'Konvertiert Timestamps.',
        zodSchema: z.object({ value: z.string() }),
        execute(input) {
          try {
            const val = input.value.trim();
            let date: Date;
            if (val === 'now') date = new Date();
            else if (/^\d{10}$/.test(val)) date = new Date(parseInt(val) * 1000);
            else if (/^\d{13}$/.test(val)) date = new Date(parseInt(val));
            else date = new Date(val);
            if (isNaN(date.getTime())) return `Ungültig: ${val}`;
            return `ISO: ${date.toISOString()}\nUnix: ${Math.floor(date.getTime() / 1000)}\nLokal: ${date.toLocaleString('de-DE')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      extractImports: createRorkTool({
        description: 'Extrahiert Imports aus Code.',
        zodSchema: z.object({ code: z.string() }),
        execute(input) {
          const imports = input.code.match(/import\s+.*?from\s+['"](.+?)['"]/g) || [];
          return imports.length === 0 ? 'Keine Imports' : imports.join('\n');
        },
      }),

      formatCode: createRorkTool({
        description: 'Formatiert Code (einfache Einrückung).',
        zodSchema: z.object({ code: z.string(), indent: z.number().optional() }),
        execute(input) {
          try {
            const indent = input.indent || 2;
            let level = 0;
            return input.code.split('\n').map(line => {
              const trimmed = line.trim();
              if (trimmed.startsWith('}') || trimmed.startsWith(')')) level = Math.max(0, level - 1);
              const formatted = ' '.repeat(level * indent) + trimmed;
              if (trimmed.endsWith('{') || trimmed.endsWith('(')) level++;
              return formatted;
            }).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      previewProject: createRorkTool({
        description: 'Öffnet Projekt-Vorschau (via Impuls).',
        zodSchema: z.object({ projectId: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = input.projectId ? s.state.projects.find(p => p.id === input.projectId) : s.currentProject;
            if (!project) return 'Kein Projekt.';
            healingRef.current.pushNotification(`Vorschau: ${project.name}`, 'info');
            return `Vorschau für "${project.name}" vorgemerkt.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      exportFile: createRorkTool({
        description: 'Exportiert Dateiinhalt als String.',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Nicht gefunden: ${input.path}`;
            return `Export ${file.path} (${file.content.length} bytes):\n${file.content.substring(0, 3000)}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      mergeFiles: createRorkTool({
        description: 'Fügt mehrere Dateien in eine zusammen.',
        zodSchema: z.object({ paths: z.array(z.string()), targetPath: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt.';
            const contents: string[] = [];
            for (const p of input.paths) {
              const f = project.files.find(ff => ff.path === p);
              if (f) contents.push(`// ${p}\n${f.content}`);
            }
            const merged = contents.join('\n\n');
            const name = input.targetPath.split('/').pop() || input.targetPath;
            const existing = project.files.find(f => f.path === input.targetPath);
            if (existing) s.updateFileInProject(project.id, existing.id, { content: merged });
            else s.addFileToProject(project.id, { path: input.targetPath, name, content: merged, type: 'file', language: getFileLanguage(name) });
            return `${input.paths.length} Dateien in ${input.targetPath} gemerged.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateApiRoute: createRorkTool({
        description: 'Generiert eine API-Route.',
        zodSchema: z.object({ name: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt.';
            const method = input.method || 'GET';
            const content = `export async function ${method.toLowerCase()}Handler(req: Request) {\n  try {\n    return new Response(JSON.stringify({ ok: true, route: '${input.name}' }), { status: 200, headers: { 'Content-Type': 'application/json' } });\n  } catch (e) {\n    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });\n  }\n}`;
            const path = `api/${input.name}.ts`;
            s.addFileToProject(project.id, { path, name: `${input.name}.ts`, content, type: 'file', language: 'typescript' });
            return `API: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_status: createRorkTool({
        description: 'Prüft den GitHub-Verbindungsstatus.',
        zodSchema: z.object({}),
        async execute() {
          try {
            const token = getStoredToken();
            if (!token) return 'GitHub: Nicht verbunden. Bitte mit github_auth authentifizieren (Personal Access Token).';
            const user = getStoredUser();
            const valid = await checkTokenValidity();
            const active = getActiveRepo();
            let result = `GitHub: ${valid ? 'Verbunden ✅' : 'Token ungültig ❌'}`;
            if (user) result += `\nUser: ${user.login} (${user.name})`;
            if (active) result += `\nAktives Repo: ${active.owner}/${active.repo}`;
            return result;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_auth: createRorkTool({
        description: 'Authentifiziert mit GitHub über Personal Access Token. Erstelle einen Token: https://github.com/settings/tokens (Scope: repo).',
        zodSchema: z.object({ token: z.string().describe('GitHub Personal Access Token') }),
        async execute(input) {
          try {
            const success = await storeToken(input.token);
            if (success) { const user = getStoredUser(); return `GitHub Auth erfolgreich ✅\nEingeloggt als: ${user?.login || 'Unbekannt'}`; }
            return 'GitHub Auth fehlgeschlagen. Token ungültig.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_listRepos: createRorkTool({
        description: 'Listet alle GitHub-Repositories des Users.',
        zodSchema: z.object({}),
        async execute() {
          try {
            const result = await listRepos();
            if (result.error) return `Fehler: ${result.error}`;
            if (!result.repos?.length) return 'Keine Repositories.';
            const active = getActiveRepo();
            return `${result.repos.length} Repos:\n${result.repos.slice(0, 30).map(r => `${active?.owner === r.fullName.split('/')[0] && active?.repo === r.name ? '> ' : '  '}${r.fullName} (${r.private ? 'privat' : 'öffentlich'})`).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_createRepo: createRorkTool({
        description: 'Erstellt ein neues GitHub-Repository.',
        zodSchema: z.object({ name: z.string(), description: z.string().optional(), private: z.boolean().optional() }),
        async execute(input) {
          try {
            const result = await createRepo(input.name, input.description, input.private);
            if (result.error) return `Fehler: ${result.error}`;
            return `Repo erstellt: ${result.repo?.fullName}\nURL: ${result.repo?.htmlUrl}\nBranch: ${result.repo?.defaultBranch}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_pushProject: createRorkTool({
        description: 'Pusht ALLE Dateien des aktuellen Projekts in ein GitHub-Repository. Nutze dies wenn der User sagt "speichere auf GitHub" oder "push zu GitHub".',
        zodSchema: z.object({ owner: z.string(), repo: z.string(), commitMessage: z.string().optional(), branch: z.string().optional() }),
        async execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = project.files.filter(f => f.type === 'file');
            if (files.length === 0) return 'Keine Dateien zum Pushen.';
            setActiveRepo(input.owner, input.repo);
            const result = await pushMultipleFiles(input.owner, input.repo, files.map(f => ({ path: f.path, content: f.content })), input.commitMessage || `Update from SelfHealing AI`, input.branch || 'main');
            return `GitHub Push: ${result.totalOk} OK, ${result.totalFailed} failed → ${input.owner}/${input.repo}${result.totalFailed > 0 ? '\nFehler:\n' + result.results.filter(r => !r.ok).map(r => `  ❌ ${r.path}`).join('\n') : ''}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_getRepoContents: createRorkTool({
        description: 'Listet Dateien/Ordner eines GitHub-Repos.',
        zodSchema: z.object({ owner: z.string(), repo: z.string(), path: z.string().optional() }),
        async execute(input) {
          try {
            const result = await getRepoContents(input.owner, input.repo, input.path || '');
            if (result.error) return `Fehler: ${result.error}`;
            if (!result.files?.length) return 'Leer.';
            setActiveRepo(input.owner, input.repo);
            return result.files.map(f => `${f.type === 'dir' ? '[Ordner]' : '[Datei]'} ${f.name}`).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_commitFile: createRorkTool({
        description: 'Commitet eine einzelne Datei in ein GitHub-Repo.',
        zodSchema: z.object({ owner: z.string(), repo: z.string(), path: z.string(), content: z.string(), commitMessage: z.string().optional(), branch: z.string().optional() }),
        async execute(input) {
          try {
            const result = await pushMultipleFiles(input.owner, input.repo, [{ path: input.path, content: input.content }], input.commitMessage || `Update ${input.path}`, input.branch || 'main');
            return result.totalOk > 0 ? `Committed: ${input.path}` : `Fehler: ${result.results[0]?.error}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_deleteRepo: createRorkTool({
        description: 'Löscht ein GitHub-Repository (unwiderruflich).',
        zodSchema: z.object({ owner: z.string(), repo: z.string() }),
        async execute(input) {
          try { const r = await deleteRepo(input.owner, input.repo); return r.ok ? `${input.owner}/${input.repo} gelöscht.` : `Fehler: ${r.error}`; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_logout: createRorkTool({
        description: 'Entfernt den GitHub-Token (logout).',
        zodSchema: z.object({}),
        execute() { try { clearToken(); return 'GitHub-Token entfernt. Abgemeldet.'; } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; } },
      }),

      terminalExec: createRorkTool({
        description: 'Führt einen echten Terminal-Befehl auf den Projektdateien aus (ls, cat, grep, curl, eval, tree).',
        zodSchema: z.object({ command: z.string().describe('Terminal-Befehl') }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            const files: Record<string, string> = {};
            if (project) for (const f of project.files) { if (f.type === 'file') files[f.path] = f.content; }
            const { executeCommand } = await import('@/utils/sandboxEngine');
            const r = await executeCommand(input.command, files, { PROJECT_NAME: project?.name || '' });
            return `$ ${input.command}\n${r.output}\n⏱ ${Math.round(r.duration)}ms`;
          } catch (e) { return `Terminal-Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      deployProject: createRorkTool({
        description: 'Startet den Deploy-Workflow: Projekt prüfen, Build starten (EAS).',
        zodSchema: z.object({ platform: z.enum(['ios', 'android', 'all']).optional(), profile: z.enum(['development', 'preview', 'production']).optional() }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt.';
            const platform = input.platform || 'ios';
            s.updateProject(project.id, { status: 'building' });
            let status = `🚀 DEPLOY: ${project.name}\nPlattform: ${platform}\nDateien: ${project.files.length}\n`;
            try {
              const { triggerEasBuild } = await import('@/utils/easBuild');
              const r = await triggerEasBuild({ platform, profile: input.profile || 'development', autoSubmit: false });
              status += r.message;
            } catch { status += 'Build manuell: eas build --platform ' + platform; }
            return status;
          } catch (e) { return `Deploy-Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),
    },
  });

  const saveChatHistory = useCallback(() => {
    try {
      if (agent.messages.length > 0) {
        const simplified = agent.messages.slice(-80).map(m => ({ id: m.id, role: m.role, timestamp: Date.now() }));
        mmkv.setObject(HEALING_CHAT_KEY, simplified);
      }
    } catch {}
  }, [agent.messages]);

  useEffect(() => {
    if (agent.messages.length > 0) saveChatHistory();
  }, [agent.messages.length, saveChatHistory]);

  useEffect(() => {
    try {
      if (agent.messages.length > 0) {
        const lastMsg = agent.messages[agent.messages.length - 1];
        if (lastMsg?.role === 'user') {
          const parts = (lastMsg as { parts?: { type: string; text?: string }[] }).parts;
          const text = parts?.find(p => p.type === 'text')?.text;
          if (text) healingRef.current.addConversationEntry('user', text.substring(0, 500));
        } else if (lastMsg?.role === 'assistant') {
          const parts = (lastMsg as { parts?: { type: string; text?: string }[] }).parts;
          const text = parts?.find(p => p.type === 'text')?.text;
          if (text) healingRef.current.addConversationEntry('assistant', text.substring(0, 500));
        }
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.messages.length]);

  const sendErrorImpulse = useCallback((errorLog: string) => {
    try {
      if (!canSendAutoImpulse()) return;
      isProcessingImpulse.current = true;
      lastAutoImpulseTime.current = Date.now();
      autoImpulseCount.current++;
      console.log('[SelfHealingAgent] Error impulse received:', errorLog.substring(0, 80));
      agent.sendMessage(`[AUTO-IMPULS] Fehler erkannt:\n\n${errorLog}\n\nAnalysiere und erstelle einen Fix-Task. Speichere Erkenntnis in der Knowledge-Base.`);
      setTimeout(() => { isProcessingImpulse.current = false; }, IMPULSE_PROCESSING_LOCKOUT);
    } catch { isProcessingImpulse.current = false; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.sendMessage, canSendAutoImpulse]);

  const sendWithServerRetry = useCallback(async (...args: Parameters<typeof agent.sendMessage>): Promise<void> => {
    for (let attempt = 0; attempt <= SERVER_ERROR_RETRY_MAX; attempt++) {
      try {
        if (attempt > 0) {
          const delay = SERVER_ERROR_RETRY_DELAY_BASE * Math.pow(1.5, attempt - 1);
          console.log(`[SelfHealingAgent] Retry attempt ${attempt}/${SERVER_ERROR_RETRY_MAX} after ${Math.round(delay)}ms...`);
          resetCircuitBreaker();
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return agent.sendMessage(...args);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isServerError = msg.toLowerCase().includes('internal server error') ||
          msg.toLowerCase().includes('500') || msg.toLowerCase().includes('502') ||
          msg.toLowerCase().includes('503') || msg.toLowerCase().includes('bad gateway') ||
          msg.toLowerCase().includes('service unavailable');

        if (!isServerError || attempt >= SERVER_ERROR_RETRY_MAX) {
          console.error('[SelfHealingAgent] Fatal send error:', msg);
          throw e;
        }
        console.warn(`[SelfHealingAgent] Server error on attempt ${attempt}: ${msg}. Will retry...`);
        resetCircuitBreaker();
      }
    }
  }, [agent.sendMessage]);

  const wrappedSendMessage = useCallback((...args: Parameters<typeof agent.sendMessage>) => {
    try {
      if (checkForLoop()) {
        console.warn('[SelfHealingAgent] Loop prevented, skipping send');
        return;
      }
      const firstArg = args[0];
      if (agent.messages.length === 0 && typeof firstArg === 'string') {
        const memCtx = buildMemoryContext('healing');
        if (memCtx) {
          console.log('[SelfHealingAgent] Injecting memory context (' + memCtx.length + ' chars)');
          return sendWithServerRetry(memCtx + firstArg);
        }
      }
      return sendWithServerRetry(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[SelfHealingAgent] wrappedSendMessage error:', msg);
      if (msg.toLowerCase().includes('internal server error') || msg.toLowerCase().includes('500')) {
        resetCircuitBreaker();
      }
      return agent.sendMessage(...args);
    }
  }, [agent.messages.length, agent.sendMessage, checkForLoop, sendWithServerRetry]);

  return {
    messages: agent.messages,
    error: agent.error,
    sendMessage: wrappedSendMessage,
    setMessages: agent.setMessages,
    sendErrorImpulse,
    saveHealingMemory,
    getHealingMemory,
    getAllHealingMemory,
    saveKnowledge,
    getKnowledge,
    canSendAutoImpulse,
    projectInfo: { projectId: PROJECT_ID, projectRoot: PROJECT_ROOT, backendPath: BACKEND_PATH },
  };
}
