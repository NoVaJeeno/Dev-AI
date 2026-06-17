import { mmkv } from './mmkv';

const MEMORY_KEY = 'ai:memory';
const PERMANENT_REMINDER_KEY = 'permanent:reminders';
const CROSS_SESSION_KEY = 'cross:session_memory';
const HEALING_MEMORY_KEY = 'selfhealing:agent:memory';
const HEALING_KNOWLEDGE_KEY = 'selfhealing:agent:knowledge';
const WORKING_MEMORY_PRIMARY = 'agent:primary:working_memory';
const WORKING_MEMORY_SECONDARY = 'agent:secondary:working_memory';
const SHORT_TERM_KEY = 'memory:short_term';
const CONSOLIDATED_KEY = 'memory:consolidated';
const INTERACTION_LOG_KEY = 'memory:interaction_log';
const TASK_HISTORY_KEY = 'memory:task_history';

interface ShortTermEntry {
  content: string;
  timestamp: number;
  relevance: number;
  category: 'task' | 'fact' | 'preference' | 'context' | 'error' | 'result';
}

interface ConsolidatedMemory {
  summary: string;
  keyFacts: string[];
  lastConsolidated: number;
  sessionCount: number;
}

interface TaskHistoryEntry {
  task: string;
  result: 'success' | 'partial' | 'failed';
  timestamp: number;
  duration: number;
  toolsUsed: string[];
}

export function addShortTermMemory(content: string, category: ShortTermEntry['category'], relevance: number = 5): void {
  try {
    const entries = mmkv.getObject<ShortTermEntry[]>(SHORT_TERM_KEY) || [];
    entries.push({ content, timestamp: Date.now(), relevance, category });
    const MAX_SHORT_TERM = 100;
    if (entries.length > MAX_SHORT_TERM) {
      entries.sort((a, b) => (b.relevance * 2 + (b.timestamp / 1000)) - (a.relevance * 2 + (a.timestamp / 1000)));
      const trimmed = entries.slice(0, MAX_SHORT_TERM);
      mmkv.setObject(SHORT_TERM_KEY, trimmed);
    } else {
      mmkv.setObject(SHORT_TERM_KEY, entries);
    }
  } catch (e) {
    console.warn('[MemoryContext] Short-term save failed:', e);
  }
}

export function getRecentShortTermMemory(count: number = 20): ShortTermEntry[] {
  try {
    const entries = mmkv.getObject<ShortTermEntry[]>(SHORT_TERM_KEY) || [];
    const cutoff = Date.now() - (2 * 60 * 60 * 1000);
    const recent = entries.filter(e => e.timestamp > cutoff);
    recent.sort((a, b) => b.timestamp - a.timestamp);
    return recent.slice(0, count);
  } catch {
    return [];
  }
}

export function consolidateMemory(): void {
  try {
    const shortTerm = mmkv.getObject<ShortTermEntry[]>(SHORT_TERM_KEY) || [];
    const existing = mmkv.getObject<ConsolidatedMemory>(CONSOLIDATED_KEY) || {
      summary: '', keyFacts: [], lastConsolidated: 0, sessionCount: 0,
    };
    const highRelevance = shortTerm.filter(e => e.relevance >= 7);
    const newFacts = highRelevance.map(e => e.content);
    const mergedFacts = [...new Set([...existing.keyFacts, ...newFacts])];
    const MAX_FACTS = 200;
    const trimmedFacts = mergedFacts.length > MAX_FACTS ? mergedFacts.slice(-MAX_FACTS) : mergedFacts;
    const consolidated: ConsolidatedMemory = {
      summary: existing.summary || 'KI-Assistent mit persistentem Gedächtnis',
      keyFacts: trimmedFacts,
      lastConsolidated: Date.now(),
      sessionCount: existing.sessionCount + 1,
    };
    mmkv.setObject(CONSOLIDATED_KEY, consolidated);
    const oldCutoff = Date.now() - (6 * 60 * 60 * 1000);
    const freshEntries = shortTerm.filter(e => e.timestamp > oldCutoff || e.relevance >= 8);
    mmkv.setObject(SHORT_TERM_KEY, freshEntries);
    console.log('[MemoryContext] Consolidated memory: ' + trimmedFacts.length + ' key facts, ' + freshEntries.length + ' short-term kept');
  } catch (e) {
    console.warn('[MemoryContext] Consolidation failed:', e);
  }
}

