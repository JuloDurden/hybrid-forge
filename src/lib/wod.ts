import raw from '../data/wods.json'
import { readJsonWithSha, writeJson, type RepoConfig } from './github'
import { fitToDuration, PROTOCOLS } from './mobility'

// ---------- Types ----------

export type Unit = 'reps' | 'cal' | 'm' | 's'
export type Level = 'rx' | 'my' | 'sc'
export type Format = 'fortime' | 'amrap' | 'emom' | 'tabata' | 'chipper' | 'intervals' | 'strength'

export interface WodMoveDef {
  key: string; fr: string; en: string; alias: string[]; garmin: string; unit: Unit
  load: 'bar' | 'db' | 'kb' | 'wb' | null; rx: number | null; my: number | null; sc: number | null
  sub: Partial<Record<Level, [string, number]>>; lib: string | null; yt: string | null; img: string | null
}
export interface WodMove { key: string; reps?: number | null; load?: number | null; note?: string }
export interface Wod {
  id: string
  name: string
  family?: string
  format: Format
  minutes?: number // amrap / emom
  every?: number // emom : secondes (60 par défaut)
  emom?: 'alternate' | 'all'
  rounds?: number
  scheme?: number[]
  cap?: number
  rest?: number // repos entre les tours (s)
  work?: number // intervals : travail (s)
  intervals?: 'stations' | 'amrap'
  moves: WodMove[]
  note?: string
  warmup?: { protocol: string; minutes: number } | null
  skill?: { key: string; sets: number; reps: number; load?: number | null } | null
  cooldown?: { protocol: string; minutes: number } | null
  source?: string
  level?: Level
}

const data = raw as unknown as { moves: Record<string, WodMoveDef>; bench: Wod[] }
export const WMOVES = data.moves
export const BENCH = data.bench

export const FORMATS: { id: Format; label: string }[] = [
  { id: 'emom', label: 'EMOM' }, { id: 'amrap', label: 'AMRAP' }, { id: 'fortime', label: 'For Time' },
  { id: 'chipper', label: 'Chipper' }, { id: 'tabata', label: 'Tabata' }, { id: 'intervals', label: 'Intervalles' }, { id: 'strength', label: 'Force' },
]
export const LEVELS: { id: Level; label: string }[] = [{ id: 'rx', label: 'RX' }, { id: 'my', label: 'Mon niveau' }, { id: 'sc', label: 'Scaled' }]
export const UNIT_FR: Record<Unit, string> = { reps: '', cal: 'cal', m: 'm', s: 's' }

// ---------- Niveau : remplacements et charges ----------

export interface ResolvedMove { key: string; def: WodMoveDef; amount: number | null; load: number | null; swapped?: string; note?: string }

const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step)

export function resolveMove(m: WodMove, level: Level, schemeReps: number | null): ResolvedMove {
  let def = WMOVES[m.key]
  let amount = m.reps ?? schemeReps
  let swapped: string | undefined
  if (level !== 'rx' && def.sub[level]) {
    const [k, f] = def.sub[level]!
    swapped = def.fr
    const to = WMOVES[k]
    if (amount != null) amount = to.unit === 'm' ? round(amount * f, def.unit === 'm' ? 10 : 50) : Math.round(amount * f)
    def = to
  }
  let load: number | null = null
  if (def.load) {
    const rx = m.load ?? def.rx
    if (level === 'rx') load = rx ?? def.my
    else {
      const mine = level === 'my' ? def.my : def.sc
      load = rx != null && mine != null ? Math.min(rx, mine) : (mine ?? rx)
    }
  }
  return { key: def.key, def, amount, load, swapped, note: m.note }
}

/** Tous les mouvements concrets d'un tour (ou du tour i pour un schéma 21-15-9). */
export function roundMoves(w: Wod, level: Level, i = 0) {
  return w.moves.map((m) => resolveMove(m, level, w.scheme ? w.scheme[i] ?? null : null))
}

export function fmtAmount(r: ResolvedMove) {
  if (r.amount == null) return ''
  return r.def.unit === 'reps' ? String(r.amount) : `${r.amount} ${UNIT_FR[r.def.unit]}`
}
export const fmtKg = (n: number | null) => (n == null ? '' : `${String(n).replace('.', ',')} kg`)

// ---------- Estimations ----------

