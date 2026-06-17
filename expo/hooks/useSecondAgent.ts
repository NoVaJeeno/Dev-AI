import { useEffect, useRef, useCallback } from 'react';
import { z } from 'zod';
import { createRorkTool, useRorkAgent, generateText } from '@rork-ai/toolkit-sdk';
import { useStorage } from '@/providers/StorageProvider';
import { getFileLanguage } from '@/utils/helpers';
import { PROJECT_TEMPLATES } from '@/constants/templates';
import { mmkv } from '@/utils/mmkv';
import { buildMemoryContext } from '@/utils/memoryContext';
import { resetCircuitBreaker } from '@/utils/resilientFetch';
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

const LOOP_DETECTION_WINDOW = 20000;
const LOOP_TOOL_CALL_THRESHOLD = 250;
const LOOP_SAME_TOOL_THRESHOLD = 60;
const LOOP_COOLDOWN_MS = 4000;
const SERVER_ERROR_RETRY_MAX = 3;
const SERVER_ERROR_RETRY_DELAY_BASE = 2000;
const WORKING_MEMORY_KEY_2 = 'agent:secondary:working_memory';
const TASK_STATE_KEY_2 = 'agent:secondary:task_state';

export function useSecondAgent() {
  const storage = useStorage();
  const storageRef = useRef(storage);
  const toolCallTimestamps = useRef<number[]>([]);
  const toolCallNames = useRef<string[]>([]);
  const loopWarningIssued = useRef(false);
  const loopCooldownUntil = useRef(0);
  const taskStartTimeRef = useRef(0);
  const toolCallCountRef = useRef(0);
  const serverErrorRetryCount = useRef(0);

  useEffect(() => {
    storageRef.current = storage;
  }, [storage]);

  const checkForLoop = useCallback((toolName?: string): boolean => {
    const now = Date.now();
    if (now < loopCooldownUntil.current) return true;
    toolCallTimestamps.current.push(now);
    if (toolName) toolCallNames.current.push(toolName);
    toolCallTimestamps.current = toolCallTimestamps.current.filter(t => now - t < LOOP_DETECTION_WINDOW);
    toolCallNames.current = toolCallNames.current.slice(-20);
    toolCallCountRef.current++;
    if (toolCallTimestamps.current.length >= LOOP_TOOL_CALL_THRESHOLD) {
      if (!loopWarningIssued.current) {
        loopWarningIssued.current = true;
        loopCooldownUntil.current = now + LOOP_COOLDOWN_MS;
        console.warn('[SecondAgent] Loop detected! ' + toolCallTimestamps.current.length + ' calls. Cooldown active.');
        setTimeout(() => {
          loopWarningIssued.current = false;
          toolCallTimestamps.current = [];
          toolCallNames.current = [];
        }, LOOP_COOLDOWN_MS);
      }
      return true;
    }
    if (toolName && toolCallNames.current.length >= LOOP_SAME_TOOL_THRESHOLD) {
      const lastN = toolCallNames.current.slice(-LOOP_SAME_TOOL_THRESHOLD);
      if (lastN.every(n => n === toolName)) {
        console.warn('[SecondAgent] Same-tool loop:', toolName);
        loopCooldownUntil.current = now + 20000;
        toolCallNames.current = [];
        return true;
      }
    }
    return false;
  }, []);

  const getTaskProgress = useCallback(() => ({
    toolCallCount: toolCallCountRef.current,
    taskStartTime: taskStartTimeRef.current,
  }), []);

  const resetTaskTracking = useCallback(() => {
    toolCallCountRef.current = 0;
    taskStartTimeRef.current = Date.now();
    toolCallTimestamps.current = [];
    toolCallNames.current = [];
  }, []);

  const saveWorkingMemory = useCallback((taskSummary: string, context?: string) => {
    try {
      mmkv.setObject(WORKING_MEMORY_KEY_2, {
        task: taskSummary,
        context: context || '',
        timestamp: Date.now(),
        agent: 'secondary',
      });
      console.log('[SecondAgent] Working memory saved:', taskSummary.substring(0, 60));
    } catch (e) {
      console.warn('[SecondAgent] Working memory save failed:', e);
    }
  }, []);

  const getWorkingMemory = useCallback(() => {
    try {
      return mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>(WORKING_MEMORY_KEY_2);
    } catch {
      return null;
    }
  }, []);

  const saveTaskState = useCallback((state: 'idle' | 'working' | 'completed' | 'error', detail?: string) => {
    try {
      mmkv.setObject(TASK_STATE_KEY_2, { state, detail: detail || '', timestamp: Date.now() });
    } catch (e) {
      console.warn('[SecondAgent] Task state save failed:', e);
    }
  }, []);

  const agent = useRorkAgent({
    tools: {
      saveWorkingMemory: createRorkTool({
        description: 'Speichert den aktuellen Task-Kontext im Arbeitsspeicher der zweiten KI-Instanz.',
        zodSchema: z.object({
          task: z.string().describe('Zusammenfassung der aktuellen Aufgabe'),
          context: z.string().optional().describe('Zusätzlicher Kontext'),
        }),
        execute(input) {
          try {
            mmkv.setObject(WORKING_MEMORY_KEY_2, {
              task: input.task,
              context: input.context || '',
              timestamp: Date.now(),
              agent: 'secondary',
            });
            return `Arbeitsspeicher aktualisiert: "${input.task.substring(0, 80)}"`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getWorkingMemory: createRorkTool({
        description: 'Ruft den gespeicherten Arbeitsspeicher der zweiten KI ab.',
        zodSchema: z.object({}),
        execute() {
          try {
            const mem = mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>(WORKING_MEMORY_KEY_2);
            if (!mem) return 'Kein Arbeitsspeicher vorhanden.';
            const age = Date.now() - mem.timestamp;
            const ageStr = age < 60000 ? 'gerade eben' : age < 3600000 ? `vor ${Math.floor(age / 60000)} Min.` : `vor ${Math.floor(age / 3600000)} Std.`;
            return `Letzte Aufgabe (${ageStr}):\nTask: ${mem.task}\nKontext: ${mem.context || 'Keiner'}\nAgent: ${mem.agent}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      rememberNote: createRorkTool({
        description: 'Speichert eine dauerhafte Erinnerung die über alle Chats hinweg erhalten bleibt.',
        zodSchema: z.object({
          key: z.string().describe('Eindeutiger Schlüssel'),
          value: z.string().describe('Inhalt der Erinnerung'),
        }),
        execute(input) {
          try {
            storageRef.current.saveMemoryNote(input.key, input.value);
            return `Erinnerung gespeichert: "${input.key}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      recallAllMemory: createRorkTool({
        description: 'Ruft alle gespeicherten Erinnerungen ab.',
        zodSchema: z.object({}),
        execute() {
          try {
            const memory = storageRef.current.getAllMemory();
            const keys = Object.keys(memory);
            if (keys.length === 0) return 'Keine Erinnerungen gespeichert.';
            return `${keys.length} Erinnerungen:\n${keys.map(k => `• ${k}: ${memory[k]}`).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      createProject: createRorkTool({
        description: 'Erstellt ein neues Projekt. Typen: react-native, web, api, fullstack',
        zodSchema: z.object({
          name: z.string().describe('Projektname'),
          type: z.enum(['react-native', 'web', 'api', 'fullstack']).describe('Projekttyp'),
          description: z.string().optional().describe('Beschreibung'),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.createProject(input.name, input.type, input.description);
            s.setCurrentProject(project.id);
            return `Projekt "${input.name}" erstellt mit ID: ${project.id}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      writeFile: createRorkTool({
        description: 'Schreibt/erstellt eine Datei im aktuellen Projekt.',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
          content: z.string().describe('Dateiinhalt'),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const existingFile = project.files.find(f => f.path === input.path);
            const fileName = input.path.split('/').pop() || input.path;
            if (existingFile) {
              s.updateFileInProject(project.id, existingFile.id, { content: input.content });
              return `Datei aktualisiert: ${input.path}`;
            } else {
              s.addFileToProject(project.id, {
                path: input.path, name: fileName, content: input.content,
                type: 'file', language: getFileLanguage(fileName),
              });
              return `Datei erstellt: ${input.path}`;
            }
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      bulkWriteFiles: createRorkTool({
        description: 'Schreibt mehrere Dateien auf einmal.',
        zodSchema: z.object({
          files: z.array(z.object({
            path: z.string(),
            content: z.string(),
          })),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const results: string[] = [];
            for (const file of input.files) {
              const existing = project.files.find(f => f.path === file.path);
              const fileName = file.path.split('/').pop() || file.path;
              if (existing) {
                s.updateFileInProject(project.id, existing.id, { content: file.content });
                results.push(`Aktualisiert: ${file.path}`);
              } else {
                s.addFileToProject(project.id, {
                  path: file.path, name: fileName, content: file.content,
                  type: 'file', language: getFileLanguage(fileName),
                });
                results.push(`Erstellt: ${file.path}`);
              }
            }
            return `${input.files.length} Dateien geschrieben:\n${results.join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      readFile: createRorkTool({
        description: 'Liest eine Datei aus dem aktuellen Projekt',
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
        description: 'Löscht eine Datei aus dem aktuellen Projekt',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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
        description: 'Listet alle Dateien im aktuellen Projekt',
        zodSchema: z.object({}),
        execute() {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            if (project.files.length === 0) return `Projekt "${project.name}" hat keine Dateien.`;
            return `Dateien in "${project.name}":\n` +
              [...project.files].sort((a, b) => a.path.localeCompare(b.path))
                .map(f => `${f.type === 'folder' ? '[dir]' : '[file]'} ${f.path}`).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      listProjects: createRorkTool({
        description: 'Listet alle Projekte',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            if (s.state.projects.length === 0) return 'Keine Projekte.';
            return s.state.projects.map(p =>
              `${p.id === s.currentProject?.id ? '> ' : '  '}${p.name} (${p.type}) - ${p.files.length} Dateien`
            ).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      selectProject: createRorkTool({
        description: 'Wählt ein Projekt als aktiv',
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
        description: 'Sucht nach einem Pattern in Projektdateien',
        zodSchema: z.object({
          pattern: z.string(),
          path: z.string().optional(),
        }),
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
              lines.forEach((line, idx) => {
                if (regex.test(line)) results.push(`${file.path}:${idx + 1}: ${line.trim()}`);
                regex.lastIndex = 0;
              });
            }
            if (results.length === 0) return `Keine Treffer für "${input.pattern}"`;
            return `${results.length} Treffer:\n${results.slice(0, 30).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      findReplace: createRorkTool({
        description: 'Sucht und ersetzt Text in Projektdateien',
        zodSchema: z.object({
          find: z.string(),
          replace: z.string(),
          path: z.string().optional(),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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
            if (total === 0) return `Keine Vorkommen von "${input.find}" gefunden.`;
            return `${total} Ersetzungen durchgeführt.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      installPackage: createRorkTool({
        description: 'Fügt Pakete zu den Projektabhängigkeiten hinzu',
        zodSchema: z.object({
          packages: z.array(z.string()),
          dev: z.boolean().optional(),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json');
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

      analyzeCode: createRorkTool({
        description: 'Analysiert Code im Projekt',
        zodSchema: z.object({ path: z.string().optional() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = input.path
              ? project.files.filter(f => f.path === input.path)
              : project.files.filter(f => f.type === 'file');
            if (files.length === 0) return 'Keine Dateien gefunden.';
            const issues: string[] = [];
            let totalLines = 0;
            for (const file of files) {
              const lines = file.content.split('\n');
              totalLines += lines.length;
              lines.forEach((line, idx) => {
                if (line.includes(': any') && (file.name.endsWith('.ts') || file.name.endsWith('.tsx')))
                  issues.push(`${file.path}:${idx + 1}: "any" Type`);
                if (line.includes('TODO') || line.includes('FIXME'))
                  issues.push(`${file.path}:${idx + 1}: ${line.trim()}`);
              });
            }
            let result = `Analyse: ${files.length} Dateien, ${totalLines} Zeilen\n`;
            result += issues.length > 0
              ? `${issues.length} Hinweise:\n${issues.slice(0, 20).join('\n')}`
              : 'Keine Probleme gefunden!';
            return result;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      webFetch: createRorkTool({
        description: 'Ruft Webinhalte von einer URL ab',
        zodSchema: z.object({
          url: z.string(),
          type: z.enum(['text', 'json', 'html']).optional(),
        }),
        async execute(input) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(input.url, {
              signal: controller.signal,
              headers: { 'User-Agent': 'SecondAgent/1.0' },
            });
            clearTimeout(timeout);
            if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
            let body = await response.text();
            if (body.length > 15000) body = body.substring(0, 15000) + '\n[... gekürzt]';
            return `URL: ${input.url}\nStatus: ${response.status}\n\n${body}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      httpRequest: createRorkTool({
        description: 'Führt HTTP-Requests aus',
        zodSchema: z.object({
          url: z.string(),
          method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().optional(),
        }),
        async execute(input) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const options: RequestInit = {
              method: input.method || 'GET',
              signal: controller.signal,
              headers: { ...input.headers, 'User-Agent': 'SecondAgent/1.0' },
            };
            if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method || '')) {
              options.body = input.body;
            }
            const response = await fetch(input.url, options);
            clearTimeout(timeout);
            let body = await response.text();
            if (body.length > 10000) body = body.substring(0, 10000) + '\n[... gekürzt]';
            return `Status: ${response.status}\n\n${body}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      analyzeWithAI: createRorkTool({
        description: 'Analysiert Text/Code/Bilder mit KI',
        zodSchema: z.object({
          prompt: z.string(),
          content: z.string().optional(),
          imageUri: z.string().optional(),
        }),
        async execute(input) {
          try {
            const fullPrompt = input.prompt + (input.content ? `\n\nContent:\n${input.content}` : '');
            if (input.imageUri) {
              const result = await generateText({
                messages: [{
                  role: 'user' as const,
                  content: [
                    { type: 'text' as const, text: fullPrompt },
                    { type: 'image' as const, image: input.imageUri },
                  ],
                }],
              });
              return result || 'Keine Analyse verfügbar.';
            } else {
              const result = await generateText(fullPrompt);
              return result || 'Keine Analyse verfügbar.';
            }
          } catch (e) { return `KI-Analyse Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateTextAI: createRorkTool({
        description: 'Generiert Text mit KI',
        zodSchema: z.object({
          prompt: z.string(),
          context: z.string().optional(),
        }),
        async execute(input) {
          try {
            const fullPrompt = input.context ? `${input.prompt}\n\nKontext:\n${input.context}` : input.prompt;
            const result = await generateText(fullPrompt);
            return result || 'Keine Textgenerierung möglich.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getProjectInfo: createRorkTool({
        description: 'Gibt Informationen über das aktuelle Projekt',
        zodSchema: z.object({}),
        execute() {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const totalLines = project.files.filter(f => f.type === 'file').reduce((acc, f) => acc + f.content.split('\n').length, 0);
            return `Projekt: ${project.name}\nTyp: ${project.type}\nStatus: ${project.status}\nDateien: ${project.files.length}\nZeilen: ${totalLines}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getEnvironmentInfo: createRorkTool({
        description: 'Gibt Informationen über die Entwicklungsumgebung',
        zodSchema: z.object({}),
        execute() {
          const memory = storageRef.current.getAllMemory();
          return `Plattform: React Native (Expo SDK 54)
Speicher: MMKV Cache Engine
AI Engine: @rork-ai/toolkit-sdk (Second Instance)
Memory: ${Object.keys(memory).length} Erinnerungen
Tools: Development Tools (Parallel Agent)
Rolle: Zweite KI-Instanz für parallele Aufgaben`;
        },
      }),

      getAppStructure: createRorkTool({
        description: 'Gibt die Struktur der Host-App zurück',
        zodSchema: z.object({}),
        execute() {
          return `Host-App: Developer AI (Expo SDK 54, React Native, TypeScript)
Tabs: Chat, Projekte, Dateien, Tools, Terminal, Settings
Zweite KI-Instanz: Aktiv und parallel arbeitsfähig
Speicher: MMKV + AsyncStorage (persistent)`;
        },
      }),

      recallNote: createRorkTool({
        description: 'Ruft eine gespeicherte Erinnerung ab',
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
        description: 'Löscht eine gespeicherte Erinnerung',
        zodSchema: z.object({ key: z.string() }),
        execute(input) {
          try {
            storageRef.current.deleteMemoryNote(input.key);
            return `Erinnerung "${input.key}" gelöscht.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getConversationHistory: createRorkTool({
        description: 'Gibt eine Übersicht aller Chat-Konversationen',
        zodSchema: z.object({}),
        execute() {
          try {
            const convs = storageRef.current.state.conversations;
            if (convs.length === 0) return 'Keine Konversationen.';
            return `${convs.length} Konversationen:\n${convs.slice(0, 20).map(c => {
              const date = new Date(c.updatedAt).toLocaleString('de-DE');
              return `• "${c.title}" (${c.messages.length} Nachrichten, ${date})`;
            }).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      renameFile: createRorkTool({
        description: 'Benennt eine Datei um oder verschiebt sie',
        zodSchema: z.object({ oldPath: z.string(), newPath: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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

      duplicateFile: createRorkTool({
        description: 'Dupliziert eine Datei',
        zodSchema: z.object({ sourcePath: z.string(), targetPath: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const src = project.files.find(f => f.path === input.sourcePath);
            if (!src) return `Datei nicht gefunden: ${input.sourcePath}`;
            const targetName = input.targetPath.split('/').pop() || input.targetPath;
            s.addFileToProject(project.id, { path: input.targetPath, name: targetName, content: src.content, type: 'file', language: getFileLanguage(targetName) });
            return `Dupliziert: ${input.sourcePath} -> ${input.targetPath}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      createFolder: createRorkTool({
        description: 'Erstellt einen Ordner',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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
        description: 'Entfernt Pakete aus den Projektabhängigkeiten',
        zodSchema: z.object({ packages: z.array(z.string()) }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json');
            if (pkgFile) {
              const pkg = JSON.parse(pkgFile.content);
              input.packages.forEach(p => {
                if (pkg.dependencies?.[p]) delete pkg.dependencies[p];
                if (pkg.devDependencies?.[p]) delete pkg.devDependencies[p];
              });
              s.updateFileInProject(project.id, pkgFile.id, { content: JSON.stringify(pkg, null, 2) });
            }
            return `Pakete entfernt: ${input.packages.join(', ')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      updateProjectStatus: createRorkTool({
        description: 'Aktualisiert den Projektstatus',
        zodSchema: z.object({ status: z.enum(['draft', 'building', 'completed', 'error']) }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            s.updateProject(project.id, { status: input.status });
            return `Status: "${input.status}"`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      deleteProject: createRorkTool({
        description: 'Löscht ein Projekt',
        zodSchema: z.object({ projectId: z.string() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const p = s.state.projects.find(p => p.id === input.projectId);
            if (!p) return 'Projekt nicht gefunden.';
            const name = p.name;
            s.deleteProject(input.projectId);
            return `Projekt "${name}" gelöscht.`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      cloneProject: createRorkTool({
        description: 'Klont ein Projekt',
        zodSchema: z.object({ sourceProjectId: z.string(), newName: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const source = s.state.projects.find(p => p.id === input.sourceProjectId);
            if (!source) return 'Quellprojekt nicht gefunden.';
            const cloned = s.createProject(input.newName, source.type, source.description);
            for (const file of source.files) {
              s.addFileToProject(cloned.id, { path: file.path, name: file.name, content: file.content, type: file.type, language: file.language });
            }
            s.setCurrentProject(cloned.id);
            return `"${source.name}" als "${input.newName}" geklont (${source.files.length} Dateien).`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      appendToFile: createRorkTool({
        description: 'Fügt Text am Ende einer Datei hinzu',
        zodSchema: z.object({ path: z.string(), content: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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
        description: 'Fügt Text an einer bestimmten Zeile ein',
        zodSchema: z.object({ path: z.string(), line: z.number(), content: z.string() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
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

      mergeFiles: createRorkTool({
        description: 'Fügt mehrere Dateien zusammen',
        zodSchema: z.object({ sourcePaths: z.array(z.string()), targetPath: z.string(), separator: z.string().optional() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const sep = input.separator || '\n\n';
            const contents: string[] = [];
            for (const path of input.sourcePaths) {
              const file = project.files.find(f => f.path === path);
              if (!file) return `Datei nicht gefunden: ${path}`;
              contents.push(`// --- ${path} ---\n${file.content}`);
            }
            const merged = contents.join(sep);
            const targetName = input.targetPath.split('/').pop() || input.targetPath;
            const existing = project.files.find(f => f.path === input.targetPath);
            if (existing) {
              s.updateFileInProject(project.id, existing.id, { content: merged });
            } else {
              s.addFileToProject(project.id, { path: input.targetPath, name: targetName, content: merged, type: 'file', language: getFileLanguage(targetName) });
            }
            return `${input.sourcePaths.length} Dateien zusammengeführt in: ${input.targetPath}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      exportFile: createRorkTool({
        description: 'Exportiert eine Datei als Text',
        zodSchema: z.object({ path: z.string() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            return `--- ${file.path} (${file.language || 'text'}) ---\n${file.content}\n--- ENDE ---`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      getProjectStats: createRorkTool({
        description: 'Statistiken über alle Projekte',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            let totalFiles = 0, totalLines = 0;
            for (const project of s.state.projects) {
              for (const file of project.files) {
                if (file.type === 'file') { totalFiles++; totalLines += file.content.split('\n').length; }
              }
            }
            const memoryKeys = Object.keys(s.getAllMemory()).length;
            return `Projekte: ${s.state.projects.length}\nChats: ${s.state.conversations.length}\nDateien: ${totalFiles}\nZeilen: ${totalLines}\nErinnerungen: ${memoryKeys}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      validateJson: createRorkTool({
        description: 'Validiert und formatiert JSON',
        zodSchema: z.object({ json: z.string(), fix: z.boolean().optional() }),
        execute(input) {
          try {
            const parsed = JSON.parse(input.json);
            return `Gültiges JSON\n${JSON.stringify(parsed, null, 2).substring(0, 2000)}`;
          } catch (e) {
            if (input.fix) {
              try {
                const fixed = input.json.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
                const parsed = JSON.parse(fixed);
                return `JSON repariert:\n${JSON.stringify(parsed, null, 2).substring(0, 2000)}`;
              } catch { return `JSON nicht reparierbar: ${e instanceof Error ? e.message : String(e)}`; }
            }
            return `Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateComponent: createRorkTool({
        description: 'Generiert eine React/React Native Komponente',
        zodSchema: z.object({
          name: z.string(),
          props: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean().optional() })).optional(),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const name = input.name;
            const propsI = input.props && input.props.length > 0
              ? `interface ${name}Props {\n${input.props.map(p => `  ${p.name}${p.optional ? '?' : ''}: ${p.type};`).join('\n')}\n}`
              : `interface ${name}Props {}`;
            const content = `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\n${propsI}\n\nexport const ${name}: React.FC<${name}Props> = (props) => {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.text}>${name}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { padding: 16 },\n  text: { fontSize: 16, fontWeight: '600' },\n});`;
            const path = `src/components/${name}.tsx`;
            s.addFileToProject(project.id, { path, name: `${name}.tsx`, content, type: 'file', language: 'typescript' });
            return `Komponente erstellt: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateScreen: createRorkTool({
        description: 'Generiert einen Screen/eine Seite',
        zodSchema: z.object({ name: z.string(), navigation: z.enum(['stack', 'tab', 'modal']).optional() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const name = input.name;
            const content = `import React from 'react';\nimport { View, Text, StyleSheet, ScrollView } from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';\n\nexport default function ${name}Screen() {\n  return (\n    <SafeAreaView style={styles.container}>\n      <ScrollView style={styles.content}>\n        <Text style={styles.title}>${name}</Text>\n      </ScrollView>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, backgroundColor: '#fff' },\n  content: { flex: 1, padding: 20 },\n  title: { fontSize: 28, fontWeight: '700' },\n});`;
            const path = `src/screens/${name}Screen.tsx`;
            s.addFileToProject(project.id, { path, name: `${name}Screen.tsx`, content, type: 'file', language: 'typescript' });
            return `Screen erstellt: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateHook: createRorkTool({
        description: 'Generiert einen Custom React Hook',
        zodSchema: z.object({ name: z.string(), type: z.enum(['state', 'fetch', 'form', 'animation']).optional() }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const hookName = `use${input.name.charAt(0).toUpperCase() + input.name.slice(1)}`;
            const content = `import { useState, useCallback } from 'react';\n\nexport function ${hookName}() {\n  const [data, setData] = useState<unknown>(null);\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n\n  const execute = useCallback(async () => {\n    setLoading(true);\n    setError(null);\n    try {\n      setData(null);\n    } catch (e) {\n      setError(e instanceof Error ? e.message : 'Error');\n    } finally {\n      setLoading(false);\n    }\n  }, []);\n\n  return { data, loading, error, execute };\n}`;
            const path = `src/hooks/${hookName}.ts`;
            s.addFileToProject(project.id, { path, name: `${hookName}.ts`, content, type: 'file', language: 'typescript' });
            return `Hook erstellt: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateApiRoute: createRorkTool({
        description: 'Generiert eine API-Route',
        zodSchema: z.object({ name: z.string(), methods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE'])) }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const methods = input.methods.map(m => `router.${m.toLowerCase()}('/${input.name}', async (req, res) => {\n  try {\n    res.json({ success: true });\n  } catch (error) {\n    res.status(500).json({ error: 'Server error' });\n  }\n});`).join('\n\n');
            const content = `import { Router } from 'express';\n\nconst router = Router();\n\n${methods}\n\nexport default router;`;
            const path = `src/routes/${input.name}.ts`;
            s.addFileToProject(project.id, { path, name: `${input.name}.ts`, content, type: 'file', language: 'typescript' });
            return `API Route erstellt: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateModel: createRorkTool({
        description: 'Generiert ein TypeScript Datenmodell',
        zodSchema: z.object({
          name: z.string(),
          fields: z.array(z.object({ name: z.string(), type: z.string(), optional: z.boolean().optional() })),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const fields = input.fields.map(f => `  ${f.name}${f.optional ? '?' : ''}: ${f.type};`).join('\n');
            const content = `export interface ${input.name} {\n${fields}\n}`;
            const path = `src/models/${input.name}.ts`;
            s.addFileToProject(project.id, { path, name: `${input.name}.ts`, content, type: 'file', language: 'typescript' });
            return `Model erstellt: ${path}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      scaffoldProject: createRorkTool({
        description: 'Erstellt ein Projekt aus Template',
        zodSchema: z.object({
          template: z.enum(['react-native-app', 'nextjs-app', 'express-api', 'landing-page', 'react-dashboard']),
          name: z.string(),
          description: z.string().optional(),
        }),
        execute(input) {
          try {
            if (checkForLoop()) return 'Loop-Schutz aktiv.';
            const s = storageRef.current;
            const template = PROJECT_TEMPLATES[input.template];
            if (!template) return `Template "${input.template}" nicht gefunden.`;
            const project = s.createProject(input.name, template.type, input.description || template.description);
            s.setCurrentProject(project.id);
            for (const file of template.files) {
              const fileName = file.path.split('/').pop() || file.path;
              s.addFileToProject(project.id, {
                path: file.path, name: fileName,
                content: file.content.replace(/\{\{PROJECT_NAME\}\}/g, input.name),
                type: 'file', language: getFileLanguage(fileName),
              });
            }
            s.updateProject(project.id, { status: 'building' });
            return `Projekt "${input.name}" aus Template "${input.template}" erstellt (${template.files.length} Dateien).`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      previewProject: createRorkTool({
        description: 'Generiert eine Vorschau des aktuellen Projekts',
        zodSchema: z.object({}),
        execute() {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const fileCount = project.files.filter(f => f.type === 'file').length;
            return `Vorschau bereit für "${project.name}" (${fileCount} Dateien, ${project.type}).`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      compareFiles: createRorkTool({
        description: 'Vergleicht zwei Dateien',
        zodSchema: z.object({ path1: z.string(), path2: z.string() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const f1 = project.files.find(f => f.path === input.path1);
            const f2 = project.files.find(f => f.path === input.path2);
            if (!f1) return `Datei nicht gefunden: ${input.path1}`;
            if (!f2) return `Datei nicht gefunden: ${input.path2}`;
            const l1 = f1.content.split('\n'), l2 = f2.content.split('\n');
            const diffs: string[] = [];
            let changes = 0;
            for (let i = 0; i < Math.max(l1.length, l2.length); i++) {
              if (l1[i] !== l2[i]) {
                changes++;
                diffs.push(`@@ Zeile ${i + 1} @@`);
                if (l1[i] !== undefined) diffs.push(`- ${l1[i]}`);
                if (l2[i] !== undefined) diffs.push(`+ ${l2[i]}`);
              }
            }
            if (changes === 0) return 'Dateien sind identisch.';
            return `${changes} Unterschiede:\n${diffs.slice(0, 50).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      extractImports: createRorkTool({
        description: 'Extrahiert alle Imports aus Projektdateien',
        zodSchema: z.object({ path: z.string().optional() }),
        execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = input.path ? project.files.filter(f => f.path === input.path) : project.files.filter(f => f.type === 'file');
            const allImports: Record<string, string[]> = {};
            for (const file of files) {
              const importRegex = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
              let match;
              const imports: string[] = [];
              while ((match = importRegex.exec(file.content)) !== null) imports.push(match[1]);
              if (imports.length > 0) allImports[file.path] = imports;
            }
            const entries = Object.entries(allImports);
            if (entries.length === 0) return 'Keine Imports gefunden.';
            const uniqueModules = [...new Set(entries.flatMap(([, imps]) => imps))];
            return `${uniqueModules.length} Imports in ${entries.length} Dateien:\n${uniqueModules.sort().join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateMockData: createRorkTool({
        description: 'Generiert Mock-Daten',
        zodSchema: z.object({
          type: z.enum(['users', 'products', 'posts', 'todos', 'custom']),
          count: z.number().optional(),
          fields: z.array(z.string()).optional(),
        }),
        execute(input) {
          const count = Math.min(input.count || 5, 50);
          const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
          const rid = () => Math.random().toString(36).substring(2, 8);
          const names = ['Alex', 'Maria', 'Jan', 'Sarah', 'Max', 'Lisa', 'Tom', 'Anna'];
          switch (input.type) {
            case 'users': return JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `${rnd(names)} ${rid()}`, email: `${rid()}@mail.com`, active: Math.random() > 0.2 })), null, 2);
            case 'products': return JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Produkt ${rid()}`, price: +(Math.random() * 200 + 5).toFixed(2), stock: Math.floor(Math.random() * 100) })), null, 2);
            case 'posts': return JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Beitrag ${rid()}`, body: 'Lorem ipsum.', likes: Math.floor(Math.random() * 500) })), null, 2);
            case 'todos': return JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Aufgabe ${rid()}`, completed: Math.random() > 0.5, priority: rnd(['low', 'medium', 'high']) })), null, 2);
            default: {
              const fields = input.fields || ['id', 'name', 'value'];
              return JSON.stringify(Array.from({ length: count }, (_, i) => {
                const obj: Record<string, unknown> = {};
                fields.forEach(f => { obj[f] = f === 'id' ? i + 1 : `${f}_${rid()}`; });
                return obj;
              }), null, 2);
            }
          }
        },
      }),

      encodeDecodeText: createRorkTool({
        description: 'Encodiert/Decodiert Text (Base64, URL)',
        zodSchema: z.object({
          text: z.string(),
          operation: z.enum(['base64-encode', 'base64-decode', 'url-encode', 'url-decode']),
        }),
        execute(input) {
          try {
            switch (input.operation) {
              case 'base64-encode': return btoa(unescape(encodeURIComponent(input.text)));
              case 'base64-decode': return decodeURIComponent(escape(atob(input.text)));
              case 'url-encode': return encodeURIComponent(input.text);
              case 'url-decode': return decodeURIComponent(input.text);
              default: return 'Unbekannte Operation';
            }
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      calculateExpression: createRorkTool({
        description: 'Berechnet mathematische Ausdrücke',
        zodSchema: z.object({ expression: z.string() }),
        execute(input) {
          try {
            const safe = input.expression.replace(/[^0-9+\-*/.()%\s^eE,Math.sqrtpowabsceilfloorminmaxroundlogPIrandom]/g, '');
            if (safe.length === 0) return 'Ungültiger Ausdruck';
            const fn = new Function(`"use strict"; return (${safe})`);
            const result = fn();
            return `${input.expression} = ${result}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generatePassword: createRorkTool({
        description: 'Generiert sichere Passwörter',
        zodSchema: z.object({ length: z.number().optional(), count: z.number().optional() }),
        execute(input) {
          const len = Math.min(Math.max(input.length || 16, 4), 128);
          const count = Math.min(input.count || 1, 10);
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
          const passwords: string[] = [];
          for (let i = 0; i < count; i++) {
            let pw = '';
            for (let j = 0; j < len; j++) pw += chars[Math.floor(Math.random() * chars.length)];
            passwords.push(pw);
          }
          return passwords.join('\n');
        },
      }),

      generateUuid: createRorkTool({
        description: 'Generiert UUIDs',
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

      diffTexts: createRorkTool({
        description: 'Vergleicht zwei Texte',
        zodSchema: z.object({ text1: z.string(), text2: z.string() }),
        execute(input) {
          const l1 = input.text1.split('\n'), l2 = input.text2.split('\n');
          const diffs: string[] = [];
          let changes = 0;
          for (let i = 0; i < Math.max(l1.length, l2.length); i++) {
            if (l1[i] !== l2[i]) {
              changes++;
              diffs.push(`@@ Zeile ${i + 1} @@`);
              if (l1[i] !== undefined) diffs.push(`- ${l1[i]}`);
              if (l2[i] !== undefined) diffs.push(`+ ${l2[i]}`);
            }
          }
          if (changes === 0) return 'Keine Unterschiede.';
          return `${changes} Änderungen:\n${diffs.slice(0, 60).join('\n')}`;
        },
      }),

      countStats: createRorkTool({
        description: 'Zählt Wörter, Zeichen, Zeilen',
        zodSchema: z.object({ text: z.string() }),
        execute(input) {
          const lines = input.text.split('\n').length;
          const words = input.text.split(/\s+/).filter(w => w.length > 0).length;
          return `Zeilen: ${lines}\nWörter: ${words}\nZeichen: ${input.text.length}`;
        },
      }),

      convertCase: createRorkTool({
        description: 'Konvertiert Text in verschiedene Schreibweisen',
        zodSchema: z.object({
          text: z.string(),
          to: z.enum(['camelCase', 'snake_case', 'PascalCase', 'CONSTANT_CASE', 'kebab-case']),
        }),
        execute(input) {
          const words = input.text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').trim().split(/\s+/).map(w => w.toLowerCase());
          switch (input.to) {
            case 'camelCase': return words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
            case 'PascalCase': return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
            case 'snake_case': return words.join('_');
            case 'CONSTANT_CASE': return words.join('_').toUpperCase();
            case 'kebab-case': return words.join('-');
            default: return input.text;
          }
        },
      }),

      generateTypeFromJson: createRorkTool({
        description: 'Generiert TypeScript Interfaces aus JSON',
        zodSchema: z.object({ json: z.string(), name: z.string().optional() }),
        execute(input) {
          try {
            const data = JSON.parse(input.json);
            const rootName = input.name || 'Root';
            const interfaces: string[] = [];
            function getType(value: unknown, name: string): string {
              if (value === null || value === undefined) return 'unknown';
              if (typeof value === 'string') return 'string';
              if (typeof value === 'number') return 'number';
              if (typeof value === 'boolean') return 'boolean';
              if (Array.isArray(value)) return value.length === 0 ? 'unknown[]' : `${getType(value[0], name + 'Item')}[]`;
              if (typeof value === 'object') {
                const iName = name.charAt(0).toUpperCase() + name.slice(1);
                const fields = Object.entries(value as Record<string, unknown>).map(([k, v]) => `  ${k}: ${getType(v, k)};`);
                interfaces.push(`export interface ${iName} {\n${fields.join('\n')}\n}`);
                return iName;
              }
              return 'unknown';
            }
            getType(data, rootName);
            return interfaces.reverse().join('\n\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      colorConvert: createRorkTool({
        description: 'Konvertiert Farben zwischen HEX, RGB und HSL',
        zodSchema: z.object({ color: z.string() }),
        execute(input) {
          try {
            const c = input.color.trim().toLowerCase();
            const named: Record<string, string> = { red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff', black: '#000000' };
            let hex = named[c] || c;
            let r = 0, g = 0, b = 0;
            if (hex.startsWith('#')) {
              hex = hex.replace('#', '');
              if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
              r = parseInt(hex.substring(0, 2), 16); g = parseInt(hex.substring(2, 4), 16); b = parseInt(hex.substring(4, 6), 16);
            } else if (c.startsWith('rgb')) {
              const m = c.match(/\d+/g);
              if (m) { r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]); }
            }
            return `HEX: #${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}\nRGB: rgb(${r}, ${g}, ${b})`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      loremIpsum: createRorkTool({
        description: 'Generiert Platzhaltertext',
        zodSchema: z.object({ paragraphs: z.number().optional() }),
        execute(input) {
          const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
          const pCount = Math.min(input.paragraphs || 1, 10);
          const paragraphs: string[] = [];
          for (let p = 0; p < pCount; p++) {
            const sents: string[] = [];
            for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
              const s: string[] = [];
              for (let j = 0; j < 8 + Math.floor(Math.random() * 12); j++) s.push(words[Math.floor(Math.random() * words.length)]);
              s[0] = s[0].charAt(0).toUpperCase() + s[0].slice(1);
              sents.push(s.join(' ') + '.');
            }
            paragraphs.push(sents.join(' '));
          }
          return paragraphs.join('\n\n');
        },
      }),

      formatCode: createRorkTool({
        description: 'Formatiert JSON Code',
        zodSchema: z.object({ code: z.string(), language: z.enum(['json', 'javascript', 'typescript']).optional() }),
        execute(input) {
          try {
            if ((input.language || 'json') === 'json') return JSON.stringify(JSON.parse(input.code), null, 2);
            return input.code.replace(/;\s*/g, ';\n').replace(/\{\s*/g, '{\n  ').replace(/\}\s*/g, '\n}\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateReadme: createRorkTool({
        description: 'Generiert eine README.md für das Projekt',
        zodSchema: z.object({ extraInfo: z.string().optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = project.files.filter(f => f.type === 'file');
            const totalLines = files.reduce((acc, f) => acc + f.content.split('\n').length, 0);
            let readme = `# ${project.name}\n\n${project.description || project.type}\n\n## Übersicht\n\n- Dateien: ${files.length}\n- Zeilen: ${totalLines}\n\n`;
            if (input.extraInfo) readme += `## Hinweise\n\n${input.extraInfo}\n\n`;
            const existing = project.files.find(f => f.path === 'README.md');
            if (existing) {
              s.updateFileInProject(project.id, existing.id, { content: readme });
            } else {
              s.addFileToProject(project.id, { path: 'README.md', name: 'README.md', content: readme, type: 'file', language: 'markdown' });
            }
            return `README.md generiert`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateGitignore: createRorkTool({
        description: 'Generiert .gitignore',
        zodSchema: z.object({ type: z.enum(['node', 'react-native', 'python', 'general']).optional() }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const base = ['node_modules/', '.env', '.DS_Store', '*.log', 'dist/', 'build/'];
            const extra: Record<string, string[]> = {
              node: ['coverage/', '*.tsbuildinfo'],
              'react-native': ['.expo/', 'web-build/', 'ios/Pods/', 'android/.gradle/'],
              python: ['__pycache__/', '*.pyc', '.venv/'],
              general: [],
            };
            const content = [...base, ...(extra[input.type || 'node'] || [])].join('\n');
            const existing = project.files.find(f => f.path === '.gitignore');
            if (existing) { s.updateFileInProject(project.id, existing.id, { content }); }
            else { s.addFileToProject(project.id, { path: '.gitignore', name: '.gitignore', content, type: 'file' }); }
            return `.gitignore generiert`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      generateEnvTemplate: createRorkTool({
        description: 'Generiert .env.example',
        zodSchema: z.object({}),
        execute() {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const envVars = new Set<string>();
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              let match;
              const regex = /process\.env\[?['"]?(\w+)['"]?\]?/g;
              while ((match = regex.exec(file.content)) !== null) envVars.add(match[1]);
            }
            if (envVars.size === 0) return 'Keine Umgebungsvariablen gefunden.';
            const content = [...envVars].sort().map(v => `${v}=`).join('\n');
            const s = storageRef.current;
            const existing = project.files.find(f => f.path === '.env.example');
            if (existing) { s.updateFileInProject(project.id, existing.id, { content }); }
            else { s.addFileToProject(project.id, { path: '.env.example', name: '.env.example', content, type: 'file' }); }
            return `.env.example generiert (${envVars.size} Variablen)`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      sortLines: createRorkTool({
        description: 'Sortiert Zeilen eines Textes',
        zodSchema: z.object({ text: z.string(), order: z.enum(['asc', 'desc']).optional(), unique: z.boolean().optional() }),
        execute(input) {
          let lines = input.text.split('\n');
          if (input.unique) lines = [...new Set(lines)];
          if (input.order === 'desc') lines.sort((a, b) => b.localeCompare(a));
          else lines.sort((a, b) => a.localeCompare(b));
          return lines.join('\n');
        },
      }),

      testRegex: createRorkTool({
        description: 'Testet einen regulären Ausdruck',
        zodSchema: z.object({ pattern: z.string(), text: z.string(), flags: z.string().optional() }),
        execute(input) {
          try {
            const regex = new RegExp(input.pattern, input.flags || 'g');
            const matches: string[] = [];
            let match;
            while ((match = regex.exec(input.text)) !== null && matches.length < 30) {
              matches.push(`[${match.index}]: "${match[0]}"`);
              if (!regex.global) break;
            }
            if (matches.length === 0) return 'Keine Treffer.';
            return `${matches.length} Treffer:\n${matches.join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      convertTimestamp: createRorkTool({
        description: 'Konvertiert Timestamps',
        zodSchema: z.object({ value: z.string(), to: z.enum(['unix', 'iso', 'date', 'all']).optional() }),
        execute(input) {
          try {
            const val = input.value.trim();
            let date: Date;
            if (/^\d{10}$/.test(val)) date = new Date(parseInt(val) * 1000);
            else if (/^\d{13}$/.test(val)) date = new Date(parseInt(val));
            else if (val === 'now') date = new Date();
            else date = new Date(val);
            if (isNaN(date.getTime())) return `Ungültiges Datum: ${val}`;
            return `ISO: ${date.toISOString()}\nUnix: ${Math.floor(date.getTime() / 1000)}\nLokal: ${date.toLocaleString('de-DE')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      hashText: createRorkTool({
        description: 'Erstellt einen Hash eines Textes',
        zodSchema: z.object({ text: z.string() }),
        execute(input) {
          let hash = 0;
          for (let i = 0; i < input.text.length; i++) {
            hash = ((hash << 5) - hash) + input.text.charCodeAt(i);
            hash |= 0;
          }
          return `Hash: ${Math.abs(hash).toString(16).padStart(8, '0')}\nLength: ${input.text.length}`;
        },
      }),

      wrapCode: createRorkTool({
        description: 'Umschließt Code mit try/catch, async/await etc.',
        zodSchema: z.object({
          code: z.string(),
          wrapper: z.enum(['try-catch', 'async-function', 'function', 'iife']),
          name: z.string().optional(),
        }),
        execute(input) {
          const name = input.name || 'myFunction';
          const indent = (code: string) => code.split('\n').map(l => '  ' + l).join('\n');
          switch (input.wrapper) {
            case 'try-catch': return `try {\n${indent(input.code)}\n} catch (error) {\n  console.error('Error:', error);\n  throw error;\n}`;
            case 'async-function': return `async function ${name}() {\n  try {\n${indent(indent(input.code))}\n  } catch (error) {\n    console.error('${name} error:', error);\n    throw error;\n  }\n}`;
            case 'function': return `function ${name}() {\n${indent(input.code)}\n}`;
            case 'iife': return `(async () => {\n${indent(input.code)}\n})();`;
            default: return input.code;
          }
        },
      }),

      minifyJson: createRorkTool({
        description: 'Minifiziert JSON',
        zodSchema: z.object({ json: z.string(), mode: z.enum(['minify', 'pretty']).optional() }),
        execute(input) {
          try {
            const parsed = JSON.parse(input.json);
            if (input.mode === 'pretty') return JSON.stringify(parsed, null, 2);
            const minified = JSON.stringify(parsed);
            return `${minified}\n(${input.json.length - minified.length} Bytes gespart)`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_status: createRorkTool({
        description: 'Prüft den GitHub-Verbindungsstatus.',
        zodSchema: z.object({}),
        async execute() {
          try {
            const token = getStoredToken();
            if (!token) return 'GitHub: Nicht verbunden. Bitte mit github_auth authentifizieren.';
            const user = getStoredUser();
            const valid = await checkTokenValidity();
            const active = getActiveRepo();
            let result = `GitHub: ${valid ? 'Verbunden ✅' : 'Token ungültig ❌'}`;
            if (user) result += `\nUser: ${user.login}`;
            if (active) result += `\nAktives Repo: ${active.owner}/${active.repo}`;
            return result;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_auth: createRorkTool({
        description: 'Authentifiziert mit GitHub über einen Personal Access Token.',
        zodSchema: z.object({ token: z.string().describe('GitHub PAT mit repo Scope') }),
        async execute(input) {
          try {
            const success = await storeToken(input.token);
            if (success) { const user = getStoredUser(); return `GitHub Auth erfolgreich als: ${user?.login || 'Unbekannt'}`; }
            return 'Auth fehlgeschlagen.';
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
            if (!result.repos || result.repos.length === 0) return 'Keine Repos.';
            return result.repos.slice(0, 30).map(r => `${r.fullName} (${r.private ? 'privat' : 'öffentlich'})`).join('\n');
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
            return `Repo erstellt: ${result.repo?.fullName}\nURL: ${result.repo?.htmlUrl}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_pushProject: createRorkTool({
        description: 'Pusht ALLE Dateien des aktuellen Projekts in ein GitHub-Repository.',
        zodSchema: z.object({
          owner: z.string(), repo: z.string(),
          commitMessage: z.string().optional(), branch: z.string().optional(),
        }),
        async execute(input) {
          try {
            const project = storageRef.current.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const files = project.files.filter(f => f.type === 'file');
            if (files.length === 0) return 'Keine Dateien.';
            const result = await pushMultipleFiles(input.owner, input.repo, files.map(f => ({ path: f.path, content: f.content })), input.commitMessage || 'Update from SecondAgent', input.branch || 'main');
            return `Push: ${result.totalOk} OK, ${result.totalFailed} failed → ${input.owner}/${input.repo}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_getRepoContents: createRorkTool({
        description: 'Listet den Inhalt eines GitHub-Repos.',
        zodSchema: z.object({ owner: z.string(), repo: z.string(), path: z.string().optional() }),
        async execute(input) {
          try {
            const result = await getRepoContents(input.owner, input.repo, input.path || '');
            if (result.error) return `Fehler: ${result.error}`;
            if (!result.files) return 'Leer.';
            return result.files.map(f => `${f.type === 'dir' ? '[Dir]' : '[File]'} ${f.name}`).join('\n');
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_commitFile: createRorkTool({
        description: 'Commitet eine einzelne Datei.',
        zodSchema: z.object({
          owner: z.string(), repo: z.string(), path: z.string(),
          content: z.string(), commitMessage: z.string().optional(), branch: z.string().optional(),
        }),
        async execute(input) {
          try {
            const result = await pushMultipleFiles(input.owner, input.repo, [{ path: input.path, content: input.content }], input.commitMessage || `Update ${input.path}`, input.branch || 'main');
            return result.totalOk > 0 ? `Commit: ${input.path}` : `Fehler: ${result.results[0]?.error}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_deleteRepo: createRorkTool({
        description: 'Löscht ein GitHub-Repository.',
        zodSchema: z.object({ owner: z.string(), repo: z.string() }),
        async execute(input) {
          try { const r = await deleteRepo(input.owner, input.repo); return r.ok ? `${input.owner}/${input.repo} gelöscht.` : `Fehler: ${r.error}`; }
          catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_logout: createRorkTool({
        description: 'Entfernt den GitHub-Token.',
        zodSchema: z.object({}),
        execute() { try { clearToken(); return 'GitHub-Token entfernt.'; } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; } },
      }),

      terminalExec: createRorkTool({
        description: 'Führt einen echten Terminal-Befehl auf den Projektdateien aus (ls, cat, grep, curl, eval, tree, etc.).',
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
            const profile = input.profile || 'development';
            s.updateProject(project.id, { status: 'building' });
            let status = `🚀 DEPLOY: ${project.name}\nPlattform: ${platform} | Profil: ${profile}\nDateien: ${project.files.length}\n`;
            try {
              const { triggerEasBuild } = await import('@/utils/easBuild');
              const r = await triggerEasBuild({ platform, profile, autoSubmit: false });
              status += r.message;
            } catch { status += 'Build manuell: eas build --platform ' + platform + ' --profile ' + profile; }
            return status;
          } catch (e) { return `Deploy-Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),
    },
  });

  const sendWithServerRetry = useCallback(async (...args: Parameters<typeof agent.sendMessage>): Promise<void> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= SERVER_ERROR_RETRY_MAX; attempt++) {
      try {
        serverErrorRetryCount.current = attempt;
        if (attempt > 0) {
          const delay = SERVER_ERROR_RETRY_DELAY_BASE * Math.pow(1.5, attempt - 1);
          console.log(`[SecondAgent] Retry attempt ${attempt}/${SERVER_ERROR_RETRY_MAX} after ${Math.round(delay)}ms...`);
          resetCircuitBreaker();
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return agent.sendMessage(...args);
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        const isServerError = msg.toLowerCase().includes('internal server error') ||
          msg.toLowerCase().includes('500') || msg.toLowerCase().includes('502') ||
          msg.toLowerCase().includes('503') || msg.toLowerCase().includes('bad gateway') ||
          msg.toLowerCase().includes('service unavailable');

        if (!isServerError || attempt >= SERVER_ERROR_RETRY_MAX) {
          console.error('[SecondAgent] Fatal send error:', msg);
          throw e;
        }

        console.warn(`[SecondAgent] Server error on attempt ${attempt}: ${msg}. Will retry...`);
        resetCircuitBreaker();
      }
    }
  }, [agent.sendMessage]);

  const wrappedSendMessage = useCallback((...args: Parameters<typeof agent.sendMessage>) => {
    try {
      if (checkForLoop()) {
        console.warn('[SecondAgent] Loop prevented, skipping send');
        return;
      }
      const firstArg = args[0];
      if (agent.messages.length === 0 && typeof firstArg === 'string') {
        const memCtx = buildMemoryContext('secondary');
        if (memCtx) {
          console.log('[SecondAgent] Injecting memory context (' + memCtx.length + ' chars)');
          return sendWithServerRetry(memCtx + firstArg);
        }
      }
      return sendWithServerRetry(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[SecondAgent] wrappedSendMessage error:', msg);
      if (msg.toLowerCase().includes('internal server error') || msg.toLowerCase().includes('500')) {
        resetCircuitBreaker();
      }
      return agent.sendMessage(...args);
    }
  }, [agent.messages.length, agent.sendMessage, checkForLoop, sendWithServerRetry]);

  return {
    ...agent,
    sendMessage: wrappedSendMessage,
    saveWorkingMemory,
    getWorkingMemory,
    saveTaskState,
  };
}
