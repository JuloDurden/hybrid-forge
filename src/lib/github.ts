// Accès au repo de données privé via l'API REST GitHub.
// Le jeton (fine-grained, limité au repo de données) reste dans le navigateur.

export interface RepoConfig {
  token: string
  owner: string
  repo: string
}

const KEY = 'hf.repo'
const API = 'https://api.github.com'

export const DEFAULT_REPO = { owner: 'JuloDurden', repo: 'hybrid-forge-data' }

export function loadConfig(): RepoConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as RepoConfig
    return c.token ? c : null
  } catch {
    return null
  }
}

export function saveConfig(c: RepoConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c))
}

export function clearConfig(): void {
  localStorage.removeItem(KEY)
}

function headers(c: RepoConfig, raw = false): HeadersInit {
  return {
    Authorization: `Bearer ${c.token}`,
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Vérifie que le jeton donne bien accès au repo. */
export async function checkAccess(c: RepoConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(`${API}/repos/${c.owner}/${c.repo}`, { headers: headers(c) })
    if (r.status === 401) return { ok: false, message: 'Jeton refusé (invalide ou expiré).' }
    if (r.status === 404) return { ok: false, message: 'Repo introuvable avec ce jeton : vérifie qu\'il donne accès à ce repo.' }
    if (!r.ok) return { ok: false, message: `Erreur GitHub ${r.status}.` }
    const j = await r.json()
    if (!j.private) return { ok: true, message: 'Accès OK. Attention : ce repo est public.' }
    return { ok: true, message: 'Accès OK au repo privé.' }
  } catch {
    return { ok: false, message: 'GitHub injoignable (réseau).' }
  }
}

/** Lit un fichier JSON du repo de données. Renvoie `fallback` si le fichier n'existe pas encore. */
export async function readJson<T>(c: RepoConfig, path: string, fallback: T): Promise<T> {
  const r = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURI(path)}`, {
    headers: headers(c, true),
    cache: 'no-store',
  })
  if (r.status === 404) return fallback
  if (!r.ok) throw new GitHubError(r.status, `Lecture ${path} : erreur ${r.status}`)
  return (await r.json()) as T
}

/** Déclenche le workflow de synchro (nécessite la permission Actions : write sur le jeton). */
export async function triggerSync(c: RepoConfig): Promise<boolean> {
  const r = await fetch(`${API}/repos/${c.owner}/${c.repo}/actions/workflows/sync.yml/dispatches`, {
    method: 'POST',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  })
  return r.status === 204
}

function b64encodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

function b64decodeUtf8(s: string): string {
  const bin = atob(s.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Lit un JSON avec son sha (nécessaire pour le réécrire). */
export async function readJsonWithSha<T>(c: RepoConfig, path: string, fallback: T): Promise<{ data: T; sha: string | null }> {
  const r = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURI(path)}`, { headers: headers(c), cache: 'no-store' })
  if (r.status === 404) return { data: fallback, sha: null }
  if (!r.ok) throw new GitHubError(r.status, `Lecture ${path} : erreur ${r.status}`)
  const j = await r.json()
  return { data: JSON.parse(b64decodeUtf8(j.content)) as T, sha: j.sha }
}

/** Écrit un JSON dans le repo (commit). Renvoie le nouveau sha. */
export async function writeJson(c: RepoConfig, path: string, data: unknown, sha: string | null, message: string): Promise<string> {
  const r = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64encodeUtf8(JSON.stringify(data, null, 1) + '\n'), ...(sha ? { sha } : {}) }),
  })
  if (r.status === 409 || r.status === 422) throw new GitHubError(r.status, 'Le fichier a changé entre-temps : recharge la page et recommence.')
  if (!r.ok) throw new GitHubError(r.status, `Écriture ${path} : erreur ${r.status}`)
  const j = await r.json()
  return j.content.sha as string
}
