import { readJson, type RepoConfig } from './github'

// ---------- Types des fichiers du repo de données ----------

export interface Activity {
  id: number | string
  start: string // "YYYY-MM-DD HH:MM:SS" heure locale
  type: string
  name: string
  durationS: number | null
  movingS: number | null
  distanceM: number | null
  avgHR: number | null
  maxHR: number | null
  load: number | null
  aerobicTE: number | null
  anaerobicTE: number | null
  teLabel: string | null
  calories: number | null
  hrZonesS: (number | null)[]
  source: 'garmin' | 'healthfit'
}

export interface HealthDay {
  hrv?: number | null
  hrvWeekly?: number | null
  hrvStatus?: string | null
  hrvBaseLow?: number | null
  hrvBaseHigh?: number | null
  sleepS?: number | null
  sleepScore?: number | null
  rhr?: number | null
  readiness?: number | null
  readinessLevel?: string | null
  readinessFeedback?: string | null
  acuteLoad?: number | null
  recoveryH?: number | null
}

export interface Status {
  vo2max?: number | null
  vo2maxDate?: string | null
  loadBalancePhrase?: string | null
  syncedAt?: string
}

export interface CalendarItem {
  date: string
  workoutId: number | null
  name: string | null
  sport: string | null
  durationS: number | null
}

export interface Goal {
  id: string
  label: string
  target?: string
  metric: string
  startValue?: number
  targetValue: number
  currentValue?: number
  milestone?: { label: string; date: string }
}

export interface Macrocycle {
  id: string
  name: string
  start: string
  weeks: number
  priorities: string[]
}

export interface Profile {
  athlete: { firstName: string; hrMax: number }
  goals: Goal[]
  macrocycles: Macrocycle[]
  activityRules: {
    ignoredTypes: string[]
    wodNamePatterns: string[]
    mobilityNamePatterns: string[]
    warmupNamePatterns: string[]
  }
}

export interface AppData {
  activities: Activity[]
  health: Record<string, HealthDay>
  status: Status
  calendar: CalendarItem[]
  profile: Profile | null
}

export async function loadAll(c: RepoConfig): Promise<AppData> {
  const [activities, health, status, calendar, profile] = await Promise.all([
    readJson<Activity[]>(c, 'data/activities/index.json', []),
    readJson<Record<string, HealthDay>>(c, 'data/health/daily.json', {}),
    readJson<Status>(c, 'data/status.json', {}),
    readJson<CalendarItem[]>(c, 'data/calendar.json', []),
    readJson<Profile | null>(c, 'data/profile.json', null),
  ])
  return { activities, health, status, calendar, profile }
}

// ---------- Catégories ----------

export type Category = 'run' | 'strength' | 'wod' | 'mobility' | 'warmup' | 'other'

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  run: { label: 'Course', color: 'var(--run)' },
  strength: { label: 'Muscu', color: 'var(--lift)' },
  wod: { label: 'WOD', color: 'var(--wod)' },
  mobility: { label: 'Mobilité', color: 'var(--mobility)' },
  warmup: { label: 'Échauffement', color: 'var(--muted)' },
  other: { label: 'Autre', color: 'var(--muted)' },
}

const RUN_TYPES = new Set(['running', 'treadmill_running', 'trail_running', 'track_running', 'virtual_run', 'indoor_running'])
const MOBILITY_TYPES = new Set(['yoga', 'pilates', 'breathwork', 'mobility', 'flexibility'])
const STRENGTH_TYPES = new Set(['strength_training', 'indoor_cardio', 'fitness_equipment'])

const DEFAULT_RULES: Profile['activityRules'] = {
  ignoredTypes: ['walking'],
  wodNamePatterns: ['wod', 'emom', 'amrap', 'for time', 'metcon'],
  mobilityNamePatterns: ['mobilité', 'mobility', 'étirement', 'stretch', 'cooldown', 'yoga'],
  warmupNamePatterns: ['échauffement', 'warm-up', 'warmup', 'scap activation'],
}

export function categorize(a: Activity, rules: Profile['activityRules'] = DEFAULT_RULES): Category {
  const name = ` ${(a.name || '').toLowerCase()} `
  const has = (ps: string[]) => ps.some((p) => name.includes(p))
  if (RUN_TYPES.has(a.type)) return has(rules.wodNamePatterns) ? 'wod' : 'run'
  if (MOBILITY_TYPES.has(a.type)) return 'mobility'
  if (a.type === 'hiit') return 'wod'
  if (STRENGTH_TYPES.has(a.type)) {
    if (has(rules.warmupNamePatterns)) return 'warmup'
    if (has(rules.mobilityNamePatterns)) return 'mobility'
    if (has(rules.wodNamePatterns)) return 'wod'
    return 'strength'
  }
  return 'other'
}

// ---------- Dates ----------

export const pad = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}
export const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export const DAY_SHORT = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']

export function formatDuration(s: number | null | undefined): string {
  if (!s) return '0 min'
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`
}

export function relativeTime(iso?: string): string {
  if (!iso) return 'jamais'
  const diff = (Date.now() - new Date(iso).getTime()) / 60000
  if (diff < 1) return "à l'instant"
  if (diff < 60) return `il y a ${Math.round(diff)} min`
  if (diff < 60 * 24) return `il y a ${Math.round(diff / 60)} h`
  return `il y a ${Math.round(diff / 1440)} j`
}

// ---------- Macrocycle ----------

export function currentMacro(profile: Profile | null, today: Date) {
  if (!profile) return null
  for (const m of profile.macrocycles) {
    const start = mondayOf(parseDay(m.start))
    const week = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000)) + 1
    if (week >= 1 && week <= m.weeks) return { macro: m, week }
  }
  return null
}

// ---------- Semaine ----------

export interface Session {
  category: Category
  activities: Activity[]
  start: string
  durationS: number
  load: number
}

/** Regroupe les blocs Garmin enchaînés (échauffement + corps + cooldown) en séances. */
export function sessionsOf(acts: Activity[], rules?: Profile['activityRules']): Session[] {
  const sorted = [...acts].sort((a, b) => a.start.localeCompare(b.start))
  const sessions: Session[] = []
  let cur: Session | null = null
  let lastEnd = 0
  for (const a of sorted) {
    const cat = categorize(a, rules)
    if (cat === 'other') continue
    const t = new Date(a.start.replace(' ', 'T')).getTime()
    const sameDay = cur && cur.start.slice(0, 10) === a.start.slice(0, 10)
    if (cur && sameDay && t - lastEnd < 20 * 60000) {
      cur.activities.push(a)
      cur.durationS += a.durationS || 0
      cur.load += a.load || 0
      if (cur.category === 'warmup' || (cur.category === 'mobility' && cat !== 'warmup')) cur.category = cat
    } else {
      cur = { category: cat, activities: [a], start: a.start, durationS: a.durationS || 0, load: a.load || 0 }
      sessions.push(cur)
    }
    lastEnd = t + (a.durationS || 0) * 1000
  }
  return sessions
}

export const RING_TARGETS: Record<'run' | 'strength' | 'wod' | 'mobility', number> = {
  run: 3,
  strength: 2,
  wod: 1,
  mobility: 2,
}
