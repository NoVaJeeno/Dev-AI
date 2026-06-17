export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  projectId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  type: 'react-native' | 'web' | 'api' | 'fullstack';
  files: ProjectFile[];
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  status: 'draft' | 'building' | 'completed' | 'error';
}

export interface ProjectFile {
  id: string;
  path: string;
  name: string;
  content: string;
  type: 'file' | 'folder';
  language?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceState {
  currentProjectId: string | null;
  openFiles: string[];
  activeFileId: string | null;
  expandedFolders: string[];
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  autoSave: boolean;
  showLineNumbers: boolean;
  enableHaptics: boolean;
}

export interface AppState {
  conversations: Conversation[];
  projects: Project[];
  workspace: WorkspaceState;
  settings: AppSettings;
  currentConversationId: string | null;
}

export type ToolName = 
  | 'readFile'
  | 'writeFile'
  | 'deleteFile'
  | 'createFolder'
  | 'listFiles'
  | 'grep'
  | 'installPackage'
  | 'runCommand'
  | 'createProject'
  | 'deployProject'
  | 'exportProject'
  | 'renameFile'
  | 'moveFile'
  | 'copyFile'
  | 'editFile'
  | 'findAndReplace'
  | 'getProjectInfo'
  | 'selectProject'
  | 'getFileContent'
  | 'appendToFile'
  | 'prependToFile'
  | 'getProjectStructure'
  | 'createComponent'
  | 'createScreen'
  | 'createService'
  | 'createHook'
  | 'analyzeCode'
  | 'formatCode'
  | 'validateProject'
  | 'getEnvironmentInfo';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
}
