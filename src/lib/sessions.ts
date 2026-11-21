import { readJson, readJsonWithSha, writeJson, type RepoConfig } from './github'
import type { Activity } from './data'
import type { ExerciseHistory } from './library'
import type { GStep } from './wod'

export interface SetRow { category: string | null; exercise: string | null; reps: number | null; weightKg: number | null; durationS: number | null; type: 'ACTIVE' | 'REST' | string; start: string }
export interface ExerciseBlock { key: string; sets: SetRow[] }

export const loadSets = (c: RepoConfig, id: Activity['id']) => readJson<SetRow[]>(c, `data/activities/sets/${id}.json`, [])

/** Regroupe les séries actives par exercice, dans l'ordre de la séance. */
export function blocks(sets: SetRow[]): ExerciseBlock[] {
  const out: ExerciseBlock[] = []
  for (const s of sets) {
    if (s.type !== 'ACTIVE') continue
    const key = s.category && s.exercise ? `${s.category}/${s.exercise}` : 'INCONNU'
    const last = out[out.length - 1]
    if (last && last.key === key) last.sets.push(s)
    else {
      const prev = out.find((b) => b.key === key)
      if (prev) prev.sets.push(s)
      else out.push({ key, sets: [s] })
    }
  }
  return out
}

export const topSet = (sets: { reps: number | null; weightKg: number | null }[]) =>
  sets.reduce<{ w: number; r: number }>((best, s) => {
    const w = s.weightKg ?? 0, r = s.reps ?? 0
    return w > best.w || (w === best.w && r > best.r) ? { w, r } : best
  }, { w: 0, r: 0 })

export function volume(sets: SetRow[]) { return sets.reduce((t, s) => t + (s.weightKg ?? 0) * (s.reps ?? 0), 0) }

export type Trend = { kind: 'record' | 'first' | 'up' | 'same' | 'down'; label: string; detail: string }

/** Comparaison avec l'historique (séances antérieures à la date). */
export function trend(key: string, sets: SetRow[], date: string, hist: Record<string, ExerciseHistory>): Trend {
  const h = hist[key]
  const prev = (h?.sessions ?? []).filter((s) => s.date < date).sort((a, b) => b.date.localeCompare(a.date))
  const cur = topSet(sets)
  const curReps = sets.reduce((t, s) => t + (s.reps ?? 0), 0)
  if (!prev.length) return { kind: 'first', label: 'Nouveau', detail: 'Première fois enregistrée' }
  const all = prev.flatMap((s) => s.sets.map(([r, w]) => ({ reps: r, weightKg: w })))
  const best = topSet(all)
  const last = prev[0]
  const lastTop = topSet(last.sets.map(([r, w]) => ({ reps: r, weightKg: w })))
  const lastReps = last.sets.reduce((t, [r]) => t + (r ?? 0), 0)
  const d = `${last.date.slice(8)}/${last.date.slice(5, 7)} : ${last.sets.map(([r, w]) => (w ? `${fmtKg(w)} × ${r}` : `${r}`)).join(', ')}`
  if (cur.w > 0 && (cur.w > best.w || (cur.w === best.w && cur.r > best.r))) return { kind: 'record', label: 'Record', detail: d }
  if (cur.w > lastTop.w) return { kind: 'up', label: `+${fmtKg(cur.w - lastTop.w)} kg`, detail: d }
  if (cur.w < lastTop.w) return { kind: 'down', label: `−${fmtKg(lastTop.w - cur.w)} kg`, detail: d }
  if (curReps > lastReps) return { kind: 'up', label: `+${curReps - lastReps} reps`, detail: d }
  if (curReps < lastReps) return { kind: 'down', label: `−${lastReps - curReps} reps`, detail: d }
  return { kind: 'same', label: 'Stable', detail: d }
}

export const fmtKg = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

// ---------- Ressenti ----------

export interface Feel { rpe?: number; pain?: number; note?: string }
export const FEEL_PATH = 'data/sessions/feel.json'
export const loadFeel = (c: RepoConfig) => readJsonWithSha<Record<string, Feel>>(c, FEEL_PATH, {})
export const saveFeel = (c: RepoConfig, f: Record<string, Feel>, sha: string | null, msg: string) => writeJson(c, FEEL_PATH, f, sha, msg)

// ---------- Refaire la séance ----------

export function redoSteps(bl: ExerciseBlock[]): GStep[] {
  const out: GStep[] = []
  for (const b of bl) {
    if (b.key === 'INCONNU') continue
    b.sets.forEach((s, i) => {
      out.push(s.reps ? { t: 'ex', g: b.key, reps: s.reps, kg: s.weightKg || undefined, note: `${s.weightKg ? fmtKg(s.weightKg) + ' kg × ' : ''}${s.reps}` }
        : { t: 'ex', g: b.key, sec: Math.round(s.durationS ?? 30), note: 'temps' })
      if (i < b.sets.length - 1) out.push({ t: 'rest', sec: 90 })
    })
    out.push({ t: 'rest', sec: 120 })
  }
  if (out.length && out[out.length - 1].t === 'rest') out.pop()
  return out
}
