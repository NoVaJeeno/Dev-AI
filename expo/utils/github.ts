import { resilientFetch } from './resilientFetch';
import { mmkv } from './mmkv';

const GITHUB_API_BASE = 'https://api.github.com';

const GITHUB_TOKEN_KEY = 'github:auth_token';
const GITHUB_USER_KEY = 'github:user_info';
const GITHUB_ACTIVE_REPO_KEY = 'github:active_repo';

export interface GitHubUserInfo {
  login: string;
  name: string;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  pushedAt: string;
}

export interface GitHubFile {
  path: string;
  name: string;
  type: 'file' | 'dir';
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = mmkv.getString(GITHUB_TOKEN_KEY);
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'DevAI-GitHub-Integration/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getStoredToken(): string | null {
  try {
    return mmkv.getString(GITHUB_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function getStoredUser(): GitHubUserInfo | null {
  try {
    return mmkv.getObject<GitHubUserInfo>(GITHUB_USER_KEY);
  } catch {
    return null;
  }
}

export function getActiveRepo(): { owner: string; repo: string } | null {
  try {
    return mmkv.getObject<{ owner: string; repo: string }>(GITHUB_ACTIVE_REPO_KEY);
  } catch {
    return null;
  }
}

export async function storeToken(token: string): Promise<boolean> {
  try {
    mmkv.setString(GITHUB_TOKEN_KEY, token);
    const user = await fetchGitHubUser();
    if (user) {
      mmkv.setObject(GITHUB_USER_KEY, user);
    }
    return true;
  } catch {
    return false;
  }
}

export function clearToken(): void {
  try {
    mmkv.delete(GITHUB_TOKEN_KEY);
    mmkv.delete(GITHUB_USER_KEY);
    mmkv.delete(GITHUB_ACTIVE_REPO_KEY);
  } catch {}
}

export function setActiveRepo(owner: string, repo: string): void {
  try {
    mmkv.setObject(GITHUB_ACTIVE_REPO_KEY, { owner, repo });
  } catch {}
}

async function githubApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  const token = getStoredToken();
  if (!token) {
    return { ok: false, error: 'Kein GitHub-Token konfiguriert. Bitte zuerst mit github_auth authentifizieren.' };
  }

  try {
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: getAuthHeaders(),
    };

    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
      (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    const response = await resilientFetch(`${GITHUB_API_BASE}${path}`, {
      ...fetchOptions,
      maxRetries: 3,
      timeout: 30000,
      retryOnStatus: [408, 429, 500, 502, 503, 504],
    });

    const status = response.status;

    if (status === 401) {
      return { ok: false, error: 'GitHub-Token ist ungültig. Bitte neu authentifizieren.', status };
    }
    if (status === 403) {
      return { ok: false, error: 'GitHub-Rate-Limit erreicht oder keine Berechtigung.', status };
    }
    if (status === 404) {
      return { ok: false, error: 'Repository oder Ressource nicht gefunden.', status };
    }

    if (status === 204) {
      return { ok: true, data: undefined as unknown as T };
    }

    const text = await response.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as unknown as T;
    }

    if (!response.ok) {
      return { ok: false, error: `GitHub API Fehler ${status}`, status };
    }

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Netzwerkfehler: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function fetchGitHubUser(): Promise<GitHubUserInfo | null> {
  const result = await githubApi<{
    login: string;
    name: string;
    avatar_url: string;
    html_url: string;
  }>('/user');

  if (!result.ok || !result.data) return null;

  return {
    login: result.data.login,
    name: result.data.name || result.data.login,
    avatarUrl: result.data.avatar_url,
    htmlUrl: result.data.html_url,
  };
}

export async function listRepos(): Promise<{ repos?: GitHubRepo[]; error?: string }> {
  const result = await githubApi<Array<{
    id: number;
    name: string;
    full_name: string;
    description: string;
    private: boolean;
    html_url: string;
    clone_url: string;
    default_branch: string;
    pushed_at: string;
  }>>('/user/repos?sort=updated&per_page=50&type=all');

  if (!result.ok || !result.data) return { error: result.error };

  return {
    repos: result.data.map(r => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description || '',
      private: r.private,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at,
    })),
  };
}

export async function createRepo(
  name: string,
  description?: string,
  isPrivate: boolean = false
): Promise<{ repo?: GitHubRepo; error?: string }> {
  const result = await githubApi<{
    id: number;
    name: string;
    full_name: string;
    description: string;
    private: boolean;
    html_url: string;
    clone_url: string;
    default_branch: string;
    pushed_at: string;
  }>('/user/repos', {
    method: 'POST',
    body: {
      name,
      description: description || '',
      private: isPrivate,
      auto_init: false,
    },
  });

  if (!result.ok || !result.data) return { error: result.error };

  const r = result.data;
  const repo: GitHubRepo = {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description || '',
    private: r.private,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
  };

  setActiveRepo(r.full_name.split('/')[0], r.name);
  return { repo };
}

export async function getRepoContents(
  owner: string,
  repo: string,
  path: string = ''
): Promise<{ files?: GitHubFile[]; error?: string }> {
  const apiPath = path ? `/repos/${owner}/${repo}/contents/${path}` : `/repos/${owner}/${repo}/contents`;
  const result = await githubApi<GitHubFile[] | GitHubFile>(apiPath);

  if (!result.ok || !result.data) return { error: result.error };

  const files = Array.isArray(result.data) ? result.data : [result.data];
  return { files };
}

export async function createOrUpdateFile(
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  commitMessage: string,
  branch: string = 'main'
): Promise<{ error?: string; sha?: string }> {
  const body: Record<string, unknown> = {
    message: commitMessage,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };

  // Check if file exists to get its SHA
  const existing = await githubApi<{ sha: string }>(`/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
  if (existing.ok && existing.data) {
    body.sha = existing.data.sha;
  }

  const result = await githubApi<{ content: { sha: string } }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
    { method: 'PUT', body }
  );

  if (!result.ok) return { error: result.error };
  return { sha: result.data?.content?.sha };
}

export async function pushMultipleFiles(
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
  commitMessage: string,
  branch: string = 'main'
): Promise<{ results: { path: string; ok: boolean; error?: string }[]; totalOk: number; totalFailed: number }> {
  const results: { path: string; ok: boolean; error?: string }[] = [];
  let totalOk = 0;
  let totalFailed = 0;

  for (const file of files) {
    try {
      const result = await createOrUpdateFile(owner, repo, file.path, file.content, commitMessage, branch);
      if (result.error) {
        results.push({ path: file.path, ok: false, error: result.error });
        totalFailed++;
      } else {
        results.push({ path: file.path, ok: true });
        totalOk++;
      }
    } catch (e) {
      results.push({
        path: file.path,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      totalFailed++;
    }
  }

  return { results, totalOk, totalFailed };
}

export async function deleteRepo(
  owner: string,
  repo: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await githubApi(`/repos/${owner}/${repo}`, { method: 'DELETE' });

  if (result.status === 204 || result.ok) {
    const active = getActiveRepo();
    if (active && active.owner === owner && active.repo === repo) {
      mmkv.delete(GITHUB_ACTIVE_REPO_KEY);
    }
    return { ok: true };
  }

  return { ok: false, error: result.error };
}

export async function checkTokenValidity(): Promise<boolean> {
  const token = getStoredToken();
  if (!token) return false;
  const result = await githubApi('/user');
  return result.ok;
}