const SEC_PER: Record<string, number> = {
  burpee: 4.5, 'burpee-box-jump-over': 6, 'bar-facing-burpee': 5, 'pull-up': 3, 'banded-pull-up': 3.5, 'ring-row': 2.5, 'push-up': 2,
  'air-squat': 2, 'sit-up': 2.5, 'double-under': 0.6, 'single-under': 0.5, 'wall-ball': 3.5, 'box-jump': 3, 'kb-swing': 2.5,
  'step-up': 2.5, lunge: 2.5, 'knee-raise': 2.5, 'toes-to-bar': 3, 'mountain-climber': 1,
}
function secondsFor(r: ResolvedMove) {
  const a = r.amount ?? 10
  switch (r.def.unit) {
    case 'm': return r.def.key === 'run' ? a * 0.36 : a * 0.6
    case 'cal': return a * 4
    case 's': return a
    default: return a * (SEC_PER[r.key] ?? (r.def.load === 'bar' ? 4.5 : 3))
  }
}

export function estimate(w: Wod, level: Level) {
  let wodS = 0
  let rounds = 0
  const rm = roundMoves(w, level)
  const tour = rm.reduce((s, r) => s + secondsFor(r), 0)
  switch (w.format) {
    case 'amrap': wodS = (w.minutes ?? 12) * 60; rounds = Math.max(1, Math.floor(wodS / Math.max(20, tour))); break
    case 'emom': wodS = (w.minutes ?? 12) * 60; rounds = w.emom === 'all' ? (w.minutes ?? 12) : Math.floor((w.minutes ?? 12) / Math.max(1, w.moves.length)); break
    case 'tabata': wodS = w.moves.length * 240 + (w.moves.length - 1) * 60; rounds = 8; break
    case 'intervals': {
      const n = w.rounds ?? 3
      const per = w.intervals === 'stations' ? w.moves.length * (w.work ?? 60) : (w.work ?? 180)
      wodS = n * per + (n - 1) * (w.rest ?? 60); rounds = n; break
    }
    case 'strength': rounds = w.scheme?.length ?? w.rounds ?? 5; wodS = rounds * (tour + (w.rest ?? 150)); break
    default: {
      if (w.scheme) { wodS = w.scheme.reduce((s, _, i) => s + roundMoves(w, level, i).reduce((a, r) => a + secondsFor(r), 0), 0); rounds = w.scheme.length }
      else { rounds = w.format === 'chipper' ? 1 : (w.rounds ?? 1); wodS = rounds * tour + (rounds - 1) * (w.rest ?? 0) }
      if (w.cap) wodS = Math.min(wodS, w.cap * 60)
    }
  }
  // volume barre
  let volume = 0
  const nRounds = w.scheme ? w.scheme.length : rounds
  for (let i = 0; i < nRounds; i++) {
    for (const r of w.scheme ? roundMoves(w, level, i) : rm) if (r.def.load === 'bar' && r.load && r.amount && r.def.unit === 'reps') volume += r.load * r.amount
  }
  const warm = w.warmup ? w.warmup.minutes * 60 : 0
  const skill = w.skill ? w.skill.sets * (w.skill.reps * 5 + 90) : 0
  const cool = w.cooldown ? w.cooldown.minutes * 60 : 0
  return { wodS: Math.round(wodS), totalS: Math.round(wodS + warm + skill + cool), rounds, volumeKg: Math.round(volume) }
}

/** Stimulus dominant, d'après le format, la durée et la charge. */
export function stimulus(w: Wod, level: Level) {
  const e = estimate(w, level)
  const heavy = roundMoves(w, level).some((r) => r.def.load === 'bar' && (r.load ?? 0) >= 50)
  if (w.format === 'strength') return 'Force'
  if (e.wodS <= 8 * 60) return heavy ? 'Puissance' : 'Sprint'
  if (e.wodS <= 15 * 60) return heavy ? 'Force-endurance' : 'Métabolique'
  return 'Endurance'
}

// ---------- Étapes Garmin ----------

export type ExStep = { t: 'ex'; g: string; reps?: number; sec?: number; kg?: number; note: string }
export type GStep =
  | ExStep
  | { t: 'rest'; sec?: number; note?: string }
  | { t: 'rep'; n: number; steps: GStep[] }

