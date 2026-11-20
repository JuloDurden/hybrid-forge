import raw from '../data/mobility.json'
import { readJsonWithSha, writeJson, type RepoConfig } from './github'

export interface MobMove {
  id: string
  name: string
  en: string | null
  kind: 'dyn' | 'stat' | 'mass'
  sides: boolean
  zones: string[]
  garmin: string
  garminName: string | null
  yt: string | null
  url: string | null
  eq: string[] | null
  why: string
  how: string[]
  avoid: string[]
}
export interface Protocol {
  id: string
  type: 'activation' | 'recuperation' | 'classique' | 'perso' | 'flow'
  title: string
  sub?: string
  sport?: string
  steps: { id: string; prio?: number }[]
}
export interface GowodExtra { id: string; name: string; zones: string[]; eq: string[]; yt: string | null; url: string }
export interface Clip { id: string; title: string }
export interface LibMob { id: string; name: string; en: string; img: string[]; yt: string | null; how: string[]; zones: string[] }

const data = raw as unknown as { moves: Record<string, MobMove>; protocols: Protocol[]; gowod: GowodExtra[]; clips: Clip[]; lib: LibMob[] }
export const MOVES = data.moves
export const PROTOCOLS = data.protocols
export const GOWOD_EXTRA = data.gowod
export const CLIPS = data.clips
export const LIB_MOB = data.lib

export const DURATIONS = [3, 8, 15, 22] as const
export type Minutes = (typeof DURATIONS)[number]

export const MOB_ZONES = ['Chevilles', 'Mollets', 'Hanches', 'Fessiers', 'Adducteurs', 'Ischios', 'Quadriceps', 'Bas du dos', 'Thoracique', 'Épaules', 'Pectoraux', 'Poignets', 'Cou']

export const KIND_FR: Record<MobMove['kind'], string> = { dyn: 'Dynamique', stat: 'Maintien', mass: 'Rouleau' }

export const ytThumb = (id: string | null | undefined) => (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null)

/** Étape jouable : un mouvement, un côté éventuel, une durée. */
export interface PlayStep { move: MobMove; side: 'G' | 'D' | null; seconds: number }

const TRANSITION = 5
const BASE: Record<MobMove['kind'], number> = { dyn: 40, stat: 45, mass: 45 }
const r5 = (n: number) => Math.max(20, Math.round(n / 5) * 5)

/** Coût en secondes d'un mouvement avec une durée par côté donnée. */
const cost = (m: MobMove, s: number) => (m.sides ? 2 : 1) * (s + TRANSITION)

/** Choisit et dose les mouvements pour tenir la durée cible (3, 8, 15 ou 22 min). */
export function fitToDuration(steps: { id: string; prio?: number }[], minutes: number): PlayStep[] {
  const target = minutes * 60
  const ordered = steps
    .map((s, i) => ({ m: MOVES[s.id], prio: s.prio ?? 1, i }))
    .filter((x) => x.m)
  // on ajoute par priorité croissante jusqu'à couvrir ~90 % de la cible avec les durées de base
  const byPrio = [...ordered].sort((a, b) => a.prio - b.prio || a.i - b.i)
  const chosen: typeof ordered = []
  let total = 0
  for (const x of byPrio) {
    const c = cost(x.m, BASE[x.m.kind])
    if (chosen.length >= 2 && total + c > target * 1.08) continue
    chosen.push(x)
    total += c
    if (total >= target * 0.9) break
  }
  chosen.sort((a, b) => a.i - b.i)
  // mise à l'échelle des durées pour coller à la cible
  const fixed = chosen.reduce((s, x) => s + (x.m.sides ? 2 : 1) * TRANSITION, 0)
  const work = chosen.reduce((s, x) => s + (x.m.sides ? 2 : 1) * BASE[x.m.kind], 0)
  const k = Math.min(3, Math.max(0.5, (target - fixed) / Math.max(1, work)))
  const out: PlayStep[] = []
  for (const x of chosen) {
    const sec = Math.min(150, r5(BASE[x.m.kind] * k))
    if (x.m.sides) out.push({ move: x.m, side: 'G', seconds: sec }, { move: x.m, side: 'D', seconds: sec })
    else out.push({ move: x.m, side: null, seconds: sec })
  }
  // ajustement fin : on retire 5 s aux étapes les plus longues tant qu'on dépasse la cible
  let guard = 200
  while (totalSeconds(out) > target + 10 && guard--) {
    const longest = out.reduce((a, b) => (b.seconds > a.seconds ? b : a))
    if (longest.seconds <= 20) break
    const id = longest.move.id
    out.forEach((s) => { if (s.move.id === id) s.seconds -= 5 })
  }
  return out
}

export const totalSeconds = (p: PlayStep[]) => p.reduce((s, x) => s + x.seconds + TRANSITION, 0)
export const TRANSITION_S = TRANSITION

// ---------- Flow quotidien personnalisé ----------

function seeded(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

/** Flow du jour : mouvements des zones prioritaires, tirés au sort par la date, dynamiques d'abord puis maintiens. */
export function dailyFlow(day: string, focus: string[]): Protocol {
  const rnd = seeded(day + focus.join(','))
  const pool = Object.values(MOVES).filter((m) => !focus.length || m.zones.some((z) => focus.includes(z)))
  const shuffled = pool.map((m) => ({ m, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.m)
  const order = { dyn: 0, stat: 1, mass: 2 }
  const pick = shuffled.slice(0, 12)
  pick.sort((a, b) => order[a.kind] - order[b.kind])
  return {
    id: 'flow-' + day, type: 'flow', title: 'Flow quotidien', sub: focus.join(', ') || 'Corps entier',
    steps: pick.map((m, i) => ({ id: m.id, prio: i < 4 ? 1 : i < 8 ? 2 : 3 })),
  }
}

export function zoneFlow(zone: string): Protocol {
  const pool = Object.values(MOVES).filter((m) => m.zones.includes(zone))
  const order = { dyn: 0, stat: 1, mass: 2 }
  pool.sort((a, b) => order[a.kind] - order[b.kind] || a.zones.indexOf(zone) - b.zones.indexOf(zone))
  return { id: 'zone-' + zone, type: 'flow', title: zone, sub: `${pool.length} mouvements`, steps: pool.map((m, i) => ({ id: m.id, prio: i < 4 ? 1 : i < 7 ? 2 : 3 })) }
}

// ---------- Mes protocoles (repo privé) ----------

export const PERSO_PATH = 'data/mobility/protocols.json'
export interface PersoFile { protocols: Protocol[] }

export async function loadPerso(c: RepoConfig) {
  return readJsonWithSha<PersoFile>(c, PERSO_PATH, { protocols: [] })
}
export async function savePerso(c: RepoConfig, f: PersoFile, sha: string | null, msg: string) {
  return writeJson(c, PERSO_PATH, f, sha, msg)
}

// ---------- Envoi vers la montre ----------

export async function sendToGarmin(c: RepoConfig, name: string, date: string, steps: PlayStep[]) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const payload = {
    name: `Mobilité · ${name}`,
    date,
    steps: steps.map((s) => ({ garmin: s.move.garmin, seconds: s.seconds, label: s.move.name + (s.side ? ` (${s.side === 'G' ? 'gauche' : 'droite'})` : '') })),
  }
  await writeJson(c, `outbox/mobility/${stamp}.json`, payload, null, `mobilité: envoi ${name}`)
}

export const fmtMin = (s: number) => {
  const m = Math.round(s / 60)
  return `${m} min`
}