export function addTaskHistory(task: string, result: TaskHistoryEntry['result'], duration: number, toolsUsed: string[]): void {
  try {
    const history = mmkv.getObject<TaskHistoryEntry[]>(TASK_HISTORY_KEY) || [];
    history.push({ task, result, timestamp: Date.now(), duration, toolsUsed });
    const MAX_HISTORY = 100;
    if (history.length > MAX_HISTORY) {
      mmkv.setObject(TASK_HISTORY_KEY, history.slice(-MAX_HISTORY));
    } else {
      mmkv.setObject(TASK_HISTORY_KEY, history);
    }
  } catch (e) {
    console.warn('[MemoryContext] Task history save failed:', e);
  }
}

export function getTaskHistory(count: number = 10): TaskHistoryEntry[] {
  try {
    const history = mmkv.getObject<TaskHistoryEntry[]>(TASK_HISTORY_KEY) || [];
    return history.slice(-count);
  } catch {
    return [];
  }
}

export function logInteraction(role: 'user' | 'ai', summary: string): void {
  try {
    const log = mmkv.getObject<Array<{ role: string; summary: string; ts: number }>>(INTERACTION_LOG_KEY) || [];
    log.push({ role, summary: summary.substring(0, 300), ts: Date.now() });
    const MAX_LOG = 200;
    if (log.length > MAX_LOG) {
      mmkv.setObject(INTERACTION_LOG_KEY, log.slice(-MAX_LOG));
    } else {
      mmkv.setObject(INTERACTION_LOG_KEY, log);
    }
  } catch {}
}

export function getRecentInteractions(count: number = 15): Array<{ role: string; summary: string; ts: number }> {
  try {
    const log = mmkv.getObject<Array<{ role: string; summary: string; ts: number }>>(INTERACTION_LOG_KEY) || [];
    return log.slice(-count);
  } catch {
    return [];
  }
}

