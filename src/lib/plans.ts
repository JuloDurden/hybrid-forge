import raw from '../data/plans.json'
import { addDays, categorize, isoDay, parseDay, type Activity, type AppData } from './data'
import { readJsonWithSha, writeJson, type RepoConfig } from './github'
import { fitToDuration, PROTOCOLS } from './mobility'
import { garminWorkouts, type GStep, type Wod } from './wod'

// ---------- Modèles ----------

export type Kind = 'run' | 'long' | 'strength' | 'pull' | 'mobility' | 'wod'
export interface RunSpec { warm: number; reps: number; on: number; off: number; cool: number; hr: [number, number] }
export interface SessionT {
  d: number; kind: Kind; title: string; detail: string | null; min: number; key: boolean
  run?: RunSpec; wod?: Partial<Wod>; mob?: { protocol: string; minutes: number }
}
export interface WeekT { n: number; criteria: { sessions: number; pain: number; runHr: number }; sessions: SessionT[] }
export interface PlanT {
  id: string; name: string; weeks_label: string; per_week: string; color: string; desc: string; tags: string[]
  draft?: boolean; combinable?: boolean; gates?: string[]; rules?: string[]
  phases?: { name: string; weeks: number[]; color: string }[]; weeks?: WeekT[]
}
export const PLANS = raw as unknown as PlanT[]
export const COLOR: Record<string, string> = { lime: 'var(--mobility)', blue: 'var(--lift)', pink: 'var(--wod)', orange: 'var(--run)' }
export const KIND_COLOR: Record<Kind, string> = { run: 'var(--run)', long: 'var(--run)', strength: 'var(--lift)', pull: 'var(--wod)', mobility: 'var(--mobility)', wod: 'var(--wod)' }

// ---------- État (repo privé) ----------

export interface Override { date?: string; min?: number; note?: string; mobility?: boolean }
export interface PlanState {
  active: { planId: string; start: string; paused?: boolean; repeats: number[] } | null
  pain: Record<string, number>
  gates: { leg?: boolean; doctor?: boolean }
  decisions: Record<string, 'accepted' | 'refused'>
  overrides: Record<string, Override>
  history: { planId: string; start: string; end: string; status: string }[]
}
export const EMPTY: PlanState = { active: null, pain: {}, gates: {}, decisions: {}, overrides: {}, history: [] }
export const STATE_PATH = 'data/plans/state.json'
export const loadState = (c: RepoConfig) => readJsonWithSha<PlanState>(c, STATE_PATH, EMPTY)
export const saveState = (c: RepoConfig, s: PlanState, sha: string | null, msg: string) => writeJson(c, STATE_PATH, s, sha, msg)

// ---------- Calendrier du plan ----------

export const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))
export function nextMonday(d = new Date()) { const m = mondayOf(d); return isoDay(d.getDay() === 1 ? m : addDays(m, 7)) }

/** Suite des semaines du modèle, avec les semaines refaites insérées. */
export function weekSequence(p: PlanT, repeats: number[]) {
  const seq = (p.weeks ?? []).map((w) => w.n)
  for (const idx of [...repeats].sort((a, b) => a - b)) if (idx < seq.length) seq.splice(idx + 1, 0, seq[idx])
  return seq
}

export type Status = 'ok' | 'warn' | 'missed' | 'today' | 'planned' | 'moved'
export interface Instance {
  id: string; seq: number; week: WeekT; t: SessionT; date: string; baseDate: string
  status: Status; activity?: Activity; ov?: Override; min: number; note?: string
}

const CAT: Record<Kind, string[]> = { run: ['run'], long: ['run'], strength: ['strength', 'wod'], pull: ['strength', 'wod'], wod: ['wod', 'strength'], mobility: ['mobility', 'warmup'] }

