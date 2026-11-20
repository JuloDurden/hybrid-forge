import { readJson, readJsonWithSha, writeJson, type RepoConfig } from './github'

export interface GarminRef {
  c: string // catégorie Garmin
  e: string // exercice Garmin
  n: string // nom affiché par Garmin
  s: number // score de correspondance 0-100
  x?: 1 // noms identiques (correspondance certaine)
}

export interface Movement {
  id: string
  name: string
  en: string
  cat: 'muscu' | 'halto' | 'gainage' | 'wod' | 'plyo' | 'cardio' | 'mobilite'
  eq: string
  mine: boolean
  pm: string[]
  sm: string[]
  lvl: string | null
  how: string[]
  img: string[]
  g: GarminRef[]
  src: 'fedb' | 'garmin' | 'custom' | 'crossfit'
  video?: string
  /** vidéo YouTube officielle CrossFit.com (identifiant) et page source */
  yt?: string
  ytSrc?: string
}

export interface GarminExercise {
  name: string
  category: string
  exercise: string
}

export interface ExerciseHistory {
  sessions: { date: string; activityId: number; activity: string; sets: [number | null, number | null, number | null][] }[]
  totalSets: number
  lastDate: string
  bestWeight: [number, number, number | null] | null
  bestReps: number | null
}

export interface Overrides {
  /** correspondance Garmin choisie et verrouillée pour un mouvement */
  map: Record<string, { c: string; e: string; n: string }>
  /** "CATEGORIE/EXERCICE" enregistré par la montre -> mouvement réellement fait */
  alias: Record<string, string>
  /** exercices de l'historique validés tels quels */
  confirmed: Record<string, true>
  /** lien vidéo de démonstration ajouté à un mouvement */
  video: Record<string, string>
}

export const CAT_META: Record<Movement['cat'], { label: string; color: string }> = {
  muscu: { label: 'Muscu', color: 'var(--lift)' },
  halto: { label: 'Haltéro', color: '#c4b5fd' },
  gainage: { label: 'Gainage', color: '#5eead4' },
  wod: { label: 'WOD', color: 'var(--wod)' },
  plyo: { label: 'Pliométrie', color: 'var(--run)' },
  cardio: { label: 'Cardio', color: 'var(--run)' },
  mobilite: { label: 'Mobilité', color: 'var(--mobility)' },
}

export const EQUIP_FR: Record<string, string> = {
  barbell: 'Barre', dumbbell: 'Haltères', kettlebell: 'Kettlebell', cable: 'Poulie', band: 'Élastique',
  suspension: 'TRX', medball: 'Medicine ball', swissball: 'Swiss ball', ezbar: 'Barre EZ', body: 'Poids du corps',
  machine: 'Machine', foamroll: 'Rouleau', other: 'Autre', sandbag: 'Sandbag', smith: 'Smith', landmine: 'Landmine',
  ring: 'Anneaux', sled: 'Traîneau', box: 'Box', rope: 'Corde',
}

export const OVERRIDES_PATH = 'data/library/overrides.json'
export const EMPTY_OVERRIDES: Overrides = { map: {}, alias: {}, confirmed: {}, video: {} }
export const CUSTOM_PATH = 'data/library/custom.json'

export async function loadLibraryData(c: RepoConfig) {
  const [base, garmin, garminFr, history, ov, custom] = await Promise.all([
    import('../data/library.json').then((m) => m.default as Movement[]),
    import('../data/garmin-exercises.json').then((m) => m.default as GarminExercise[]),
    import('../data/garmin-fr.json').then((m) => m.default as Record<string, string>),
    readJson<Record<string, ExerciseHistory>>(c, 'data/exercises.json', {}),
    readJsonWithSha<Overrides>(c, OVERRIDES_PATH, EMPTY_OVERRIDES),
    readJsonWithSha<Movement[]>(c, CUSTOM_PATH, []),
  ])
  const lib = [...custom.data, ...base]
  return {
    lib, garmin, garminFr, history,
    overrides: { ...EMPTY_OVERRIDES, ...ov.data }, sha: ov.sha,
    custom: custom.data, customSha: custom.sha,
  }
}

export async function saveOverrides(c: RepoConfig, o: Overrides, sha: string | null, msg: string) {
  return writeJson(c, OVERRIDES_PATH, o, sha, msg)
}

export async function saveCustom(c: RepoConfig, list: Movement[], sha: string | null, msg: string) {
  return writeJson(c, CUSTOM_PATH, list, sha, msg)
}

export function slugify(s: string) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const garminKey = (c: string, e: string) => `${c}/${e}`

/** Correspondance effective (verrouillée sinon calculée). */
export function effectiveGarmin(m: Movement, o: Overrides): GarminRef & { locked: boolean } {
  const lock = o.map[m.id]
  if (lock) return { ...lock, s: 100, locked: true }
  return { ...m.g[0], locked: false }
}

export function matchBand(score: number, locked: boolean) {
  if (locked || score >= 80) return { label: locked ? 'Verrouillée' : 'Exacte', color: 'var(--good)', bg: '#0f2a1f', border: '#14532d' }
  if (score >= 55) return { label: 'Approchée', color: 'var(--warn)', bg: '#2a210a', border: '#713f12' }
  return { label: 'Générique', color: 'var(--wod)', bg: '#2a0f1f', border: '#701a45' }
}

/** Index inverse : exercice Garmin -> mouvement de la bibliothèque. */
export function buildReverse(lib: Movement[], o: Overrides): Map<string, Movement> {
  const byId = new Map(lib.map((m) => [m.id, m]))
  const rev = new Map<string, Movement>()
  const best = new Map<string, number>()
  for (const m of lib) {
    const g = effectiveGarmin(m, o)
    const k = garminKey(g.c, g.e)
    // une fiche free-exercise-db n'est proposée d'office que si la correspondance est quasi certaine
    if (m.src === 'fedb' && !g.locked && !g.x) continue
    if (m.src === 'custom' && !g.locked) continue
    const sc = m.src === 'garmin' ? 1000 : g.locked ? 2000 : g.s
    if (sc > (best.get(k) ?? -1)) {
      best.set(k, sc)
      rev.set(k, m)
    }
  }
  for (const [k, id] of Object.entries(o.alias)) {
    const m = byId.get(id)
    if (m) rev.set(k, m)
  }
  return rev
}

export function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