export function buildMemoryContext(agent: 'primary' | 'secondary' | 'healing' = 'primary'): string {
  const sections: string[] = [];

  try {
    const permanent = mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY);
    if (permanent && Object.keys(permanent).length > 0) {
      sections.push('[PERMANENTE ERINNERUNGEN - NIEMALS VERGESSEN]\n' + Object.entries(permanent).map(([k, v]) => `• ${k}: ${v}`).join('\n'));
    }
  } catch (e) {
    console.warn('[MemoryContext] Failed to load permanent reminders:', e);
  }

  try {
    const consolidated = mmkv.getObject<ConsolidatedMemory>(CONSOLIDATED_KEY);
    if (consolidated && consolidated.keyFacts.length > 0) {
      const recentFacts = consolidated.keyFacts.slice(-50);
      sections.push('[LANGZEIT-GEDÄCHTNIS (Konsolidiert)]\n' +
        `Sessions: ${consolidated.sessionCount}\n` +
        recentFacts.map(f => `• ${f}`).join('\n'));
    }
  } catch {}

  try {
    const crossSession = mmkv.getObject<Record<string, { value: string; savedAt: number }>>(CROSS_SESSION_KEY);
    if (crossSession && Object.keys(crossSession).length > 0) {
      const sorted = Object.entries(crossSession).sort((a, b) => b[1].savedAt - a[1].savedAt);
      const display = sorted.slice(0, 40);
      sections.push('[CROSS-SESSION MEMORY]\n' + display.map(([k, v]) => `• ${k}: ${v.value}`).join('\n'));
    }
  } catch (e) {
    console.warn('[MemoryContext] Failed to load cross-session memory:', e);
  }

  try {
    const mainMemory = mmkv.getObject<Record<string, string>>(MEMORY_KEY);
    if (mainMemory && Object.keys(mainMemory).length > 0) {
      const entries = Object.entries(mainMemory);
      const display = entries.length > 50 ? entries.slice(-50) : entries;
      sections.push('[GESPEICHERTE ERINNERUNGEN]\n' + display.map(([k, v]) => `• ${k}: ${v}`).join('\n'));
    }
  } catch (e) {
    console.warn('[MemoryContext] Failed to load main memory:', e);
  }

  try {
    const shortTerm = getRecentShortTermMemory(15);
    if (shortTerm.length > 0) {
      sections.push('[KURZZEIT-GEDÄCHTNIS (Aktuelle Session)]\n' +
        shortTerm.map(e => {
          const age = Date.now() - e.timestamp;
          const ageStr = age < 60000 ? 'jetzt' : age < 3600000 ? `${Math.floor(age / 60000)}m` : `${Math.floor(age / 3600000)}h`;
          return `• [${ageStr}][${e.category}] ${e.content}`;
        }).join('\n'));
    }
  } catch {}

  try {
    const recentInteractions = getRecentInteractions(8);
    if (recentInteractions.length > 0) {
      sections.push('[LETZTE INTERAKTIONEN]\n' +
        recentInteractions.map(i => {
          const age = Date.now() - i.ts;
          const ageStr = age < 60000 ? 'jetzt' : age < 3600000 ? `${Math.floor(age / 60000)}m` : `${Math.floor(age / 3600000)}h`;
          return `• [${ageStr}] ${i.role === 'user' ? 'User' : 'KI'}: ${i.summary}`;
        }).join('\n'));
    }
  } catch {}

  try {
    const taskHist = getTaskHistory(5);
    if (taskHist.length > 0) {
      sections.push('[LETZTE TASKS]\n' +
        taskHist.map(t => {
          const dur = t.duration < 1000 ? `${t.duration}ms` : `${(t.duration / 1000).toFixed(1)}s`;
          return `• [${t.result}] ${t.task} (${dur}, Tools: ${t.toolsUsed.length})`;
        }).join('\n'));
    }
  } catch {}

  if (agent === 'healing') {
    try {
      const healMem = mmkv.getObject<Record<string, string>>(HEALING_MEMORY_KEY);
      if (healMem && Object.keys(healMem).length > 0) {
        const entries = Object.entries(healMem);
        const display = entries.length > 30 ? entries.slice(-30) : entries;
        sections.push('[SELF-HEALING MEMORY]\n' + display.map(([k, v]) => `• ${k}: ${v}`).join('\n'));
      }
    } catch {}

    try {
      const kb = mmkv.getObject<Record<string, string>>(HEALING_KNOWLEDGE_KEY);
      if (kb && Object.keys(kb).length > 0) {
        const entries = Object.entries(kb);
        const display = entries.length > 20 ? entries.slice(-20) : entries;
        sections.push('[KNOWLEDGE BASE]\n' + display.map(([k, v]) => `• ${k}: ${v}`).join('\n'));
      }
    } catch {}
  }

  try {
    const wmKey = agent === 'secondary' ? WORKING_MEMORY_SECONDARY : WORKING_MEMORY_PRIMARY;
    const wm = mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>(wmKey);
    if (wm && wm.task) {
      const age = Date.now() - wm.timestamp;
      if (age < 48 * 60 * 60 * 1000) {
        const ageStr = age < 60000 ? 'gerade eben' : age < 3600000 ? `vor ${Math.floor(age / 60000)} Min.` : `vor ${Math.floor(age / 3600000)} Std.`;
        sections.push(`[LETZTER TASK (${ageStr})]\nAufgabe: ${wm.task}\nKontext: ${wm.context || 'Keiner'}`);
      }
    }
  } catch {}

  if (sections.length === 0) return '';

  return `[DEIN GESPEICHERTES WISSEN - Du erinnerst dich an ALLES aus Kurzzeit- und Langzeit-Gedächtnis]\n${sections.join('\n\n')}\n[ENDE KONTEXT]\n\n`;
}

export function getMemoryStats(): { total: number; permanent: number; crossSession: number; main: number; shortTerm: number; consolidated: number; taskHistory: number } {
  let permanent = 0;
  let crossSession = 0;
  let main = 0;
  let shortTerm = 0;
  let consolidated = 0;
  let taskHistory = 0;

  try { permanent = Object.keys(mmkv.getObject<Record<string, string>>(PERMANENT_REMINDER_KEY) || {}).length; } catch {}
  try { crossSession = Object.keys(mmkv.getObject<Record<string, unknown>>(CROSS_SESSION_KEY) || {}).length; } catch {}
  try { main = Object.keys(mmkv.getObject<Record<string, string>>(MEMORY_KEY) || {}).length; } catch {}
  try { shortTerm = (mmkv.getObject<ShortTermEntry[]>(SHORT_TERM_KEY) || []).length; } catch {}
  try { consolidated = (mmkv.getObject<ConsolidatedMemory>(CONSOLIDATED_KEY)?.keyFacts || []).length; } catch {}
  try { taskHistory = (mmkv.getObject<TaskHistoryEntry[]>(TASK_HISTORY_KEY) || []).length; } catch {}

  return { total: permanent + crossSession + main + shortTerm + consolidated, permanent, crossSession, main, shortTerm, consolidated, taskHistory };
}