export function buildCalendar(p: PlanT, st: PlanState, data: AppData) {
  const a = st.active!
  const seq = weekSequence(p, a.repeats)
  const start = parseDay(a.start)
  const today = isoDay(new Date())
  const used = new Set<string>()
  const byDay = new Map<string, Activity[]>()
  for (const act of data.activities) {
    const d = act.start.slice(0, 10)
    byDay.set(d, [...(byDay.get(d) ?? []), act])
  }
  const weeks = seq.map((n, i) => {
    const week = p.weeks!.find((w) => w.n === n)!
    const monday = addDays(start, 7 * i)
    const inst: Instance[] = week.sessions.map((t, k) => {
      const id = `${i}-${n}-${k}`
      const ov = st.overrides[id]
      const baseDate = isoDay(addDays(monday, t.d))
      const date = ov?.date ?? baseDate
      const cats = ov?.mobility ? CAT.mobility : CAT[t.kind]
      const act = (byDay.get(date) ?? []).find((x) => !used.has(String(x.id)) && cats.includes(categorize(x, data.profile?.activityRules)))
      let status: Status = date < today ? 'missed' : date === today ? 'today' : 'planned'
      if (act) {
        used.add(String(act.id))
        status = 'ok'
        if (t.run && !ov?.mobility && act.avgHR && act.avgHR > t.run.hr[1] + 3) status = 'warn'
      }
      return { id, seq: i, week, t, date, baseDate, status, activity: act, ov, min: ov?.min ?? t.min, note: ov?.note }
    })
    inst.sort((x, y) => x.date.localeCompare(y.date))
    return { i, n, week, monday: isoDay(monday), end: isoDay(addDays(monday, 6)), inst }
  })
  const cur = Math.max(0, weeks.findIndex((w) => today <= w.end))
  const finished = weeks.length > 0 && today > weeks[weeks.length - 1].end
  return { weeks, cur: finished ? weeks.length - 1 : cur, finished, today }
}
export type Calendar = ReturnType<typeof buildCalendar>

// ---------- Critères de passage ----------

export function painMax(st: PlanState, from: string, to: string) {
  let m: number | null = null
  for (const [d, v] of Object.entries(st.pain)) if (d >= from && d <= to) m = Math.max(m ?? 0, v)
  return m
}

export function criteria(w: Calendar['weeks'][number], st: PlanState) {
  const done = w.inst.filter((x) => x.status === 'ok' || x.status === 'warn').length
  const runs = w.inst.filter((x) => x.t.run && !x.ov?.mobility && (x.status === 'ok' || x.status === 'warn'))
  const runsOk = runs.filter((x) => x.status === 'ok').length
  const plannedRuns = w.inst.filter((x) => x.t.run && !x.ov?.mobility).length
  const pain = painMax(st, w.monday, isoDay(addDays(parseDay(w.end), 1)))
  const c = w.week.criteria
  const items = [
    { label: 'Séances faites', value: `${done} / ${w.inst.length}`, ok: done >= c.sessions, need: `${c.sessions} mini` },
    { label: 'Douleur max (semaine et lendemain)', value: pain == null ? 'non notée' : `${pain} / 10`, ok: pain == null ? null : pain <= c.pain, need: `≤ ${c.pain}` },
    { label: `Courses sous la FC cible`, value: `${runsOk} / ${plannedRuns}`, ok: plannedRuns === 0 ? true : runsOk / plannedRuns >= c.runHr, need: `${Math.ceil(plannedRuns * c.runHr)} mini` },
  ]
  return { items, pass: items.every((x) => x.ok !== false) }
}

// ---------- Ajustements proposés ----------

export interface Adjust {
  id: string; kind: 'missed' | 'target' | 'form' | 'pain' | 'week'
  title: string; why: string; change: string
  apply: (s: PlanState) => PlanState
}

const fmtDay = (d: string) => parseDay(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })

export function proposals(_p: PlanT, st: PlanState, cal: Calendar, data: AppData): Adjust[] {
  const out: Adjust[] = []
  const w = cal.weeks[cal.cur]
  if (!w || cal.finished) return out
  const today = cal.today
  const freeDays = (wk: typeof w) => {
    const res: string[] = []
    for (let d = 0; d < 5; d++) {
      const day = isoDay(addDays(parseDay(wk.monday), d))
      if (day < today) continue
      const there = wk.inst.filter((x) => x.date === day)
      if (there.every((x) => x.t.kind === 'mobility')) res.push(day)
    }
    return res
  }
  // 1. séance clé manquée -> déplacer sur un jour léger
  for (const x of w.inst.filter((i) => i.status === 'missed' && i.t.key && !i.ov?.date)) {
    const free = freeDays(w)[0]
    const id = `move-${x.id}`
    if (st.decisions[id]) continue
    if (free) out.push({ id, kind: 'missed', title: `${x.t.title} de ${fmtDay(x.date)}`, why: 'Séance clé du plan. Il reste un jour léger dans la semaine.',
      change: `La déplacer au ${fmtDay(free)}. Rien d'autre ne bouge.`, apply: (s) => ({ ...s, overrides: { ...s.overrides, [x.id]: { ...s.overrides[x.id], date: free } } }) })
    else out.push({ id, kind: 'missed', title: `${x.t.title} de ${fmtDay(x.date)}`, why: 'Séance clé, mais plus de jour léger cette semaine.',
      change: 'La laisser tomber, sans la rattraper en doublant une journée.', apply: (s) => s })
  }
  // 2. course au-dessus de la FC cible -> la suivante plus lente
  for (const x of w.inst.filter((i) => i.status === 'warn')) {
    const id = `slow-${x.id}`
    if (st.decisions[id]) continue
    const next = w.inst.find((i) => i.t.run && i.date > x.date && (i.status === 'planned' || i.status === 'today'))
    out.push({ id, kind: 'target', title: `${x.t.title} de ${fmtDay(x.date)}`, why: `FC moyenne ${x.activity?.avgHR} pour une cible < ${x.t.run!.hr[1]}.`,
      change: next ? `Faire « ${next.t.title} » à allure plus lente, quitte à marcher plus : la FC passe avant l'allure.` : 'Rester sur cette durée la semaine prochaine, allure plus lente.',
      apply: (s) => next ? ({ ...s, overrides: { ...s.overrides, [next.id]: { ...s.overrides[next.id], note: 'Allure plus lente : FC < ' + next.t.run!.hr[1] + ' avant tout' } } }) : s })
  }
  // 3. douleur >= 4 -> prochaine séance remplacée par la mobilité sciatique
  const recent = [today, isoDay(addDays(new Date(), -1))].map((d) => st.pain[d]).filter((v) => v != null)
  if (recent.some((v) => v >= 4)) {
    const next = w.inst.find((i) => (i.status === 'today' || i.status === 'planned') && i.t.kind !== 'mobility' && !i.ov?.mobility)
    const id = `pain-${today}`
    if (next && !st.decisions[id]) out.push({ id, kind: 'pain', title: `Douleur notée ${Math.max(...recent)}/10`, why: 'Au-dessus de 3/10, on ne charge pas : on calme d\'abord.',
      change: `Remplacer « ${next.t.title} » (${fmtDay(next.date)}) par la mobilité sciatique 15'.`,
      apply: (s) => ({ ...s, overrides: { ...s.overrides, [next.id]: { ...s.overrides[next.id], mobility: true, min: 15 } } }) })
  }
  // 4. HRV sous la normale 3 jours -> séance du jour raccourcie
  const days = [0, 1, 2].map((k) => data.health[isoDay(addDays(new Date(), -k))])
  if (days.every((h) => h?.hrv && h.hrvBaseLow && h.hrv < h.hrvBaseLow)) {
    const next = w.inst.find((i) => (i.status === 'today' || i.status === 'planned') && i.t.kind !== 'mobility')
    const id = `hrv-${today}`
    if (next && !st.decisions[id]) {
      const min = Math.round(next.min * 0.8 / 5) * 5
      out.push({ id, kind: 'form', title: 'HRV sous ta normale depuis 3 jours', why: `Variabilité cardiaque ${days[0]!.hrv} ms pour une normale de ${days[0]!.hrvBaseLow} à ${days[0]!.hrvBaseHigh} ms.`,
        change: `« ${next.t.title} » raccourcie à ${min}' au lieu de ${next.min}'.`, apply: (s) => ({ ...s, overrides: { ...s.overrides, [next.id]: { ...s.overrides[next.id], min } } }) })
    }
  }
  // 5. semaine précédente ratée -> la refaire plutôt qu'avancer
  const prev = cal.weeks[cal.cur - 1]
  if (prev) {
    const c = criteria(prev, st)
    const id = `repeat-${prev.i}`
    const started = w.inst.some((x) => x.status === 'ok' || x.status === 'warn')
    if (!c.pass && !st.decisions[id] && !started) out.push({ id, kind: 'week', title: `Semaine ${prev.n} non validée`, why: c.items.filter((x) => x.ok === false).map((x) => `${x.label} : ${x.value}`).join(' · '),
      change: `Refaire la semaine ${prev.n} cette semaine au lieu de passer à la semaine ${w.n}. La suite du plan est décalée d'une semaine.`,
      apply: (s) => ({ ...s, active: s.active && { ...s.active, repeats: [...s.active.repeats, prev.i] } }) })
  }
  return out
}

