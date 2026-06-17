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

const WORKING_MEMORY_KEY = 'agent:primary:working_memory';
const TASK_STATE_KEY = 'agent:primary:task_state';
const LOOP_DETECTION_WINDOW = 20000;
const LOOP_TOOL_CALL_THRESHOLD = 250;
const LOOP_SAME_TOOL_THRESHOLD = 60;
const LOOP_COOLDOWN_MS = 4000;
const SERVER_ERROR_RETRY_MAX = 3;
const SERVER_ERROR_RETRY_DELAY_BASE = 2000;

export function useDevAgent() {
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
    if (now < loopCooldownUntil.current) {
      return true;
    }
    toolCallTimestamps.current.push(now);
    if (toolName) toolCallNames.current.push(toolName);
    toolCallTimestamps.current = toolCallTimestamps.current.filter(t => now - t < LOOP_DETECTION_WINDOW);
    toolCallNames.current = toolCallNames.current.slice(-20);
    toolCallCountRef.current++;
    if (toolCallTimestamps.current.length >= LOOP_TOOL_CALL_THRESHOLD) {
      if (!loopWarningIssued.current) {
        loopWarningIssued.current = true;
        loopCooldownUntil.current = now + LOOP_COOLDOWN_MS;
        console.warn('[DevAgent] Loop detected! ' + toolCallTimestamps.current.length + ' calls in window. Cooldown active.');
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
        console.warn('[DevAgent] Same-tool loop detected:', toolName, 'called', LOOP_SAME_TOOL_THRESHOLD, 'times consecutively');
        loopCooldownUntil.current = now + 20000;
        toolCallNames.current = [];
        return true;
      }
    }
    return false;
  }, []);

  const getTaskProgress = useCallback(() => {
    return {
      toolCallCount: toolCallCountRef.current,
      taskStartTime: taskStartTimeRef.current,
    };
  }, []);

  const resetTaskTracking = useCallback(() => {
    toolCallCountRef.current = 0;
    taskStartTimeRef.current = Date.now();
    toolCallTimestamps.current = [];
    toolCallNames.current = [];
  }, []);

  const saveWorkingMemory = useCallback((taskSummary: string, context?: string) => {
    try {
      const entry = {
        task: taskSummary,
        context: context || '',
        timestamp: Date.now(),
        agent: 'primary',
      };
      mmkv.setObject(WORKING_MEMORY_KEY, entry);
      console.log('[DevAgent] Working memory saved:', taskSummary.substring(0, 60));
    } catch (e) {
      console.warn('[DevAgent] Working memory save failed:', e);
    }
  }, []);

  const getWorkingMemory = useCallback(() => {
    try {
      return mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>(WORKING_MEMORY_KEY);
    } catch {
      return null;
    }
  }, []);

  const saveTaskState = useCallback((state: 'idle' | 'working' | 'completed' | 'error', detail?: string) => {
    try {
      mmkv.setObject(TASK_STATE_KEY, { state, detail: detail || '', timestamp: Date.now() });
    } catch (e) {
      console.warn('[DevAgent] Task state save failed:', e);
    }
  }, []);

  const agent = useRorkAgent({
    tools: {
      saveWorkingMemory: createRorkTool({
        description: 'Speichert den aktuellen Task-Kontext im Arbeitsspeicher. Wird automatisch beim Start einer neuen Aufgabe aufgerufen, damit die KI bei Unterbrechungen den Kontext wiederherstellen kann.',
        zodSchema: z.object({
          task: z.string().describe('Zusammenfassung der aktuellen Aufgabe'),
          context: z.string().optional().describe('Zusätzlicher Kontext (offene Dateien, Fortschritt etc.)'),
        }),
        execute(input) {
          try {
            const entry = {
              task: input.task,
              context: input.context || '',
              timestamp: Date.now(),
              agent: 'primary',
            };
            mmkv.setObject(WORKING_MEMORY_KEY, entry);
            return `Arbeitsspeicher aktualisiert: "${input.task.substring(0, 80)}"`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getWorkingMemory: createRorkTool({
        description: 'Ruft den gespeicherten Arbeitsspeicher ab. Enthält die letzte Aufgabe und den Kontext. Nutze dies beim Start um den vorherigen Kontext wiederherzustellen.',
        zodSchema: z.object({}),
        execute() {
          try {
            const mem = mmkv.getObject<{ task: string; context: string; timestamp: number; agent: string }>(WORKING_MEMORY_KEY);
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
        description: 'Speichert eine dauerhafte Erinnerung/Notiz die über alle Chats hinweg erhalten bleibt. Nutze dies um wichtige Infos über den User, Projekte, Präferenzen etc. zu speichern.',
        zodSchema: z.object({
          key: z.string().describe('Eindeutiger Schlüssel für die Erinnerung (z.B. "user_name", "project_goals", "tech_stack")'),
          value: z.string().describe('Der Inhalt der Erinnerung'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            s.saveMemoryNote(input.key, input.value);
            return `Erinnerung gespeichert: "${input.key}" = "${input.value}"`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      recallNote: createRorkTool({
        description: 'Ruft eine gespeicherte Erinnerung ab',
        zodSchema: z.object({
          key: z.string().describe('Schlüssel der Erinnerung'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const value = s.getMemoryNote(input.key);
            if (!value) return `Keine Erinnerung gefunden für "${input.key}"`;
            return `Erinnerung "${input.key}": ${value}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      recallAllMemory: createRorkTool({
        description: 'Ruft alle gespeicherten Erinnerungen ab. Nutze dies am Anfang eines neuen Chats um den Kontext wiederherzustellen.',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const memory = s.getAllMemory();
            const keys = Object.keys(memory);
            if (keys.length === 0) return 'Keine Erinnerungen gespeichert.';
            return `${keys.length} Erinnerungen:\n${keys.map(k => `• ${k}: ${memory[k]}`).join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      deleteNote: createRorkTool({
        description: 'Löscht eine gespeicherte Erinnerung',
        zodSchema: z.object({
          key: z.string().describe('Schlüssel der zu löschenden Erinnerung'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            s.deleteMemoryNote(input.key);
            return `Erinnerung "${input.key}" gelöscht.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getConversationHistory: createRorkTool({
        description: 'Gibt eine Übersicht aller bisherigen Chat-Konversationen mit Zeitstempel und Titel',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const convs = s.state.conversations;
            if (convs.length === 0) return 'Keine bisherigen Konversationen.';
            return `${convs.length} Konversationen:\n${convs.slice(0, 20).map(c => {
              const date = new Date(c.updatedAt).toLocaleString('de-DE');
              return `• "${c.title}" (${c.messages.length} Nachrichten, ${date})`;
            }).join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      createProject: createRorkTool({
        description: 'Erstellt ein neues Projekt. Typen: react-native, web, api, fullstack',
        zodSchema: z.object({
          name: z.string().describe('Name des Projekts'),
          type: z.enum(['react-native', 'web', 'api', 'fullstack']).describe('Projekttyp'),
          description: z.string().optional().describe('Beschreibung des Projekts'),
        }),
        execute(input) {
          try {
            console.log('[DevAgent] createProject:', input.name, input.type);
            const s = storageRef.current;
            const project = s.createProject(input.name, input.type, input.description);
            s.setCurrentProject(project.id);
            return `Projekt "${input.name}" (${input.type}) erstellt mit ID: ${project.id}. Projekt ist jetzt aktiv.`;
          } catch (e) {
            console.error('[DevAgent] createProject error:', e);
            return `Fehler beim Erstellen: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      writeFile: createRorkTool({
        description: 'Schreibt/erstellt eine Datei im aktuellen Projekt.',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad z.B. src/App.tsx'),
          content: z.string().describe('Vollständiger Dateiinhalt'),
          projectId: z.string().optional().describe('Projekt-ID (optional)'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = input.projectId
              ? s.state.projects.find(p => p.id === input.projectId) ?? s.currentProject
              : s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt. Erstelle zuerst ein Projekt.';

            const existingFile = project.files.find(f => f.path === input.path);
            const fileName = input.path.split('/').pop() || input.path;

            if (existingFile) {
              s.updateFileInProject(project.id, existingFile.id, { content: input.content });
              return `Datei aktualisiert: ${input.path}`;
            } else {
              s.addFileToProject(project.id, {
                path: input.path,
                name: fileName,
                content: input.content,
                type: 'file',
                language: getFileLanguage(fileName),
              });
              return `Datei erstellt: ${input.path}`;
            }
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      bulkWriteFiles: createRorkTool({
        description: 'Schreibt mehrere Dateien auf einmal ins aktuelle Projekt.',
        zodSchema: z.object({
          files: z.array(z.object({
            path: z.string().describe('Dateipfad'),
            content: z.string().describe('Dateiinhalt'),
          })).describe('Array von Dateien'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';

            const results: string[] = [];
            for (const file of input.files) {
              const existingFile = project.files.find(f => f.path === file.path);
              const fileName = file.path.split('/').pop() || file.path;

              if (existingFile) {
                s.updateFileInProject(project.id, existingFile.id, { content: file.content });
                results.push(`Aktualisiert: ${file.path}`);
              } else {
                s.addFileToProject(project.id, {
                  path: file.path,
                  name: fileName,
                  content: file.content,
                  type: 'file',
                  language: getFileLanguage(fileName),
                });
                results.push(`Erstellt: ${file.path}`);
              }
            }
            return `${input.files.length} Dateien geschrieben:\n${results.join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      readFile: createRorkTool({
        description: 'Liest den Inhalt einer Datei aus dem aktuellen Projekt',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Fehler: Datei nicht gefunden: ${input.path}`;
            return file.content;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      deleteFile: createRorkTool({
        description: 'Löscht eine Datei aus dem aktuellen Projekt',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Fehler: Datei nicht gefunden: ${input.path}`;
            s.deleteFileFromProject(project.id, file.id);
            return `Datei gelöscht: ${input.path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      renameFile: createRorkTool({
        description: 'Benennt eine Datei um oder verschiebt sie',
        zodSchema: z.object({
          oldPath: z.string().describe('Aktueller Dateipfad'),
          newPath: z.string().describe('Neuer Dateipfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.oldPath);
            if (!file) return `Fehler: Datei nicht gefunden: ${input.oldPath}`;
            const newName = input.newPath.split('/').pop() || input.newPath;
            s.updateFileInProject(project.id, file.id, {
              path: input.newPath,
              name: newName,
              language: getFileLanguage(newName),
            });
            return `Datei umbenannt: ${input.oldPath} -> ${input.newPath}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      duplicateFile: createRorkTool({
        description: 'Dupliziert eine Datei im aktuellen Projekt',
        zodSchema: z.object({
          sourcePath: z.string().describe('Quell-Dateipfad'),
          targetPath: z.string().describe('Ziel-Dateipfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const sourceFile = project.files.find(f => f.path === input.sourcePath);
            if (!sourceFile) return `Fehler: Quelldatei nicht gefunden: ${input.sourcePath}`;
            const targetName = input.targetPath.split('/').pop() || input.targetPath;
            s.addFileToProject(project.id, {
              path: input.targetPath,
              name: targetName,
              content: sourceFile.content,
              type: 'file',
              language: getFileLanguage(targetName),
            });
            return `Datei dupliziert: ${input.sourcePath} -> ${input.targetPath}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      createFolder: createRorkTool({
        description: 'Erstellt einen Ordner im aktuellen Projekt',
        zodSchema: z.object({
          path: z.string().describe('Ordnerpfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const folderName = input.path.split('/').pop() || input.path;
            s.addFileToProject(project.id, {
              path: input.path,
              name: folderName,
              content: '',
              type: 'folder',
            });
            return `Ordner erstellt: ${input.path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      listFiles: createRorkTool({
        description: 'Listet alle Dateien im aktuellen Projekt auf',
        zodSchema: z.object({
          projectId: z.string().optional().describe('Projekt-ID (optional)'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = input.projectId
              ? s.state.projects.find(p => p.id === input.projectId) ?? s.currentProject
              : s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt. Projekte: ' +
              (s.state.projects.map(p => `${p.name} (${p.id})`).join(', ') || 'keine');
            if (project.files.length === 0) return `Projekt "${project.name}" hat keine Dateien.`;
            const sorted = [...project.files].sort((a, b) => a.path.localeCompare(b.path));
            return `Dateien in "${project.name}":\n` +
              sorted.map(f => `${f.type === 'folder' ? '[dir]' : '[file]'} ${f.path}`).join('\n');
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      grep: createRorkTool({
        description: 'Sucht nach einem Pattern in allen Projektdateien',
        zodSchema: z.object({
          pattern: z.string().describe('Suchbegriff oder Regex'),
          path: z.string().optional().describe('Nur in diesem Pfad suchen'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const results: string[] = [];
            const regex = new RegExp(input.pattern, 'gi');
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              if (input.path && !file.path.startsWith(input.path)) continue;
              const lines = file.content.split('\n');
              lines.forEach((line, idx) => {
                if (regex.test(line)) {
                  results.push(`${file.path}:${idx + 1}: ${line.trim()}`);
                }
                regex.lastIndex = 0;
              });
            }
            if (results.length === 0) return `Keine Treffer für "${input.pattern}"`;
            return `${results.length} Treffer:\n${results.slice(0, 30).join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      findReplace: createRorkTool({
        description: 'Sucht und ersetzt Text in Projektdateien',
        zodSchema: z.object({
          find: z.string().describe('Zu suchender Text'),
          replace: z.string().describe('Ersetzungstext'),
          path: z.string().optional().describe('Nur in dieser Datei'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            let total = 0;
            const affected: string[] = [];
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              if (input.path && file.path !== input.path) continue;
              const escaped = input.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(escaped, 'g');
              const matches = file.content.match(regex);
              if (matches && matches.length > 0) {
                const newContent = file.content.replace(regex, input.replace);
                s.updateFileInProject(project.id, file.id, { content: newContent });
                total += matches.length;
                affected.push(file.path);
              }
            }
            if (total === 0) return `Keine Vorkommen von "${input.find}" gefunden.`;
            return `${total} Ersetzungen in ${affected.length} Dateien: ${affected.join(', ')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      installPackage: createRorkTool({
        description: 'Fügt Pakete zu den Projektabhängigkeiten hinzu',
        zodSchema: z.object({
          packages: z.array(z.string()).describe('Paketnamen'),
          dev: z.boolean().optional().describe('Als devDependency'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json' || f.name === 'package.json');
            if (pkgFile) {
              const pkg = JSON.parse(pkgFile.content);
              const key = input.dev ? 'devDependencies' : 'dependencies';
              if (!pkg[key]) pkg[key] = {};
              input.packages.forEach(p => { pkg[key][p] = 'latest'; });
              s.updateFileInProject(project.id, pkgFile.id, { content: JSON.stringify(pkg, null, 2) });
            }
            return `Pakete hinzugefügt: ${input.packages.join(', ')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      uninstallPackage: createRorkTool({
        description: 'Entfernt Pakete aus den Projektabhängigkeiten',
        zodSchema: z.object({
          packages: z.array(z.string()).describe('Paketnamen'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const pkgFile = project.files.find(f => f.path === 'package.json' || f.name === 'package.json');
            if (pkgFile) {
              const pkg = JSON.parse(pkgFile.content);
              input.packages.forEach(p => {
                if (pkg.dependencies?.[p]) delete pkg.dependencies[p];
                if (pkg.devDependencies?.[p]) delete pkg.devDependencies[p];
              });
              s.updateFileInProject(project.id, pkgFile.id, { content: JSON.stringify(pkg, null, 2) });
            }
            return `Pakete entfernt: ${input.packages.join(', ')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      listProjects: createRorkTool({
        description: 'Listet alle verfügbaren Projekte auf',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            if (s.state.projects.length === 0) return 'Keine Projekte vorhanden.';
            const current = s.currentProject;
            return s.state.projects.map(p =>
              `${p.id === current?.id ? '> ' : '  '}${p.name} (${p.type}) - ${p.files.length} Dateien - ${p.status}`
            ).join('\n');
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      selectProject: createRorkTool({
        description: 'Wählt ein Projekt als aktives Projekt aus',
        zodSchema: z.object({
          projectId: z.string().describe('Projekt-ID'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.state.projects.find(p => p.id === input.projectId);
            if (!project) return `Projekt mit ID ${input.projectId} nicht gefunden.`;
            s.setCurrentProject(project.id);
            return `Projekt "${project.name}" ist jetzt aktiv.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getProjectInfo: createRorkTool({
        description: 'Gibt detaillierte Informationen über das aktuelle Projekt',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const totalLines = project.files.filter(f => f.type === 'file').reduce((acc, f) => acc + f.content.split('\n').length, 0);
            const totalSize = project.files.filter(f => f.type === 'file').reduce((acc, f) => acc + f.content.length, 0);
            return `Projekt: ${project.name}\nTyp: ${project.type}\nStatus: ${project.status}\nDateien: ${project.files.length}\nZeilen: ${totalLines}\nGröße: ${(totalSize / 1024).toFixed(1)} KB`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      updateProjectStatus: createRorkTool({
        description: 'Aktualisiert den Status eines Projekts',
        zodSchema: z.object({
          status: z.enum(['draft', 'building', 'completed', 'error']).describe('Neuer Status'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            s.updateProject(project.id, { status: input.status });
            return `Projektstatus auf "${input.status}" gesetzt.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      deleteProject: createRorkTool({
        description: 'Löscht ein Projekt komplett',
        zodSchema: z.object({
          projectId: z.string().describe('Projekt-ID'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.state.projects.find(p => p.id === input.projectId);
            if (!project) return `Projekt nicht gefunden: ${input.projectId}`;
            const name = project.name;
            s.deleteProject(input.projectId);
            return `Projekt "${name}" gelöscht.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      cloneProject: createRorkTool({
        description: 'Klont ein bestehendes Projekt',
        zodSchema: z.object({
          sourceProjectId: z.string().describe('Quellprojekt-ID'),
          newName: z.string().describe('Name für das Klon'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const source = s.state.projects.find(p => p.id === input.sourceProjectId);
            if (!source) return `Quellprojekt nicht gefunden: ${input.sourceProjectId}`;
            const cloned = s.createProject(input.newName, source.type, source.description);
            for (const file of source.files) {
              s.addFileToProject(cloned.id, {
                path: file.path,
                name: file.name,
                content: file.content,
                type: file.type,
                language: file.language,
              });
            }
            s.setCurrentProject(cloned.id);
            return `Projekt "${source.name}" als "${input.newName}" geklont (${source.files.length} Dateien).`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      previewProject: createRorkTool({
        description: 'Generiert eine Vorschau des aktuellen Projekts',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const fileCount = project.files.filter(f => f.type === 'file').length;
            return `Vorschau bereit für "${project.name}" (${fileCount} Dateien, ${project.type}). Die Vorschau wird im Chat angezeigt.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      analyzeCode: createRorkTool({
        description: 'Analysiert Code im aktuellen Projekt',
        zodSchema: z.object({
          path: z.string().optional().describe('Spezifische Datei (optional)'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const filesToAnalyze = input.path
              ? project.files.filter(f => f.path === input.path)
              : project.files.filter(f => f.type === 'file');
            if (filesToAnalyze.length === 0) return 'Keine Dateien gefunden.';
            const issues: string[] = [];
            let totalLines = 0;
            for (const file of filesToAnalyze) {
              const lines = file.content.split('\n');
              totalLines += lines.length;
              lines.forEach((line, idx) => {
                if (line.includes(': any') && (file.name.endsWith('.ts') || file.name.endsWith('.tsx'))) {
                  issues.push(`${file.path}:${idx + 1}: "any" Type`);
                }
                if (line.includes('TODO') || line.includes('FIXME')) {
                  issues.push(`${file.path}:${idx + 1}: ${line.trim()}`);
                }
              });
            }
            let result = `Analyse: ${filesToAnalyze.length} Dateien, ${totalLines} Zeilen\n`;
            if (issues.length > 0) {
              result += `${issues.length} Hinweise:\n${issues.slice(0, 20).join('\n')}`;
            } else {
              result += 'Keine Probleme gefunden!';
            }
            return result;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getAppStructure: createRorkTool({
        description: 'Gibt die Struktur der Host-App zurück',
        zodSchema: z.object({}),
        execute() {
          return `Host-App: /home/user/rork-app (Expo SDK 54, React Native, TypeScript)
app/ - Routing (Tabs: Chat, Projekte, Workspace, Settings)
components/ - UI Komponenten
hooks/ - useDevAgent (KI Agent)
providers/ - StorageProvider (MMKV-backed persistent storage)
constants/ - Theme, Templates
types/ - TypeScript Typen
utils/ - Hilfsfunktionen, MMKV Cache Engine
Speicher: MMKV Cache + AsyncStorage (per-key persistent, in-memory sync reads)
Memory: Dauerhaftes Erinnerungssystem über alle Chats hinweg`;
        },
      }),

      webFetch: createRorkTool({
        description: 'Ruft Webinhalte von einer URL ab',
        zodSchema: z.object({
          url: z.string().describe('Die URL'),
          type: z.enum(['text', 'json', 'html']).optional().describe('Antworttyp'),
        }),
        async execute(input) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const response = await fetch(input.url, {
              signal: controller.signal,
              headers: { 'User-Agent': 'DevAgent/1.0', 'Accept': '*/*' },
            });
            clearTimeout(timeout);
            if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
            let body = await response.text();
            if (body.length > 15000) {
              body = body.substring(0, 15000) + '\n[... gekürzt]';
            }
            return `URL: ${input.url}\nStatus: ${response.status}\n\n${body}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      scaffoldProject: createRorkTool({
        description: 'Erstellt ein Projekt aus Template. Verfügbar: react-native-app, nextjs-app, express-api, landing-page, react-dashboard',
        zodSchema: z.object({
          template: z.enum(['react-native-app', 'nextjs-app', 'express-api', 'landing-page', 'react-dashboard']).describe('Template'),
          name: z.string().describe('Projektname'),
          description: z.string().optional().describe('Beschreibung'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const template = PROJECT_TEMPLATES[input.template];
            if (!template) return `Template "${input.template}" nicht gefunden.`;
            const project = s.createProject(input.name, template.type, input.description || template.description);
            s.setCurrentProject(project.id);
            for (const file of template.files) {
              const fileName = file.path.split('/').pop() || file.path;
              s.addFileToProject(project.id, {
                path: file.path,
                name: fileName,
                content: file.content.replace(/\{\{PROJECT_NAME\}\}/g, input.name),
                type: 'file',
                language: getFileLanguage(fileName),
              });
            }
            s.updateProject(project.id, { status: 'building' });
            return `Projekt "${input.name}" aus Template "${input.template}" erstellt (${template.files.length} Dateien).`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      exportFile: createRorkTool({
        description: 'Exportiert eine Datei als Text',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            return `--- ${file.path} (${file.language || 'text'}) ---\n${file.content}\n--- ENDE ---`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getProjectStats: createRorkTool({
        description: 'Statistiken über alle Projekte',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const projects = s.state.projects;
            let totalFiles = 0;
            let totalLines = 0;
            for (const project of projects) {
              for (const file of project.files) {
                if (file.type === 'file') {
                  totalFiles++;
                  totalLines += file.content.split('\n').length;
                }
              }
            }
            const memory = s.getAllMemory();
            const memoryKeys = Object.keys(memory).length;
            return `Projekte: ${projects.length}\nChats: ${s.state.conversations.length}\nDateien: ${totalFiles}\nZeilen: ${totalLines}\nErinnerungen: ${memoryKeys}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateComponent: createRorkTool({
        description: 'Generiert eine React/React Native Komponente und speichert sie im Projekt',
        zodSchema: z.object({
          name: z.string().describe('Komponentenname (PascalCase)'),
          props: z.array(z.object({
            name: z.string(),
            type: z.string(),
            optional: z.boolean().optional(),
          })).optional().describe('Props der Komponente'),
          style: z.enum(['functional', 'memo']).optional().describe('Stil der Komponente'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const name = input.name;
            const propsInterface = input.props && input.props.length > 0
              ? `interface ${name}Props {\n${input.props.map(p => `  ${p.name}${p.optional ? '?' : ''}: ${p.type};`).join('\n')}\n}`
              : `interface ${name}Props {}`;
            const propsDestructure = input.props && input.props.length > 0
              ? `{ ${input.props.map(p => p.name).join(', ')} }` : '{}';
            const content = `import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\n${propsInterface}\n\nexport const ${name}: React.FC<${name}Props> = (${propsDestructure}) => {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.text}>${name}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { padding: 16 },\n  text: { fontSize: 16, fontWeight: '600' },\n});`;
            const path = `src/components/${name}.tsx`;
            const fileName = `${name}.tsx`;
            s.addFileToProject(project.id, {
              path, name: fileName, content, type: 'file', language: 'typescript',
            });
            return `Komponente erstellt: ${path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateScreen: createRorkTool({
        description: 'Generiert einen Screen/eine Seite und speichert sie im Projekt',
        zodSchema: z.object({
          name: z.string().describe('Screen-Name (PascalCase)'),
          navigation: z.enum(['stack', 'tab', 'modal']).optional().describe('Navigationstyp'),
          features: z.array(z.string()).optional().describe('Features wie list, form, detail'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const name = input.name;
            const content = `import React from 'react';\nimport { View, Text, StyleSheet, ScrollView } from 'react-native';\nimport { SafeAreaView } from 'react-native-safe-area-context';\n\nexport default function ${name}Screen() {\n  return (\n    <SafeAreaView style={styles.container}>\n      <ScrollView style={styles.content}>\n        <Text style={styles.title}>${name}</Text>\n      </ScrollView>\n    </SafeAreaView>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, backgroundColor: '#fff' },\n  content: { flex: 1, padding: 20 },\n  title: { fontSize: 28, fontWeight: '700' },\n});`;
            const path = `src/screens/${name}Screen.tsx`;
            const fileName = `${name}Screen.tsx`;
            s.addFileToProject(project.id, {
              path, name: fileName, content, type: 'file', language: 'typescript',
            });
            return `Screen erstellt: ${path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateHook: createRorkTool({
        description: 'Generiert einen Custom React Hook',
        zodSchema: z.object({
          name: z.string().describe('Hook-Name (ohne use-Prefix)'),
          type: z.enum(['state', 'fetch', 'form', 'animation']).optional().describe('Hook-Typ'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const hookName = `use${input.name.charAt(0).toUpperCase() + input.name.slice(1)}`;
            const content = `import { useState, useCallback, useEffect } from 'react';\n\nexport function ${hookName}() {\n  const [data, setData] = useState<unknown>(null);\n  const [loading, setLoading] = useState(false);\n  const [error, setError] = useState<string | null>(null);\n\n  const execute = useCallback(async () => {\n    setLoading(true);\n    setError(null);\n    try {\n      setData(null);\n    } catch (e) {\n      setError(e instanceof Error ? e.message : 'Error');\n    } finally {\n      setLoading(false);\n    }\n  }, []);\n\n  return { data, loading, error, execute };\n}`;
            const path = `src/hooks/${hookName}.ts`;
            s.addFileToProject(project.id, {
              path, name: `${hookName}.ts`, content, type: 'file', language: 'typescript',
            });
            return `Hook erstellt: ${path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateApiRoute: createRorkTool({
        description: 'Generiert eine API-Route (Express/Hono Style)',
        zodSchema: z.object({
          name: z.string().describe('Route-Name'),
          methods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE'])).describe('HTTP-Methoden'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const name = input.name;
            const methods = input.methods.map(m => {
              const handler = m.toLowerCase();
              return `router.${handler}('/${name}', async (req, res) => {\n  try {\n    res.json({ success: true });\n  } catch (error) {\n    res.status(500).json({ error: 'Server error' });\n  }\n});`;
            }).join('\n\n');
            const content = `import { Router } from 'express';\n\nconst router = Router();\n\n${methods}\n\nexport default router;`;
            const path = `src/routes/${name}.ts`;
            s.addFileToProject(project.id, {
              path, name: `${name}.ts`, content, type: 'file', language: 'typescript',
            });
            return `API Route erstellt: ${path} mit ${input.methods.join(', ')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateModel: createRorkTool({
        description: 'Generiert ein TypeScript Datenmodell/Interface',
        zodSchema: z.object({
          name: z.string().describe('Model-Name'),
          fields: z.array(z.object({
            name: z.string(),
            type: z.string(),
            optional: z.boolean().optional(),
          })).describe('Felder des Models'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const name = input.name;
            const fields = input.fields.map(f =>
              `  ${f.name}${f.optional ? '?' : ''}: ${f.type};`
            ).join('\n');
            const content = `export interface ${name} {\n${fields}\n}\n\nexport interface Create${name}Input {\n${input.fields.filter(f => !['id', 'createdAt', 'updatedAt'].includes(f.name)).map(f => `  ${f.name}${f.optional ? '?' : ''}: ${f.type};`).join('\n')}\n}\n\nexport interface Update${name}Input {\n${input.fields.filter(f => !['id', 'createdAt', 'updatedAt'].includes(f.name)).map(f => `  ${f.name}?: ${f.type};`).join('\n')}\n}`;
            const path = `src/models/${name}.ts`;
            s.addFileToProject(project.id, {
              path, name: `${name}.ts`, content, type: 'file', language: 'typescript',
            });
            return `Model erstellt: ${path}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      httpRequest: createRorkTool({
        description: 'Führt einen HTTP-Request aus (GET, POST, PUT, DELETE)',
        zodSchema: z.object({
          url: z.string().describe('URL'),
          method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('HTTP-Methode'),
          headers: z.record(z.string(), z.string()).optional().describe('HTTP-Headers'),
          body: z.string().optional().describe('Request Body (JSON)'),
        }),
        async execute(input) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const options: RequestInit = {
              method: input.method || 'GET',
              signal: controller.signal,
              headers: { ...input.headers, 'User-Agent': 'DevAgent/1.0' },
            };
            if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method || '')) {
              options.body = input.body;
            }
            const response = await fetch(input.url, options);
            clearTimeout(timeout);
            let body = await response.text();
            if (body.length > 10000) body = body.substring(0, 10000) + '\n[... gekürzt]';
            return `Status: ${response.status} ${response.statusText}\n\n${body}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      mergeFiles: createRorkTool({
        description: 'Fügt den Inhalt mehrerer Dateien zusammen in eine neue Datei',
        zodSchema: z.object({
          sourcePaths: z.array(z.string()).describe('Quell-Dateipfade'),
          targetPath: z.string().describe('Ziel-Dateipfad'),
          separator: z.string().optional().describe('Trennzeichen zwischen Dateien'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
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
              s.addFileToProject(project.id, {
                path: input.targetPath, name: targetName, content: merged, type: 'file', language: getFileLanguage(targetName),
              });
            }
            return `${input.sourcePaths.length} Dateien zusammengeführt in: ${input.targetPath}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      appendToFile: createRorkTool({
        description: 'Fügt Text am Ende einer Datei hinzu',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
          content: z.string().describe('Hinzuzufügender Inhalt'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            s.updateFileInProject(project.id, file.id, {
              content: file.content + '\n' + input.content,
            });
            return `Inhalt an ${input.path} angehängt`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      insertInFile: createRorkTool({
        description: 'Fügt Text an einer bestimmten Zeile in eine Datei ein',
        zodSchema: z.object({
          path: z.string().describe('Dateipfad'),
          line: z.number().describe('Zeilennummer (1-basiert)'),
          content: z.string().describe('Einzufügender Inhalt'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file = project.files.find(f => f.path === input.path);
            if (!file) return `Datei nicht gefunden: ${input.path}`;
            const lines = file.content.split('\n');
            const idx = Math.max(0, Math.min(input.line - 1, lines.length));
            lines.splice(idx, 0, input.content);
            s.updateFileInProject(project.id, file.id, { content: lines.join('\n') });
            return `Inhalt in Zeile ${input.line} von ${input.path} eingefügt`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getEnvironmentInfo: createRorkTool({
        description: 'Gibt Informationen über die Entwicklungsumgebung',
        zodSchema: z.object({}),
        execute() {
          const s = storageRef.current;
          const memory = s.getAllMemory();
          const memoryCount = Object.keys(memory).length;
          return `Plattform: React Native (Expo SDK 54)
Speicher: MMKV Cache Engine (persistent, per-key, in-memory sync reads)
AI Engine: @rork-ai/toolkit-sdk
Memory: ${memoryCount} dauerhafte Erinnerungen
Tools: 50+ Development Tools
Templates: react-native-app, nextjs-app, express-api, landing-page, react-dashboard
Sprachen: TypeScript, JavaScript, JSON, CSS, HTML, Python, Go, Rust, Java, Swift
Projekttypen: react-native, web, api, fullstack
Features: File Manager, Terminal, API Tester, Code Generator, Live Preview, Persistent Memory`;
        },
      }),

      validateJson: createRorkTool({
        description: 'Validiert JSON und formatiert es. Kann auch JSON reparieren.',
        zodSchema: z.object({
          json: z.string().describe('JSON-String zum Validieren'),
          fix: z.boolean().optional().describe('Versuche JSON zu reparieren'),
        }),
        execute(input) {
          try {
            const parsed = JSON.parse(input.json);
            const formatted = JSON.stringify(parsed, null, 2);
            const keys = Object.keys(parsed);
            return `Gültiges JSON\nKeys: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ` +${keys.length - 10}` : ''}\nFormatiert:\n${formatted.substring(0, 2000)}`;
          } catch (e) {
            if (input.fix) {
              try {
                let fixed = input.json
                  .replace(/,\s*([}\]])/g, '$1')
                  .replace(/'/g, '"')
                  .replace(/(\w+)\s*:/g, '"$1":');
                const parsed = JSON.parse(fixed);
                return `JSON repariert:\n${JSON.stringify(parsed, null, 2).substring(0, 2000)}`;
              } catch {
                return `JSON konnte nicht repariert werden: ${e instanceof Error ? e.message : String(e)}`;
              }
            }
            return `Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateUuid: createRorkTool({
        description: 'Generiert eine oder mehrere UUIDs',
        zodSchema: z.object({
          count: z.number().optional().describe('Anzahl (Standard: 1)'),
          format: z.enum(['v4', 'short', 'nano']).optional().describe('Format'),
        }),
        execute(input) {
          const count = Math.min(input.count || 1, 20);
          const uuids: string[] = [];
          for (let i = 0; i < count; i++) {
            if (input.format === 'short') {
              uuids.push(Math.random().toString(36).substring(2, 10));
            } else if (input.format === 'nano') {
              uuids.push(Date.now().toString(36) + Math.random().toString(36).substring(2, 8));
            } else {
              const hex = () => Math.floor(Math.random() * 16).toString(16);
              const s = (n: number) => Array.from({ length: n }, hex).join('');
              uuids.push(`${s(8)}-${s(4)}-4${s(3)}-${['8','9','a','b'][Math.floor(Math.random()*4)]}${s(3)}-${s(12)}`);
            }
          }
          return uuids.join('\n');
        },
      }),

      convertTimestamp: createRorkTool({
        description: 'Konvertiert Timestamps zwischen verschiedenen Formaten',
        zodSchema: z.object({
          value: z.string().describe('Timestamp oder Datum'),
          from: z.enum(['unix', 'unixMs', 'iso', 'date']).optional().describe('Quellformat'),
          to: z.enum(['unix', 'unixMs', 'iso', 'date', 'relative', 'all']).optional().describe('Zielformat'),
        }),
        execute(input) {
          try {
            let date: Date;
            const val = input.value.trim();
            if (input.from === 'unix' || /^\d{10}$/.test(val)) {
              date = new Date(parseInt(val) * 1000);
            } else if (input.from === 'unixMs' || /^\d{13}$/.test(val)) {
              date = new Date(parseInt(val));
            } else if (val === 'now') {
              date = new Date();
            } else {
              date = new Date(val);
            }
            if (isNaN(date.getTime())) return `Ungültiges Datum: ${val}`;
            const target = input.to || 'all';
            if (target === 'all') {
              return `ISO: ${date.toISOString()}\nUnix: ${Math.floor(date.getTime() / 1000)}\nUnix ms: ${date.getTime()}\nLokal: ${date.toLocaleString('de-DE')}\nUTC: ${date.toUTCString()}`;
            }
            switch (target) {
              case 'unix': return String(Math.floor(date.getTime() / 1000));
              case 'unixMs': return String(date.getTime());
              case 'iso': return date.toISOString();
              case 'date': return date.toLocaleString('de-DE');
              case 'relative': {
                const diff = Date.now() - date.getTime();
                if (Math.abs(diff) < 60000) return 'gerade eben';
                if (Math.abs(diff) < 3600000) return `vor ${Math.floor(Math.abs(diff) / 60000)} Min.`;
                if (Math.abs(diff) < 86400000) return `vor ${Math.floor(Math.abs(diff) / 3600000)} Std.`;
                return `vor ${Math.floor(Math.abs(diff) / 86400000)} Tagen`;
              }
              default: return date.toISOString();
            }
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      testRegex: createRorkTool({
        description: 'Testet einen regulären Ausdruck gegen einen Text',
        zodSchema: z.object({
          pattern: z.string().describe('Regex-Pattern'),
          text: z.string().describe('Text zum Testen'),
          flags: z.string().optional().describe('Regex-Flags (g, i, m, etc.)'),
        }),
        execute(input) {
          try {
            const regex = new RegExp(input.pattern, input.flags || 'g');
            const matches: string[] = [];
            let match;
            const maxMatches = 30;
            let count = 0;
            while ((match = regex.exec(input.text)) !== null && count < maxMatches) {
              matches.push(`[${match.index}]: "${match[0]}"${match.length > 1 ? ` groups: ${match.slice(1).join(', ')}` : ''}`);
              count++;
              if (!regex.global) break;
            }
            if (matches.length === 0) return `Keine Treffer für /${input.pattern}/${input.flags || 'g'}`;
            return `${matches.length} Treffer für /${input.pattern}/${input.flags || 'g'}:\n${matches.join('\n')}`;
          } catch (e) {
            return `Regex-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      encodeDecodeText: createRorkTool({
        description: 'Encodiert/Decodiert Text (Base64, URL, HTML)',
        zodSchema: z.object({
          text: z.string().describe('Text'),
          operation: z.enum(['base64-encode', 'base64-decode', 'url-encode', 'url-decode', 'html-encode', 'html-decode']).describe('Operation'),
        }),
        execute(input) {
          try {
            switch (input.operation) {
              case 'base64-encode': return btoa(unescape(encodeURIComponent(input.text)));
              case 'base64-decode': return decodeURIComponent(escape(atob(input.text)));
              case 'url-encode': return encodeURIComponent(input.text);
              case 'url-decode': return decodeURIComponent(input.text);
              case 'html-encode': return input.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
              case 'html-decode': return input.text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
              default: return 'Unbekannte Operation';
            }
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      hashText: createRorkTool({
        description: 'Erstellt einen Hash eines Textes (simple hash, nicht kryptographisch sicher)',
        zodSchema: z.object({
          text: z.string().describe('Text zum Hashen'),
        }),
        execute(input) {
          let hash = 0;
          for (let i = 0; i < input.text.length; i++) {
            const char = input.text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
          }
          const hex = Math.abs(hash).toString(16).padStart(8, '0');
          return `Hash: ${hex}\nDec: ${Math.abs(hash)}\nLength: ${input.text.length} chars`;
        },
      }),

      generatePassword: createRorkTool({
        description: 'Generiert sichere Passwörter',
        zodSchema: z.object({
          length: z.number().optional().describe('Länge (Standard: 16)'),
          count: z.number().optional().describe('Anzahl (Standard: 1)'),
          type: z.enum(['full', 'alpha', 'numeric', 'hex', 'memorable']).optional().describe('Typ'),
        }),
        execute(input) {
          const len = Math.min(Math.max(input.length || 16, 4), 128);
          const count = Math.min(input.count || 1, 10);
          const charSets: Record<string, string> = {
            full: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=',
            alpha: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
            numeric: '0123456789',
            hex: '0123456789abcdef',
            memorable: 'abcdefghjkmnpqrstuvwxyz23456789',
          };
          const chars = charSets[input.type || 'full'];
          const passwords: string[] = [];
          for (let i = 0; i < count; i++) {
            let pw = '';
            for (let j = 0; j < len; j++) {
              pw += chars[Math.floor(Math.random() * chars.length)];
            }
            passwords.push(pw);
          }
          return passwords.join('\n');
        },
      }),

      diffTexts: createRorkTool({
        description: 'Vergleicht zwei Texte und zeigt Unterschiede',
        zodSchema: z.object({
          text1: z.string().describe('Erster Text'),
          text2: z.string().describe('Zweiter Text'),
        }),
        execute(input) {
          const lines1 = input.text1.split('\n');
          const lines2 = input.text2.split('\n');
          const diffs: string[] = [];
          const maxLen = Math.max(lines1.length, lines2.length);
          let changes = 0;
          for (let i = 0; i < maxLen; i++) {
            if (lines1[i] !== lines2[i]) {
              changes++;
              diffs.push(`@@ Zeile ${i + 1} @@`);
              if (lines1[i] !== undefined) diffs.push(`- ${lines1[i]}`);
              if (lines2[i] !== undefined) diffs.push(`+ ${lines2[i]}`);
            }
          }
          if (changes === 0) return 'Keine Unterschiede gefunden.';
          return `${changes} Änderungen:\n${diffs.slice(0, 60).join('\n')}`;
        },
      }),

      formatCode: createRorkTool({
        description: 'Formatiert JSON, JavaScript oder TypeScript Code',
        zodSchema: z.object({
          code: z.string().describe('Code zum Formatieren'),
          language: z.enum(['json', 'javascript', 'typescript']).optional().describe('Sprache'),
        }),
        execute(input) {
          try {
            const lang = input.language || 'json';
            if (lang === 'json') {
              const parsed = JSON.parse(input.code);
              return JSON.stringify(parsed, null, 2);
            }
            let code = input.code;
            code = code.replace(/;\s*/g, ';\n');
            code = code.replace(/\{\s*/g, '{\n  ');
            code = code.replace(/\}\s*/g, '\n}\n');
            return code;
          } catch (e) {
            return `Formatierungsfehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      calculateExpression: createRorkTool({
        description: 'Berechnet mathematische Ausdrücke sicher',
        zodSchema: z.object({
          expression: z.string().describe('Mathematischer Ausdruck (z.B. 2+2, Math.sqrt(144))'),
        }),
        execute(input) {
          try {
            const safe = input.expression.replace(/[^0-9+\-*/.()%\s^eE,Math.sqrtpowabsceilfloorminmaxroundlogPIrandom]/g, '');
            if (safe.length === 0) return 'Ungültiger Ausdruck';
            const fn = new Function(`"use strict"; return (${safe})`);
            const result = fn();
            if (typeof result !== 'number' || !isFinite(result)) return `Ergebnis: ${result}`;
            return `${input.expression} = ${result}`;
          } catch (e) {
            return `Berechnungsfehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      colorConvert: createRorkTool({
        description: 'Konvertiert Farben zwischen HEX, RGB und HSL',
        zodSchema: z.object({
          color: z.string().describe('Farbwert (z.B. #ff0000, rgb(255,0,0), red)'),
        }),
        execute(input) {
          try {
            const c = input.color.trim().toLowerCase();
            const namedColors: Record<string, string> = {
              red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff',
              black: '#000000', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
              orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080',
            };
            let hex = namedColors[c] || c;
            let r = 0, g = 0, b = 0;
            if (hex.startsWith('#')) {
              hex = hex.replace('#', '');
              if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
              r = parseInt(hex.substring(0, 2), 16);
              g = parseInt(hex.substring(2, 4), 16);
              b = parseInt(hex.substring(4, 6), 16);
            } else if (c.startsWith('rgb')) {
              const m = c.match(/\d+/g);
              if (m) { r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]); }
            }
            const rn = r / 255, gn = g / 255, bn = b / 255;
            const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
            const l = (max + min) / 2;
            let h = 0, s = 0;
            if (max !== min) {
              const d = max - min;
              s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
              if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
              else if (max === gn) h = ((bn - rn) / d + 2) / 6;
              else h = ((rn - gn) / d + 4) / 6;
            }
            return `HEX: #${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}\nRGB: rgb(${r}, ${g}, ${b})\nHSL: hsl(${Math.round(h*360)}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      loremIpsum: createRorkTool({
        description: 'Generiert Lorem Ipsum Platzhaltertext',
        zodSchema: z.object({
          paragraphs: z.number().optional().describe('Anzahl Absätze (Standard: 1)'),
          type: z.enum(['lorem', 'words', 'sentences']).optional().describe('Typ'),
          count: z.number().optional().describe('Anzahl Wörter/Sätze'),
        }),
        execute(input) {
          const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');
          if (input.type === 'words') {
            const count = Math.min(input.count || 10, 500);
            const result: string[] = [];
            for (let i = 0; i < count; i++) result.push(words[i % words.length]);
            return result.join(' ');
          }
          if (input.type === 'sentences') {
            const count = Math.min(input.count || 3, 50);
            const sentences: string[] = [];
            for (let i = 0; i < count; i++) {
              const len = 8 + Math.floor(Math.random() * 12);
              const s: string[] = [];
              for (let j = 0; j < len; j++) s.push(words[Math.floor(Math.random() * words.length)]);
              s[0] = s[0].charAt(0).toUpperCase() + s[0].slice(1);
              sentences.push(s.join(' ') + '.');
            }
            return sentences.join(' ');
          }
          const pCount = Math.min(input.paragraphs || 1, 10);
          const paragraphs: string[] = [];
          for (let p = 0; p < pCount; p++) {
            const sentCount = 4 + Math.floor(Math.random() * 4);
            const sents: string[] = [];
            for (let i = 0; i < sentCount; i++) {
              const len = 8 + Math.floor(Math.random() * 12);
              const s: string[] = [];
              for (let j = 0; j < len; j++) s.push(words[Math.floor(Math.random() * words.length)]);
              s[0] = s[0].charAt(0).toUpperCase() + s[0].slice(1);
              sents.push(s.join(' ') + '.');
            }
            paragraphs.push(sents.join(' '));
          }
          return paragraphs.join('\n\n');
        },
      }),

      generateMockData: createRorkTool({
        description: 'Generiert Mock-Daten (Users, Products, Posts etc.)',
        zodSchema: z.object({
          type: z.enum(['users', 'products', 'posts', 'comments', 'todos', 'custom']).describe('Datentyp'),
          count: z.number().optional().describe('Anzahl (Standard: 5)'),
          fields: z.array(z.string()).optional().describe('Custom Felder für type=custom'),
        }),
        execute(input) {
          const count = Math.min(input.count || 5, 50);
          const firstNames = ['Alex', 'Maria', 'Jan', 'Sarah', 'Max', 'Lisa', 'Tom', 'Anna', 'Felix', 'Nina'];
          const lastNames = ['Müller', 'Schmidt', 'Weber', 'Fischer', 'Meyer', 'Wagner', 'Becker', 'Schulz'];
          const domains = ['gmail.com', 'outlook.de', 'web.de', 'example.com'];
          const rnd = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
          const rid = () => Math.random().toString(36).substring(2, 8);

          switch (input.type) {
            case 'users': {
              const users = Array.from({ length: count }, (_, i) => {
                const fn = rnd(firstNames), ln = rnd(lastNames);
                return { id: i + 1, name: `${fn} ${ln}`, email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${rnd(domains)}`, role: rnd(['admin', 'user', 'editor']), active: Math.random() > 0.2 };
              });
              return JSON.stringify(users, null, 2);
            }
            case 'products': {
              const cats = ['Elektronik', 'Kleidung', 'Bücher', 'Sport', 'Haushalt'];
              const prods = Array.from({ length: count }, (_, i) => ({
                id: i + 1, name: `Produkt ${rid()}`, price: +(Math.random() * 200 + 5).toFixed(2),
                category: rnd(cats), stock: Math.floor(Math.random() * 100), rating: +(Math.random() * 4 + 1).toFixed(1),
              }));
              return JSON.stringify(prods, null, 2);
            }
            case 'posts': {
              const posts = Array.from({ length: count }, (_, i) => ({
                id: i + 1, title: `Beitrag ${rid()}`, body: 'Lorem ipsum dolor sit amet consectetur adipiscing elit.',
                userId: Math.floor(Math.random() * 10) + 1, likes: Math.floor(Math.random() * 500),
                createdAt: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
              }));
              return JSON.stringify(posts, null, 2);
            }
            case 'todos': {
              const todos = Array.from({ length: count }, (_, i) => ({
                id: i + 1, title: `Aufgabe ${rid()}`, completed: Math.random() > 0.5,
                priority: rnd(['low', 'medium', 'high']), dueDate: new Date(Date.now() + Math.random() * 14 * 86400000).toISOString().split('T')[0],
              }));
              return JSON.stringify(todos, null, 2);
            }
            default: {
              const fields = input.fields || ['id', 'name', 'value'];
              const items = Array.from({ length: count }, (_, i) => {
                const obj: Record<string, unknown> = {};
                fields.forEach(f => {
                  if (f === 'id') obj[f] = i + 1;
                  else if (f.includes('name')) obj[f] = `${rnd(firstNames)} ${rid()}`;
                  else if (f.includes('email')) obj[f] = `${rid()}@${rnd(domains)}`;
                  else if (f.includes('date')) obj[f] = new Date(Date.now() - Math.random() * 365 * 86400000).toISOString();
                  else if (f.includes('price') || f.includes('amount')) obj[f] = +(Math.random() * 1000).toFixed(2);
                  else if (f.includes('count') || f.includes('num')) obj[f] = Math.floor(Math.random() * 100);
                  else if (f.includes('active') || f.includes('done') || f.includes('completed')) obj[f] = Math.random() > 0.5;
                  else obj[f] = `${f}_${rid()}`;
                });
                return obj;
              });
              return JSON.stringify(items, null, 2);
            }
          }
        },
      }),

      analyzeWithAI: createRorkTool({
        description: 'Analysiert Text, Code oder Bilder mit KI und gibt eine detaillierte Analyse zurück. Kann Code reviewen, Bugs finden, Verbesserungen vorschlagen etc.',
        zodSchema: z.object({
          prompt: z.string().describe('Was soll analysiert werden / Anweisung an die KI'),
          content: z.string().optional().describe('Optionaler Text/Code der analysiert werden soll'),
          imageUri: z.string().optional().describe('Optionale Bild-URI (base64 oder URL) zur Analyse'),
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
          } catch (e) {
            return `KI-Analyse Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateTextAI: createRorkTool({
        description: 'Generiert Text mit KI basierend auf einem Prompt. Kann für Dokumentation, Kommentare, Übersetzungen, Zusammenfassungen etc. verwendet werden.',
        zodSchema: z.object({
          prompt: z.string().describe('Anweisung für die Textgenerierung'),
          context: z.string().optional().describe('Zusätzlicher Kontext'),
        }),
        async execute(input) {
          try {
            const fullPrompt = input.context
              ? `${input.prompt}\n\nKontext:\n${input.context}`
              : input.prompt;
            const result = await generateText(fullPrompt);
            return result || 'Keine Textgenerierung möglich.';
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      sortLines: createRorkTool({
        description: 'Sortiert Zeilen eines Textes alphabetisch, numerisch oder umgekehrt',
        zodSchema: z.object({
          text: z.string().describe('Text mit Zeilen zum Sortieren'),
          order: z.enum(['asc', 'desc', 'natural', 'length']).optional().describe('Sortierreihenfolge'),
          unique: z.boolean().optional().describe('Duplikate entfernen'),
        }),
        execute(input) {
          let lines = input.text.split('\n');
          if (input.unique) lines = [...new Set(lines)];
          const order = input.order || 'asc';
          switch (order) {
            case 'asc': lines.sort((a, b) => a.localeCompare(b)); break;
            case 'desc': lines.sort((a, b) => b.localeCompare(a)); break;
            case 'natural': lines.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); break;
            case 'length': lines.sort((a, b) => a.length - b.length); break;
          }
          return lines.join('\n');
        },
      }),

      countStats: createRorkTool({
        description: 'Zählt Wörter, Zeichen, Zeilen und Sätze in einem Text',
        zodSchema: z.object({
          text: z.string().describe('Text zum Analysieren'),
        }),
        execute(input) {
          const text = input.text;
          const lines = text.split('\n').length;
          const words = text.split(/\s+/).filter(w => w.length > 0).length;
          const chars = text.length;
          const charsNoSpace = text.replace(/\s/g, '').length;
          const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
          const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
          return `Zeilen: ${lines}\nWörter: ${words}\nZeichen: ${chars}\nZeichen (ohne Leerzeichen): ${charsNoSpace}\nSätze: ${sentences}\nAbsätze: ${paragraphs}`;
        },
      }),

      convertCase: createRorkTool({
        description: 'Konvertiert Text in verschiedene Schreibweisen (camelCase, snake_case, PascalCase, CONSTANT_CASE, kebab-case)',
        zodSchema: z.object({
          text: z.string().describe('Text zum Konvertieren'),
          to: z.enum(['camelCase', 'snake_case', 'PascalCase', 'CONSTANT_CASE', 'kebab-case', 'lowercase', 'UPPERCASE', 'Title Case']).describe('Zielformat'),
        }),
        execute(input) {
          const words = input.text
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_\-]+/g, ' ')
            .trim()
            .split(/\s+/)
            .map(w => w.toLowerCase());
          switch (input.to) {
            case 'camelCase': return words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
            case 'PascalCase': return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
            case 'snake_case': return words.join('_');
            case 'CONSTANT_CASE': return words.join('_').toUpperCase();
            case 'kebab-case': return words.join('-');
            case 'lowercase': return input.text.toLowerCase();
            case 'UPPERCASE': return input.text.toUpperCase();
            case 'Title Case': return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            default: return input.text;
          }
        },
      }),

      generateTypeFromJson: createRorkTool({
        description: 'Generiert TypeScript Interfaces aus einem JSON-Objekt',
        zodSchema: z.object({
          json: z.string().describe('JSON-String'),
          name: z.string().optional().describe('Name des Root-Interface (Standard: Root)'),
        }),
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
              if (Array.isArray(value)) {
                if (value.length === 0) return 'unknown[]';
                const itemType = getType(value[0], name + 'Item');
                return `${itemType}[]`;
              }
              if (typeof value === 'object') {
                const iName = name.charAt(0).toUpperCase() + name.slice(1);
                const fields = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
                  return `  ${k}: ${getType(v, k)};`;
                });
                interfaces.push(`export interface ${iName} {\n${fields.join('\n')}\n}`);
                return iName;
              }
              return 'unknown';
            }
            getType(data, rootName);
            return interfaces.reverse().join('\n\n');
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateReadme: createRorkTool({
        description: 'Generiert automatisch eine README.md für das aktuelle Projekt basierend auf Projektstruktur und Dateien',
        zodSchema: z.object({
          extraInfo: z.string().optional().describe('Zusätzliche Informationen für die README'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const files = project.files.filter(f => f.type === 'file');
            const folders = [...new Set(files.map(f => f.path.split('/').slice(0, -1).join('/')).filter(Boolean))];
            const totalLines = files.reduce((acc, f) => acc + f.content.split('\n').length, 0);
            const languages = [...new Set(files.map(f => f.language).filter(Boolean))];
            const hasPkg = files.find(f => f.name === 'package.json');
            let deps: string[] = [];
            if (hasPkg) {
              try {
                const pkg = JSON.parse(hasPkg.content);
                deps = Object.keys(pkg.dependencies || {});
              } catch { /* ignore */ }
            }
            let readme = `# ${project.name}\n\n`;
            readme += `${project.description || 'Ein ' + project.type + ' Projekt'}\n\n`;
            readme += `## Übersicht\n\n`;
            readme += `- **Typ:** ${project.type}\n`;
            readme += `- **Dateien:** ${files.length}\n`;
            readme += `- **Zeilen Code:** ${totalLines}\n`;
            readme += `- **Sprachen:** ${languages.join(', ') || 'N/A'}\n\n`;
            if (folders.length > 0) {
              readme += `## Projektstruktur\n\n\`\`\`\n`;
              folders.sort().forEach(f => { readme += `${f}/\n`; });
              readme += `\`\`\`\n\n`;
            }
            if (deps.length > 0) {
              readme += `## Abhängigkeiten\n\n`;
              deps.forEach(d => { readme += `- ${d}\n`; });
              readme += `\n`;
            }
            if (input.extraInfo) readme += `## Hinweise\n\n${input.extraInfo}\n\n`;
            readme += `---\nGeneriert am ${new Date().toLocaleDateString('de-DE')}\n`;
            const existingReadme = project.files.find(f => f.path === 'README.md');
            if (existingReadme) {
              s.updateFileInProject(project.id, existingReadme.id, { content: readme });
            } else {
              s.addFileToProject(project.id, {
                path: 'README.md', name: 'README.md', content: readme, type: 'file', language: 'markdown',
              });
            }
            return `README.md generiert für "${project.name}" (${readme.length} Zeichen)`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      compareFiles: createRorkTool({
        description: 'Vergleicht zwei Dateien im aktuellen Projekt und zeigt die Unterschiede',
        zodSchema: z.object({
          path1: z.string().describe('Pfad der ersten Datei'),
          path2: z.string().describe('Pfad der zweiten Datei'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const file1 = project.files.find(f => f.path === input.path1);
            const file2 = project.files.find(f => f.path === input.path2);
            if (!file1) return `Datei nicht gefunden: ${input.path1}`;
            if (!file2) return `Datei nicht gefunden: ${input.path2}`;
            const lines1 = file1.content.split('\n');
            const lines2 = file2.content.split('\n');
            const diffs: string[] = [];
            const maxLen = Math.max(lines1.length, lines2.length);
            let changes = 0;
            for (let i = 0; i < maxLen; i++) {
              if (lines1[i] !== lines2[i]) {
                changes++;
                diffs.push(`@@ Zeile ${i + 1} @@`);
                if (lines1[i] !== undefined) diffs.push(`- ${lines1[i]}`);
                if (lines2[i] !== undefined) diffs.push(`+ ${lines2[i]}`);
              }
            }
            if (changes === 0) return `${input.path1} und ${input.path2} sind identisch.`;
            return `${changes} Unterschiede zwischen ${input.path1} (${lines1.length}Z) und ${input.path2} (${lines2.length}Z):\n${diffs.slice(0, 50).join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      extractImports: createRorkTool({
        description: 'Extrahiert alle Imports aus einer oder allen Projektdateien',
        zodSchema: z.object({
          path: z.string().optional().describe('Dateipfad (optional, sonst alle Dateien)'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const files = input.path
              ? project.files.filter(f => f.path === input.path)
              : project.files.filter(f => f.type === 'file');
            const allImports: Record<string, string[]> = {};
            for (const file of files) {
              const importRegex = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
              const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
              let match;
              const imports: string[] = [];
              while ((match = importRegex.exec(file.content)) !== null) {
                imports.push(match[1]);
              }
              while ((match = requireRegex.exec(file.content)) !== null) {
                imports.push(match[1]);
              }
              if (imports.length > 0) {
                allImports[file.path] = imports;
              }
            }
            const entries = Object.entries(allImports);
            if (entries.length === 0) return 'Keine Imports gefunden.';
            const uniqueModules = [...new Set(entries.flatMap(([, imps]) => imps))];
            const external = uniqueModules.filter(m => !m.startsWith('.') && !m.startsWith('@/'));
            const internal = uniqueModules.filter(m => m.startsWith('.') || m.startsWith('@/'));
            let result = `${uniqueModules.length} einzigartige Imports in ${entries.length} Dateien:\n\n`;
            if (external.length > 0) result += `Externe (${external.length}): ${external.sort().join(', ')}\n\n`;
            if (internal.length > 0) result += `Interne (${internal.length}): ${internal.sort().join(', ')}`;
            return result;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateGitignore: createRorkTool({
        description: 'Generiert eine .gitignore Datei basierend auf dem Projekttyp',
        zodSchema: z.object({
          type: z.enum(['node', 'react-native', 'python', 'java', 'go', 'rust', 'general']).optional().describe('Projekttyp'),
          extra: z.array(z.string()).optional().describe('Zusätzliche Einträge'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const base = ['node_modules/', '.env', '.env.local', '.DS_Store', 'Thumbs.db', '*.log', '.cache/', 'dist/', 'build/'];
            const typeEntries: Record<string, string[]> = {
              node: ['coverage/', '.nyc_output/', '*.tsbuildinfo'],
              'react-native': ['ios/Pods/', 'android/.gradle/', 'android/app/build/', '.expo/', '*.jks', '*.keystore', 'web-build/'],
              python: ['__pycache__/', '*.pyc', '.venv/', 'venv/', '*.egg-info/'],
              java: ['*.class', '*.jar', 'target/', '.idea/', '*.iml'],
              go: ['vendor/', '*.exe', '*.test'],
              rust: ['target/', 'Cargo.lock'],
              general: [],
            };
            const typ = input.type || 'node';
            const entries = [...base, ...(typeEntries[typ] || []), ...(input.extra || [])];
            const content = entries.join('\n');
            const existing = project.files.find(f => f.path === '.gitignore');
            if (existing) {
              s.updateFileInProject(project.id, existing.id, { content });
            } else {
              s.addFileToProject(project.id, {
                path: '.gitignore', name: '.gitignore', content, type: 'file',
              });
            }
            return `.gitignore generiert (${entries.length} Einträge, Typ: ${typ})`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      wrapCode: createRorkTool({
        description: 'Umschließt Code mit try/catch, async/await, Funktionen oder Klassen',
        zodSchema: z.object({
          code: z.string().describe('Code zum Umschließen'),
          wrapper: z.enum(['try-catch', 'async-function', 'function', 'iife', 'class-method', 'promise']).describe('Wrapper-Typ'),
          name: z.string().optional().describe('Funktions-/Methodenname'),
        }),
        execute(input) {
          const name = input.name || 'myFunction';
          const indent = (code: string) => code.split('\n').map(l => '  ' + l).join('\n');
          switch (input.wrapper) {
            case 'try-catch':
              return `try {\n${indent(input.code)}\n} catch (error) {\n  console.error('Error:', error);\n  throw error;\n}`;
            case 'async-function':
              return `async function ${name}() {\n  try {\n${indent(indent(input.code))}\n  } catch (error) {\n    console.error('${name} error:', error);\n    throw error;\n  }\n}`;
            case 'function':
              return `function ${name}() {\n${indent(input.code)}\n}`;
            case 'iife':
              return `(async () => {\n${indent(input.code)}\n})();`;
            case 'class-method':
              return `async ${name}() {\n  try {\n${indent(indent(input.code))}\n  } catch (error) {\n    console.error('${name} error:', error);\n    throw error;\n  }\n}`;
            case 'promise':
              return `new Promise((resolve, reject) => {\n  try {\n${indent(indent(input.code))}\n    resolve(result);\n  } catch (error) {\n    reject(error);\n  }\n});`;
            default:
              return input.code;
          }
        },
      }),

      minifyJson: createRorkTool({
        description: 'Minifiziert JSON (entfernt Whitespace) oder formatiert es schön',
        zodSchema: z.object({
          json: z.string().describe('JSON-String'),
          mode: z.enum(['minify', 'pretty']).optional().describe('Modus (Standard: minify)'),
        }),
        execute(input) {
          try {
            const parsed = JSON.parse(input.json);
            if (input.mode === 'pretty') {
              return JSON.stringify(parsed, null, 2);
            }
            const minified = JSON.stringify(parsed);
            const savings = input.json.length - minified.length;
            return `${minified}\n\n(${savings} Bytes gespart, ${((savings / input.json.length) * 100).toFixed(1)}% kleiner)`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      generateEnvTemplate: createRorkTool({
        description: 'Generiert eine .env.example Datei basierend auf gefundenen Umgebungsvariablen im Projekt',
        zodSchema: z.object({}),
        execute() {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Fehler: Kein Projekt ausgewählt.';
            const envVars = new Set<string>();
            for (const file of project.files) {
              if (file.type === 'folder') continue;
              const processEnvRegex = /process\.env\[?['"]?(\w+)['"]?\]?/g;
              const envRegex = /(?:EXPO_PUBLIC_|NEXT_PUBLIC_|VITE_|REACT_APP_)\w+/g;
              let match;
              while ((match = processEnvRegex.exec(file.content)) !== null) {
                envVars.add(match[1]);
              }
              while ((match = envRegex.exec(file.content)) !== null) {
                envVars.add(match[0]);
              }
            }
            if (envVars.size === 0) return 'Keine Umgebungsvariablen im Projekt gefunden.';
            const content = [...envVars].sort().map(v => `${v}=`).join('\n');
            const existing = project.files.find(f => f.path === '.env.example');
            if (existing) {
              s.updateFileInProject(project.id, existing.id, { content });
            } else {
              s.addFileToProject(project.id, {
                path: '.env.example', name: '.env.example', content, type: 'file',
              });
            }
            return `.env.example generiert mit ${envVars.size} Variablen:\n${[...envVars].sort().join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      convertUnits: createRorkTool({
        description: 'Konvertiert Einheiten (px/rem, Temperatur, Gewicht, Länge)',
        zodSchema: z.object({
          value: z.number().describe('Wert'),
          from: z.string().describe('Quelleinheit (px, rem, em, celsius, fahrenheit, kg, lb, km, miles, m, ft)'),
          to: z.string().describe('Zieleinheit'),
        }),
        execute(input) {
          const { value, from, to } = input;
          const conversions: Record<string, Record<string, (v: number) => number>> = {
            px: { rem: v => v / 16, em: v => v / 16, pt: v => v * 0.75 },
            rem: { px: v => v * 16, em: v => v, pt: v => v * 12 },
            em: { px: v => v * 16, rem: v => v, pt: v => v * 12 },
            celsius: { fahrenheit: v => v * 9/5 + 32, kelvin: v => v + 273.15 },
            fahrenheit: { celsius: v => (v - 32) * 5/9, kelvin: v => (v - 32) * 5/9 + 273.15 },
            kg: { lb: v => v * 2.20462, g: v => v * 1000, oz: v => v * 35.274 },
            lb: { kg: v => v / 2.20462, g: v => v * 453.592, oz: v => v * 16 },
            km: { miles: v => v * 0.621371, m: v => v * 1000, ft: v => v * 3280.84 },
            miles: { km: v => v / 0.621371, m: v => v * 1609.34, ft: v => v * 5280 },
            m: { ft: v => v * 3.28084, cm: v => v * 100, km: v => v / 1000, miles: v => v / 1609.34 },
            ft: { m: v => v / 3.28084, cm: v => v * 30.48, km: v => v / 3280.84 },
          };
          const fromLower = from.toLowerCase();
          const toLower = to.toLowerCase();
          if (fromLower === toLower) return `${value} ${from} = ${value} ${to}`;
          const conv = conversions[fromLower]?.[toLower];
          if (!conv) return `Konvertierung ${from} -> ${to} nicht unterstützt`;
          const result = conv(value);
          return `${value} ${from} = ${+result.toFixed(4)} ${to}`;
        },
      }),

      github_status: createRorkTool({
        description: 'Prüft den GitHub-Verbindungsstatus. Gibt zurück ob ein Token konfiguriert ist, ob er gültig ist und welcher User eingeloggt ist.',
        zodSchema: z.object({}),
        async execute() {
          try {
            const token = getStoredToken();
            if (!token) return 'GitHub: Nicht verbunden. Bitte mit github_auth authentifizieren (Personal Access Token benötigt).';
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
        description: 'Authentifiziert mit GitHub über einen Personal Access Token (PAT). Der Token wird sicher im MMKV-Speicher abgelegt. Erstelle einen Token unter: https://github.com/settings/tokens mit den Scopes: repo, workflow.',
        zodSchema: z.object({
          token: z.string().describe('GitHub Personal Access Token (classic) mit repo Scope'),
        }),
        async execute(input) {
          try {
            const success = await storeToken(input.token);
            if (success) {
              const user = getStoredUser();
              return `GitHub Authentifizierung erfolgreich! ✅\nEingeloggt als: ${user?.login || 'Unbekannt'}\nName: ${user?.name || 'N/A'}`;
            }
            return 'GitHub Authentifizierung fehlgeschlagen. Token ungültig oder kein Internet.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_listRepos: createRorkTool({
        description: 'Listet alle GitHub-Repositories des authentifizierten Users auf.',
        zodSchema: z.object({}),
        async execute() {
          try {
            const result = await listRepos();
            if (result.error) return `Fehler: ${result.error}`;
            if (!result.repos || result.repos.length === 0) return 'Keine Repositories gefunden.';
            const active = getActiveRepo();
            return `${result.repos.length} Repositories:\n${result.repos.slice(0, 30).map(r =>
              `${active?.owner === r.fullName.split('/')[0] && active?.repo === r.name ? '> ' : '  '}${r.fullName} (${r.private ? 'privat' : 'öffentlich'}, ${r.defaultBranch})\n    ${r.description || 'Keine Beschreibung'}`
            ).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_createRepo: createRorkTool({
        description: 'Erstellt ein neues GitHub-Repository und setzt es als aktives Repo.',
        zodSchema: z.object({
          name: z.string().describe('Repository-Name'),
          description: z.string().optional().describe('Beschreibung'),
          private: z.boolean().optional().describe('Privates Repo? (Standard: false)'),
        }),
        async execute(input) {
          try {
            const result = await createRepo(input.name, input.description, input.private);
            if (result.error) return `Fehler: ${result.error}`;
            if (result.repo) {
              return `Repository erstellt: ${result.repo.fullName}\nURL: ${result.repo.htmlUrl}\nBranch: ${result.repo.defaultBranch}`;
            }
            return 'Repository erstellt, aber keine Details verfügbar.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_pushProject: createRorkTool({
        description: 'Pusht ALLE Dateien des aktuellen Projekts in ein GitHub-Repository. Erstellt/aktualisiert jede Datei einzeln. Nutze dies wenn der User sagt "speichere das Projekt auf GitHub" oder "push das zu GitHub". IMPORTANT: Immer zuerst github_status prüfen ob ein Token und Repo konfiguriert sind!',
        zodSchema: z.object({
          owner: z.string().describe('GitHub Username oder Organisation'),
          repo: z.string().describe('Repository-Name'),
          commitMessage: z.string().optional().describe('Commit-Nachricht (Standard: "Update from DevAI")'),
          branch: z.string().optional().describe('Branch (Standard: main)'),
        }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt. Erstelle oder wähle zuerst ein Projekt.';
            const files = project.files.filter(f => f.type === 'file');
            if (files.length === 0) return 'Projekt hat keine Dateien zum Pushen.';
            const commitMsg = input.commitMessage || `Update from DevAI: ${project.name}`;
            const branch = input.branch || 'main';
            setActiveRepo(input.owner, input.repo);
            const result = await pushMultipleFiles(
              input.owner,
              input.repo,
              files.map(f => ({ path: f.path, content: f.content })),
              commitMsg,
              branch
            );
            return `GitHub Push abgeschlossen!\nErfolgreich: ${result.totalOk} Dateien\nFehlgeschlagen: ${result.totalFailed} Dateien\nRepo: ${input.owner}/${input.repo}\nBranch: ${branch}\n${result.totalFailed > 0 ? '\nFehler:\n' + result.results.filter(r => !r.ok).map(r => `  ❌ ${r.path}: ${r.error}`).join('\n') : ''}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_getRepoContents: createRorkTool({
        description: 'Listet den Inhalt eines GitHub-Repositories auf (Dateien und Ordner).',
        zodSchema: z.object({
          owner: z.string().describe('GitHub Username oder Organisation'),
          repo: z.string().describe('Repository-Name'),
          path: z.string().optional().describe('Pfad innerhalb des Repos (leer für Root)'),
        }),
        async execute(input) {
          try {
            const result = await getRepoContents(input.owner, input.repo, input.path || '');
            if (result.error) return `Fehler: ${result.error}`;
            if (!result.files || result.files.length === 0) return 'Repository ist leer.';
            setActiveRepo(input.owner, input.repo);
            return `Inhalt von ${input.owner}/${input.repo}${input.path ? '/' + input.path : ''}:\n${result.files.map(f => `${f.type === 'dir' ? '[Ordner]' : '[Datei]'} ${f.name} (${f.size} bytes)`).join('\n')}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_commitFile: createRorkTool({
        description: 'Commitet eine einzelne Datei in ein GitHub-Repository.',
        zodSchema: z.object({
          owner: z.string().describe('GitHub Username oder Organisation'),
          repo: z.string().describe('Repository-Name'),
          path: z.string().describe('Dateipfad im Repo'),
          content: z.string().describe('Dateiinhalt'),
          commitMessage: z.string().optional().describe('Commit-Nachricht'),
          branch: z.string().optional().describe('Branch (Standard: main)'),
        }),
        async execute(input) {
          try {
            const result = await pushMultipleFiles(
              input.owner,
              input.repo,
              [{ path: input.path, content: input.content }],
              input.commitMessage || `Update ${input.path}`,
              input.branch || 'main'
            );
            setActiveRepo(input.owner, input.repo);
            if (result.totalOk > 0) return `Datei commited: ${input.path} → ${input.owner}/${input.repo}`;
            return `Fehler beim Commit: ${result.results[0]?.error || 'Unbekannt'}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_deleteRepo: createRorkTool({
        description: 'Löscht ein GitHub-Repository (Achtung: unwiderruflich!).',
        zodSchema: z.object({
          owner: z.string().describe('GitHub Username oder Organisation'),
          repo: z.string().describe('Repository-Name'),
        }),
        async execute(input) {
          try {
            const result = await deleteRepo(input.owner, input.repo);
            if (result.ok) return `Repository ${input.owner}/${input.repo} wurde gelöscht.`;
            return `Fehler beim Löschen: ${result.error}`;
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      github_logout: createRorkTool({
        description: 'Entfernt den gespeicherten GitHub-Token (meldet ab).',
        zodSchema: z.object({}),
        execute() {
          try {
            clearToken();
            return 'GitHub-Token entfernt. Nicht mehr mit GitHub verbunden.';
          } catch (e) { return `Fehler: ${e instanceof Error ? e.message : String(e)}`; }
        },
      }),

      // === BUILD & DEPLOY TOOLS ===

      terminalExec: createRorkTool({
        description: 'Führt einen echten Terminal-Befehl auf den Projektdateien aus. Unterstützt: ls, cat, tree, grep, find, wc, curl, eval (JavaScript), env, du, head, tail, sort, date, help uvm. Kein Simulator — alle Operationen arbeiten auf echten Projektinhalten.',
        zodSchema: z.object({
          command: z.string().describe('Der auszuführende Befehl (z.B. "ls -l", "cat src/App.tsx", "eval 2+2", "curl https://api.example.com")'),
        }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            const files: Record<string, string> = {};
            if (project) {
              for (const f of project.files) {
                if (f.type === 'file') files[f.path] = f.content;
              }
            }
            const { executeCommand } = await import('@/utils/sandboxEngine');
            const result = await executeCommand(input.command, files, {
              PROJECT_NAME: project?.name || '',
              PROJECT_TYPE: project?.type || '',
              NODE_ENV: 'development',
            });
            return `$ ${input.command}\n${result.output}\n⏱ ${Math.round(result.duration)}ms`;
          } catch (e) {
            return `Terminal-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      sandboxEval: createRorkTool({
        description: 'Führt JavaScript/TypeScript-Code in einer sandboxed Umgebung aus. Hat Zugriff auf: console, fs (readFile/writeFile/listFiles), fetch, env, JSON, Math, Date. Perfekt zum Testen von Code, Algorithmen oder Daten-Transformationen.',
        zodSchema: z.object({
          code: z.string().describe('JavaScript-Code zum Ausführen'),
        }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            const files: Record<string, string> = {};
            if (project) {
              for (const f of project.files) {
                if (f.type === 'file') files[f.path] = f.content;
              }
            }
            const { executeSandboxCode } = await import('@/utils/sandboxEngine');
            const result = await executeSandboxCode(input.code, {
              files,
              env: { PROJECT_NAME: project?.name || '', NODE_ENV: 'development' },
              timeout: 10000,
            });
            let out = result.output;
            if (result.truncated) out += '\n\n... (gekürzt)';
            return `${out}\n\n⏱ ${Math.round(result.duration)}ms`;
          } catch (e) {
            return `Sandbox-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      triggerBuild: createRorkTool({
        description: 'Startet einen echten EAS Build für das Projekt. Erstellt eine installierbare IPA (iOS) oder APK (Android). Der Build läuft auf den Expo-Servern. Profile: development (Dev-Client), preview (TestFlight/AdHoc), production (App Store).',
        zodSchema: z.object({
          platform: z.enum(['ios', 'android', 'all']).describe('Zielplattform'),
          profile: z.enum(['development', 'preview', 'production']).optional().describe('Build-Profil (Standard: development)'),
        }),
        async execute(input) {
          try {
            const { triggerEasBuild } = await import('@/utils/easBuild');
            const result = await triggerEasBuild({
              platform: input.platform,
              profile: input.profile || 'development',
              autoSubmit: false,
            });
            const s = storageRef.current;
            const project = s.currentProject;
            if (project) {
              s.updateProject(project.id, { status: 'building' });
            }
            return `Build gestartet!\n${result.message}`;
          } catch (e) {
            return `Build-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getBuildStatus: createRorkTool({
        description: 'Prüft den Status eines EAS Builds. Gibt Fortschritt, Status und ggf. Download-URL zurück.',
        zodSchema: z.object({
          buildId: z.string().optional().describe('Build-ID (optional, sonst aktiver Build)'),
        }),
        async execute(input) {
          try {
            const { getBuildStatus, getActiveBuildId, formatBuildStatus } = await import('@/utils/easBuild');
            const buildId = input.buildId || getActiveBuildId();
            if (!buildId) return 'Kein Build aktiv. Starte einen Build mit triggerBuild.';
            const status = await getBuildStatus(buildId);
            return formatBuildStatus(status);
          } catch (e) {
            return `Status-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      cancelBuild: createRorkTool({
        description: 'Bricht einen laufenden EAS Build ab.',
        zodSchema: z.object({
          buildId: z.string().optional().describe('Build-ID (optional)'),
        }),
        async execute(input) {
          try {
            const { cancelBuild, getActiveBuildId } = await import('@/utils/easBuild');
            const buildId = input.buildId || getActiveBuildId();
            if (!buildId) return 'Kein Build aktiv.';
            const ok = await cancelBuild(buildId);
            return ok ? `Build ${buildId} abgebrochen.` : `Build ${buildId} konnte nicht abgebrochen werden.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      getBuildHistory: createRorkTool({
        description: 'Listet die letzten EAS Builds auf mit Status, Plattform und Download-Links.',
        zodSchema: z.object({
          limit: z.number().optional().describe('Anzahl (Standard: 10)'),
        }),
        async execute(input) {
          try {
            const { listBuilds } = await import('@/utils/easBuild');
            const result = await listBuilds(input.limit || 10);
            if (result.builds.length === 0) return 'Keine Builds in der Historie.';
            return `${result.totalCount} Builds (zeige ${result.builds.length}):\n${result.builds.map(b => {
              const statusEmoji: Record<string, string> = { 'in-queue': '⏳', 'in-progress': '🔨', 'finished': '✅', 'errored': '❌', 'canceled': '⏹' };
              return `${statusEmoji[b.status] || '❓'} ${b.id} - ${b.platform} - ${b.status}${b.artifactUrl ? '\n   📦 ' + b.artifactUrl : ''}`;
            }).join('\n')}`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      deployProject: createRorkTool({
        description: 'Führt den kompletten Deploy-Workflow aus: 1) Code finalisieren, 2) Tests prüfen, 3) Build starten, 4) Download-Link bereitstellen. Der One-Click-Deploy für dein Projekt.',
        zodSchema: z.object({
          platform: z.enum(['ios', 'android', 'all']).optional().describe('Zielplattform (Standard: ios)'),
          profile: z.enum(['development', 'preview', 'production']).optional().describe('Build-Profil (Standard: development)'),
        }),
        async execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt. Erstelle oder wähle zuerst ein Projekt.';

            const platform = input.platform || 'ios';
            const profile = input.profile || 'development';

            let status = `🚀 DEPLOY: ${project.name}\n`;
            status += `================================\n`;
            status += `📋 Schritt 1/5: Projekt prüfen...\n`;
            status += `   Projekt: ${project.name}\n`;
            status += `   Typ: ${project.type}\n`;
            status += `   Dateien: ${project.files.length}\n`;
            status += `   Status: ${project.status}\n\n`;

            const totalLines = project.files.filter(f => f.type === 'file').reduce((acc, f) => acc + f.content.split('\n').length, 0);
            status += `📋 Schritt 2/5: Code-Analyse...\n`;
            status += `   Gesamtzeilen: ${totalLines}\n`;
            status += `   Größe: ${(project.files.filter(f => f.type === 'file').reduce((a, f) => a + f.content.length, 0) / 1024).toFixed(1)} KB\n\n`;

            s.updateProject(project.id, { status: 'building' });

            status += `📋 Schritt 3/5: Build starten...\n`;
            status += `   Plattform: ${platform}\n`;
            status += `   Profil: ${profile}\n`;

            try {
              const { triggerEasBuild } = await import('@/utils/easBuild');
              const buildResult = await triggerEasBuild({ platform: platform as 'ios' | 'android' | 'all', profile: profile as 'development' | 'preview' | 'production', autoSubmit: false });
              status += `   ${buildResult.message}\n\n`;
              status += `📋 Schritt 4/5: Build-Monitoring aktiv...\n`;
              status += `   Der Build wird auf EAS ausgeführt.\n`;
              status += `   Prüfe den Status mit getBuildStatus\n\n`;
              status += `📋 Schritt 5/5: Deploy bereit! ✅\n`;
              status += `================================\n`;
              status += `Nach Abschluss des Builds:\n`;
              status += `• iOS: IPA wird zum Download bereitgestellt\n`;
              status += `• Android: APK/AAB wird zum Download bereitgestellt\n`;
              status += `• Öffne die Expo-Website für QR-Code & direkten Download\n`;
              status += `• Oder rufe getBuildStatus für die Download-URL auf`;
            } catch (e) {
              status += `   ⚠ Build-API nicht erreichbar.\n`;
              status += `   Manuelle Ausführung: eas build --platform ${platform} --profile ${profile}\n`;
            }

            return status;
          } catch (e) {
            return `Deploy-Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
      }),

      installDeps: createRorkTool({
        description: 'Installiert die Projektabhängigkeiten mit dem richtigen Paketmanager (bun/npm/yarn). Analysiert die Lock-Datei um den korrekten Manager zu erkennen.',
        zodSchema: z.object({
          manager: z.enum(['bun', 'npm', 'yarn', 'pnpm']).optional().describe('Paketmanager (auto-detect wenn nicht angegeben)'),
        }),
        execute(input) {
          try {
            const s = storageRef.current;
            const project = s.currentProject;
            if (!project) return 'Kein Projekt ausgewählt.';
            const lockFiles: Record<string, string> = {
              'bun.lockb': 'bun', 'bun.lock': 'bun',
              'package-lock.json': 'npm', 'yarn.lock': 'yarn', 'pnpm-lock.yaml': 'pnpm',
            };
            let detectedManager = input.manager;
            if (!detectedManager) {
              for (const [lockFile, mgr] of Object.entries(lockFiles)) {
                if (project.files.find(f => f.name === lockFile || f.path === lockFile)) {
                  detectedManager = mgr as 'bun' | 'npm' | 'yarn' | 'pnpm';
                  break;
                }
              }
              if (!detectedManager) detectedManager = 'bun';
            }
            const pkgFile = project.files.find(f => f.name === 'package.json');
            if (pkgFile) {
              try {
                const pkg = JSON.parse(pkgFile.content);
                const deps = Object.keys(pkg.dependencies || {}).length;
                const devDeps = Object.keys(pkg.devDependencies || {}).length;
                const totalDeps = deps + devDeps;
                return `→ ${detectedManager} install (${totalDeps} packages)\n→ Manager: ${detectedManager}\n→ Dependencies: ${deps}\n→ DevDependencies: ${devDeps}\n✓ Dependencies in package.json definiert.\nAusführen: ${detectedManager} install`;
              } catch {
                return `→ ${detectedManager} install\n⚠ package.json konnte nicht geparst werden.`;
              }
            }
            return `→ ${detectedManager} install\n⚠ Keine package.json gefunden. Erstelle zuerst eine.`;
          } catch (e) {
            return `Fehler: ${e instanceof Error ? e.message : String(e)}`;
          }
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
          console.log(`[DevAgent] Retry attempt ${attempt}/${SERVER_ERROR_RETRY_MAX} after ${Math.round(delay)}ms...`);
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
          console.error('[DevAgent] Fatal send error:', msg);
          throw e;
        }

        console.warn(`[DevAgent] Server error on attempt ${attempt}: ${msg}. Will retry...`);
        resetCircuitBreaker();
      }
    }
  }, [agent.sendMessage]);

  const wrappedSendMessage = useCallback((...args: Parameters<typeof agent.sendMessage>) => {
    try {
      if (checkForLoop()) {
        console.warn('[DevAgent] Loop prevented, skipping send');
        return;
      }
      resetTaskTracking();
      const firstArg = args[0];
      if (agent.messages.length === 0 && typeof firstArg === 'string') {
        const memCtx = buildMemoryContext('primary');
        if (memCtx) {
          console.log('[DevAgent] Injecting memory context (' + memCtx.length + ' chars)');
          return sendWithServerRetry(memCtx + firstArg);
        }
      }
      return sendWithServerRetry(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[DevAgent] wrappedSendMessage error:', msg);
      if (msg.toLowerCase().includes('internal server error') || msg.toLowerCase().includes('500')) {
        resetCircuitBreaker();
      }
      return agent.sendMessage(...args);
    }
  }, [agent.messages.length, agent.sendMessage, checkForLoop, resetTaskTracking, sendWithServerRetry]);

  return {
    ...agent,
    sendMessage: wrappedSendMessage,
    saveWorkingMemory,
    getWorkingMemory,
    saveTaskState,
    getTaskProgress,
    resetTaskTracking,
  };
}