function exStep(r: ResolvedMove, timedSec?: number, extra = ''): ExStep {
  const note = [fmtAmount(r) && r.def.unit !== 'reps' ? fmtAmount(r) : '', r.def.unit === 'reps' && r.amount && timedSec ? `${r.amount} reps` : '', r.load ? fmtKg(r.load) : '', extra]
    .filter(Boolean).join(' · ')
  const base = { t: 'ex' as const, g: r.def.garmin || 'CARDIO/CARDIO', kg: r.load ?? undefined, note: `${r.def.fr}${note ? ' · ' + note : ''}` }
  if (timedSec) return { ...base, sec: timedSec }
  if (r.def.unit === 'reps' && r.amount) return { ...base, reps: r.amount }
  if (r.def.unit === 's' && r.amount) return { ...base, sec: r.amount }
  return base // fin au bouton Lap (distance, calories)
}

export function wodSteps(w: Wod, level: Level): GStep[] {
  const rm = roundMoves(w, level)
  switch (w.format) {
    case 'amrap': {
      const e = estimate(w, level)
      return [{ t: 'rep', n: e.rounds + 3, steps: rm.map((r) => exStep(r)) }]
    }
    case 'emom': {
      const every = w.every ?? 60
      const mins = w.minutes ?? 12
      if (w.emom === 'all') {
        const label = rm.map((r) => `${fmtAmount(r)} ${r.def.fr}${r.load ? ' ' + fmtKg(r.load) : ''}`).join(' + ')
        return [{ t: 'rep', n: mins, steps: [{ ...exStep(rm[0], every), note: label }] }]
      }
      const k = Math.max(1, rm.length)
      const full = Math.floor(mins / k)
      const out: GStep[] = [{ t: 'rep', n: full, steps: rm.map((r) => exStep(r, every)) }]
      for (let i = 0; i < mins - full * k; i++) out.push(exStep(rm[i], every))
      return out
    }
    case 'tabata': {
      const out: GStep[] = []
      rm.forEach((r, i) => {
        out.push({ t: 'rep', n: 8, steps: [exStep(r, 20, 'max'), { t: 'rest', sec: 10 }] })
        if (i < rm.length - 1) out.push({ t: 'rest', sec: 60 })
      })
      return out
    }
    case 'intervals': {
      const work = w.work ?? 60
      const inner: GStep[] = w.intervals === 'amrap'
        ? [{ ...exStep(rm[0], work), note: 'AMRAP : ' + rm.map((r) => `${fmtAmount(r)} ${r.def.fr}${r.load ? ' ' + fmtKg(r.load) : ''}`).join(' + ') }]
        : rm.map((r) => exStep(r, work, 'max'))
      return [{ t: 'rep', n: w.rounds ?? 3, steps: [...inner, { t: 'rest', sec: w.rest ?? 60 }] }]
    }
    case 'strength':
      if (w.scheme) return w.scheme.flatMap((_, i) => [...roundMoves(w, level, i).map((r) => exStep(r)), { t: 'rest' as const, sec: w.rest ?? 150 }])
      return [{ t: 'rep', n: w.rounds ?? 5, steps: [...rm.map((r) => exStep(r)), { t: 'rest', sec: w.rest ?? 150 }] }]
    default: {
      if (w.scheme) return w.scheme.flatMap((_, i) => roundMoves(w, level, i).map((r) => exStep(r)))
      const n = w.format === 'chipper' ? 1 : (w.rounds ?? 1)
      const steps = rm.map((r) => exStep(r))
      if (n === 1) return steps
      return [{ t: 'rep', n, steps: w.rest ? [...steps, { t: 'rest', sec: w.rest }] : steps }]
    }
  }
}

function mobilitySteps(protocol: string, minutes: number): GStep[] {
  const p = PROTOCOLS.find((x) => x.id === protocol)
  if (!p) return []
  return fitToDuration(p.steps, minutes).map((s) => ({ t: 'ex', g: s.move.garmin, sec: s.seconds, note: s.move.name + (s.side ? ` (${s.side})` : '') }))
}

export function skillSteps(w: Wod): GStep[] {
  if (!w.skill) return []
  const d = WMOVES[w.skill.key]
  if (!d) return []
  const r: ResolvedMove = { key: d.key, def: d, amount: w.skill.reps, load: w.skill.load ?? null }
  return [{ t: 'rep', n: w.skill.sets, steps: [{ ...exStep(r), note: `Skill · ${exStep(r).note}` }, { t: 'rest', sec: 90 }] }]
}

export const countSteps = (s: GStep[]): number => s.reduce((n, x) => n + (x.t === 'rep' ? 1 + countSteps(x.steps) : 1), 0)
export const GARMIN_MAX = 100