// ---------- Feux de reprise ----------

export function gates(st: PlanState, data: AppData) {
  const from = isoDay(addDays(new Date(), -6))
  const mob = data.activities.filter((a) => a.start.slice(0, 10) >= from && categorize(a, data.profile?.activityRules) === 'mobility').length
  const pains = Object.entries(st.pain).filter(([d]) => d >= from).map(([, v]) => v)
  return [
    { label: 'Mobilité sciatique faite au moins 4 fois sur 7 jours', ok: mob >= 4, info: `${mob} / 4`, auto: true },
    { label: 'Douleur ≤ 2/10 depuis 7 jours', ok: pains.length >= 5 && pains.every((v) => v <= 2), info: pains.length ? `max ${Math.max(...pains)}/10 · ${pains.length} notes` : 'à noter chaque jour', auto: true },
    { label: 'Plus de douleur qui descend dans la jambe', ok: !!st.gates.leg, key: 'leg' as const },
    { label: 'Feu vert du médecin ou du kiné', ok: !!st.gates.doctor, key: 'doctor' as const },
  ]
}

// ---------- Envoi Garmin ----------

export type RunStep = { t: 'warm' | 'run' | 'walk' | 'cool'; sec: number; hr?: [number, number] } | { t: 'rep'; n: number; steps: RunStep[] }

export function instanceJob(x: Instance) {
  const name = x.t.title
  const description = `Hybrid Forge · ${x.t.detail ?? ''}${x.note ? ' · ' + x.note : ''}`.slice(0, 200)
  if (x.ov?.mobility || x.t.kind === 'mobility') {
    const p = x.ov?.mobility ? 'cl-sciatique' : x.t.mob!.protocol
    const minutes = x.ov?.mobility ? 15 : x.t.mob!.minutes
    const steps: GStep[] = fitToDuration(PROTOCOLS.find((q) => q.id === p)!.steps, minutes).map((s) => ({ t: 'ex', g: s.move.garmin, sec: s.seconds, note: s.move.name + (s.side ? ` (${s.side})` : '') }))
    return { name: x.ov?.mobility ? 'Mobilité sciatique' : name, date: x.date, description, workouts: [{ name: x.ov?.mobility ? 'Mobilité sciatique' : name, steps }] }
  }
  if (x.t.run) {
    const r = x.t.run
    const k = x.min / x.t.min
    const on = Math.round((r.on * k) / 30) * 30 || 30
    const body: RunStep[] = r.off ? [{ t: 'rep', n: r.reps, steps: [{ t: 'run', sec: on, hr: r.hr }, { t: 'walk', sec: r.off }] }] : [{ t: 'run', sec: on, hr: r.hr }]
    return { name, date: x.date, description, workouts: [{ name, sport: 'running', steps: [{ t: 'warm', sec: r.warm }, ...body, { t: 'cool', sec: r.cool }] }] }
  }
  const w = { format: 'fortime', moves: [], ...(x.t.wod as Partial<Wod>), id: x.id, name } as Wod
  return { name, date: x.date, description, workouts: garminWorkouts(w, 'my') }
}

export async function sendJobs(c: RepoConfig, jobs: ReturnType<typeof instanceJob>[]) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  await writeJson(c, `outbox/workouts/${stamp}-plan.json`, { jobs }, null, `plan: envoi de ${jobs.length} séance(s)`)
}