/** Un ou deux entraînements Garmin (découpe au-delà de 100 étapes). */
export function garminWorkouts(w: Wod, level: Level) {
  const warm = w.warmup ? mobilitySteps(w.warmup.protocol, w.warmup.minutes) : []
  const skill = skillSteps(w)
  const wod = wodSteps(w, level)
  const cool = w.cooldown ? mobilitySteps(w.cooldown.protocol, w.cooldown.minutes) : []
  const all = [...warm, ...skill, ...wod, ...cool]
  if (countSteps(all) <= GARMIN_MAX) return [{ name: w.name, steps: all }]
  return [{ name: `${w.name} (1/2)`, steps: [...warm, ...skill] }, { name: `${w.name} (2/2)`, steps: [...wod, ...cool] }]
}

// ---------- Description lisible ----------

export function formatLine(w: Wod) {
  switch (w.format) {
    case 'amrap': return `AMRAP ${w.minutes ?? 12}'`
    case 'emom': return `EMOM ${w.minutes ?? 12}'${w.every && w.every !== 60 ? ` · toutes les ${w.every} s` : ''}`
    case 'tabata': return `Tabata · ${w.moves.length} × 4'`
    case 'intervals': return `${w.rounds ?? 3} tours · ${w.intervals === 'amrap' ? `AMRAP ${Math.round((w.work ?? 180) / 60)}'` : `${w.work ?? 60} s par atelier`} · repos ${w.rest ?? 60} s`
    case 'strength': return `Force · ${w.scheme ? w.scheme.join('-') : `${w.rounds ?? 5} × ${w.moves[0]?.reps ?? ''}`}`
    case 'chipper': return `Chipper${w.cap ? ` · cap ${w.cap}'` : ''}`
    default: return `For Time${w.scheme ? ' ' + w.scheme.join('-') : w.rounds && w.rounds > 1 ? ` · ${w.rounds} tours` : ''}${w.cap ? ` · cap ${w.cap}'` : ''}`
  }
}

// ---------- Lecture d'un WOD texte (CrossFit.com ou collé) ----------

const ALIASES = Object.values(WMOVES)
  .filter((d) => d.key !== 'rest')
  .flatMap((d) => d.alias.map((a) => ({ key: d.key, re: new RegExp(`\\b${a}\\b`, 'i'), len: a.length })))
  .sort((a, b) => b.len - a.len)

const lbToKg = (lb: number) => round(lb * 0.4536, 2.5)

export function parseWod(text: string, name = 'WOD importé'): { wod: Wod; unknown: string[] } {
  const t = text.replace(/\r/g, '').replace(/(\d),(\d{3})/g, '$1$2')
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  const low = t.toLowerCase()
  const wod: Wod = { id: 'w-' + Date.now(), name, format: 'fortime', moves: [], source: text }
  let m: RegExpMatchArray | null
  if ((m = low.match(/as many rounds(?: and reps)? as possible in (\d+) min/)) || (m = low.match(/amrap\s*(?:in\s*)?(\d+)/))) { wod.format = 'amrap'; wod.minutes = +m[1] }
  else if ((m = low.match(/every minute on the minute for (\d+) min/)) || (m = low.match(/emom\s*(?:for\s*)?(\d+)/))) { wod.format = 'emom'; wod.minutes = +m[1]; wod.emom = 'alternate' }
  else if (/tabata/.test(low)) wod.format = 'tabata'
  else if ((m = low.match(/(\d+) rounds? for time/)) || (m = low.match(/(\d+) rounds? of/))) { wod.format = 'fortime'; wod.rounds = +m[1] }
  else if (/for time/.test(low)) wod.format = 'chipper'
  if ((m = low.match(/(\d+(?:-\d+)+)\s*reps? (?:for time|of)/)) || (m = low.match(/^(\d+(?:-\d+){2,})\s*$/m))) {
    wod.scheme = m[1].split('-').map(Number); wod.format = 'fortime'; wod.rounds = undefined
  }
  if ((m = low.match(/time cap[:\s]*(\d+)/))) wod.cap = +m[1]
  // ateliers chronométrés : « 1 minute of wall-ball shots »
  const stations = lines.filter((l) => /^\d+ minutes? of /i.test(l))
  if (stations.length >= 2) {
    wod.format = 'intervals'; wod.intervals = 'stations'; wod.work = parseInt(stations[0]) * 60
    wod.rounds = (m = low.match(/(\d+) rounds?/)) ? +m[1] : 1
    const r = low.match(/rest (\d+) minutes?/); wod.rest = r ? +r[1] * 60 : 60
  }
  // force : « Front squat 3-3-3-3-3 reps » ou « Deadlift 5-3-1-5-3-1 reps »
  const strength = low.match(/^([a-z][a-z \-]+?)\s+(\d+(?:-\d+){2,})\s*reps?\s*$/m)
  if (strength) {
    const sets = strength[2].split('-').map(Number)
    wod.format = 'strength'; wod.rounds = sets.length; wod.rest = 180
    wod.scheme = new Set(sets).size > 1 ? sets : undefined
    const hit = ALIASES.find((a) => a.re.test(strength[1]))
    if (hit) wod.moves.push({ key: hit.key, reps: wod.scheme ? null : sets[0] })
  }
  const loads: number[] = []
  for (const l of lines) {
    const male = l.match(/♂\s*(?:\*\*)?\s*([\d/.,\s]+)\s*(lb|kg)/i) || l.match(/men:?\s*([\d/]+)\s*(lb|kg)/i)
    if (male) male[1].split('/').map((x) => parseFloat(x)).filter((x) => !isNaN(x)).forEach((x) => loads.push(male[2].toLowerCase() === 'lb' ? lbToKg(x) : x))
  }
  const unknown: string[] = []
  if (!strength) {
    for (const l of lines) {
      if (/rounds? (for|of)|for time|for max|as many|every minute|^post |^use |♀|♂|rest day|compare|time cap|^\d+(-\d+)+\s*(reps)?|tabata|^rest /i.test(l)) continue
      const n = l.replace(/^(\d+)\/(\d+)/, '$2').match(/^(\d+)(?:[- ]?(calorie|cal|meter|metre|m|minutes? of)s?\b)?[- ]?(.*)$/i)
      if (!n && !/^[a-z]/i.test(l)) continue
      const body = n ? n[3] : l
      const hit = ALIASES.find((a) => a.re.test(`${n?.[2] ?? ''} ${body}`))
      if (!hit) { if (n) unknown.push(l); continue }
      let key = hit.key
      const unitWord = n?.[2]?.toLowerCase()
      if (unitWord?.startsWith('cal')) key = key === 'row' ? 'row-cal' : /bike/i.test(body) ? 'bike-cal' : /ski/i.test(body) ? 'ski-cal' : key
      const kgM = body.match(/\(?(\d+(?:\.\d+)?)\s*(lb|kg)/i)
      const isStation = /minute/i.test(n?.[2] ?? '')
      wod.moves.push({ key, reps: n && !isStation ? +n[1] : null, load: kgM ? (kgM[2].toLowerCase() === 'lb' ? lbToKg(+kgM[1]) : +kgM[1]) : undefined })
    }
  }
  // charges RX homme : on les distribue aux mouvements chargés sans charge
  if (loads.length) {
    let i = 0
    wod.moves.forEach((mv) => { const d = WMOVES[mv.key]; if (d.load && mv.load == null) { mv.load = loads[Math.min(i, loads.length - 1)]; if (loads.length > 1) i++ } })
  }
  // un même mouvement avec poids 1/2/3 sur un schéma : on garde la première ligne
  if (wod.scheme) {
    const seen = new Set<string>()
    wod.moves = wod.moves.filter((mv) => { if (seen.has(mv.key)) return false; seen.add(mv.key); mv.reps = null; return true })
  }
  if (wod.format === 'emom' && wod.moves.length === 0) wod.emom = 'all'
  return { wod, unknown }
}

// ---------- Mes WOD (repo privé) ----------

export const MINE_PATH = 'data/wod/mine.json'
export interface MineFile { wods: Wod[] }
export const loadMine = (c: RepoConfig) => readJsonWithSha<MineFile>(c, MINE_PATH, { wods: [] })
export const saveMine = (c: RepoConfig, f: MineFile, sha: string | null, msg: string) => writeJson(c, MINE_PATH, f, sha, msg)

export interface CfWod { id: string; date: string; title: string; url: string; rest: boolean; workout: string; stimulus: string | null; intermediate: string | null; beginner: string | null; resources: { url: string; name: string }[] }

export async function sendWod(c: RepoConfig, w: Wod, level: Level, date: string | null) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const payload = { name: w.name, date, description: `Hybrid Forge · ${formatLine(w)} · ${LEVELS.find((l) => l.id === level)!.label}`, workouts: garminWorkouts(w, level) }
  await writeJson(c, `outbox/workouts/${stamp}.json`, payload, null, `wod: envoi ${w.name}`)
}
