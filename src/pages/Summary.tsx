import { useState } from 'react'
import { Rings, ScoreRing } from '../components/Ring'
import {
  addDays, CATEGORY_META, categorize, currentMacro, DAY_SHORT, formatDuration, isoDay, mondayOf,
  parseDay, RING_TARGETS, sessionsOf, type AppData, type HealthDay, type Session,
} from '../lib/data'
import { triggerSync, type RepoConfig } from '../lib/github'

const MONTHS = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE']
const WEEKDAYS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI']

const READINESS_TEXT: Record<string, string> = {
  PRIME: 'Au top, feu vert pour l\'intensité',
  HIGH: 'Bien récupéré',
  MODERATE: 'Récupération correcte, intensité modérée',
  LOW: 'Fatigue : privilégier l\'endurance ou la mobilité',
  POOR: 'Récupération insuffisante : séance légère ou repos',
}
const HRV_TEXT: Record<string, string> = {
  BALANCED: 'HRV dans ta zone habituelle',
  UNBALANCED: 'HRV en dehors de ta zone habituelle',
  LOW: 'HRV sous ta zone habituelle',
  POOR: 'HRV très basse',
}

function latestWith(health: Record<string, HealthDay>, key: keyof HealthDay, today: string) {
  const days = Object.keys(health).filter((d) => d <= today).sort().reverse()
  for (const d of days) if (health[d][key] != null) return { day: d, v: health[d] }
  return null
}

export function Summary({ data, config }: { data: AppData; config: RepoConfig }) {
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const now = new Date()
  const today = isoDay(now)
  const rules = data.profile?.activityRules
  const macro = currentMacro(data.profile, now)

  // ---- État de forme
  const h = data.health[today] ?? {}
  const rd = latestWith(data.health, 'readiness', today)
  const readiness = rd?.v.readiness ?? null
  const level = rd?.v.readinessLevel ?? null
  const readinessColor = readiness == null ? '#3f3f46' : readiness >= 75 ? 'var(--good)' : readiness >= 50 ? 'var(--warn)' : 'var(--bad)'
  const hrvSpark = Array.from({ length: 14 }, (_, i) => {
    const d = isoDay(addDays(now, i - 13))
    return { d, v: data.health[d]?.hrv ?? null, low: data.health[d]?.hrvBaseLow ?? null }
  })
  const hrvMax = Math.max(1, ...hrvSpark.map((x) => x.v ?? 0))

  // ---- Semaine en cours
  const monday = mondayOf(now)
  const weekStart = isoDay(monday)
  const weekEnd = isoDay(addDays(monday, 6))
  const weekActs = data.activities.filter((a) => a.start.slice(0, 10) >= weekStart && a.start.slice(0, 10) <= weekEnd)
  const weekSessions = sessionsOf(weekActs, rules)
  const count = (c: Session['category']) => weekSessions.filter((s) => s.category === c).length
  const runMin = Math.round(weekSessions.filter((s) => s.category === 'run').reduce((t, s) => t + s.durationS, 0) / 60)
  const ringData = (['run', 'strength', 'wod', 'mobility'] as const).map((c) => ({ c, n: count(c), target: RING_TARGETS[c] }))

  // ---- Séance du jour
  const todayPlanned = data.calendar.filter((c) => c.date === today)
  const todayDone = sessionsOf(weekActs.filter((a) => a.start.startsWith(today)), rules).filter((s) => s.category !== 'warmup')

  // ---- Charge 6 semaines
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const m = addDays(monday, (i - 5) * 7)
    const s = isoDay(m), e = isoDay(addDays(m, 6))
    const load = data.activities
      .filter((a) => a.start.slice(0, 10) >= s && a.start.slice(0, 10) <= e && categorize(a, rules) !== 'other')
      .reduce((t, a) => t + (a.load || 0), 0)
    const mc = currentMacro(data.profile, m)
    return { label: mc ? `W${mc.week}` : `${m.getDate()}/${m.getMonth() + 1}`, load: Math.round(load), cur: i === 5 }
  })
  const loadMax = Math.max(1, ...weeks.map((w) => w.load))

  // ---- Dernières séances
  const recent = sessionsOf(data.activities.slice(0, 60), rules).filter((s) => s.category !== 'warmup').reverse().slice(0, 5)

  async function sync() {
    setSyncMsg('Envoi…')
    const ok = await triggerSync(config)
    setSyncMsg(ok ? 'Synchro lancée, les données arrivent d\'ici 1 à 2 min.' : 'Impossible de lancer la synchro : le jeton doit avoir la permission Actions en écriture.')
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="overline">{WEEKDAYS[now.getDay()]} {now.getDate()} {MONTHS[now.getMonth()]}</div>
          <h1>Résumé</h1>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {macro && <span className="pill accent">{macro.macro.id} {macro.macro.name} · W{macro.week}</span>}
          <button className="btn ghost" style={{ height: 34, fontSize: 13 }} onClick={sync}>Synchroniser</button>
        </div>
      </header>
      {syncMsg && <div className="notice">{syncMsg}</div>}

      <div className="grid">
        {/* État de forme */}
        <section className="card">
          <span className="overline">État de forme</span>
          <div className="row">
            <ScoreRing value={readiness} color={readinessColor} caption="READINESS" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{level ? READINESS_TEXT[level] ?? level : 'Pas encore de score'}</span>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
                {h.hrvStatus ? HRV_TEXT[h.hrvStatus] ?? h.hrvStatus : 'HRV non disponible'}
                {h.hrvBaseLow != null && h.hrvBaseHigh != null ? ` (zone ${h.hrvBaseLow}-${h.hrvBaseHigh} ms)` : ''}.
                {rd && rd.day !== today ? ` Score du ${rd.day.slice(8)}/${rd.day.slice(5, 7)}.` : ''}
              </span>
            </div>
          </div>
          <div className="spark" role="img" aria-label="HRV des 14 derniers jours">
            {hrvSpark.map((x) => (
              <div key={x.d} title={`${x.d} : ${x.v ?? '–'} ms`} style={{ height: `${x.v ? (x.v / hrvMax) * 100 : 4}%`, background: x.v == null ? '#27272a' : x.low != null && x.v < x.low ? 'var(--warn)' : 'var(--good)' }} />
            ))}
          </div>
          <div className="stats3">
            <div className="stat"><span className="k">HRV nuit</span><span className="v">{h.hrv ?? '–'}<small> ms</small></span></div>
            <div className="stat"><span className="k">Sommeil</span><span className="v">{h.sleepS ? formatDuration(h.sleepS) : '–'}{h.sleepScore ? <small> · {h.sleepScore}</small> : null}</span></div>
            <div className="stat"><span className="k">FC repos</span><span className="v">{h.rhr ?? '–'}<small> bpm</small></span></div>
          </div>
        </section>

        {/* Séance du jour */}
        <section className="card">
          <div className="between">
            <span className="overline">Séance du jour</span>
            <span className="small" style={{ color: 'var(--lift)', fontWeight: 600 }}>Calendrier Garmin</span>
          </div>
          {todayDone.map((s) => (
            <div key={s.start} className="row">
              <span className="dot" style={{ background: CATEGORY_META[s.category].color, width: 12, height: 12, borderRadius: 6 }} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>✓ {s.activities.map((a) => a.name).join(' + ')}</span>
                <span className="muted small">{formatDuration(s.durationS)} · charge {Math.round(s.load)}</span>
              </div>
            </div>
          ))}
          {todayPlanned.map((p) => (
            <div key={`${p.workoutId}-${p.date}`} className="row">
              <span className="dot" style={{ background: 'var(--lift)', width: 12, height: 12, borderRadius: 6 }} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</span>
                <span className="muted small">{p.durationS ? formatDuration(p.durationS) : ''} {p.sport ?? ''}</span>
              </div>
            </div>
          ))}
          {!todayDone.length && !todayPlanned.length && (
            <div className="empty">Rien de planifié aujourd'hui dans le calendrier Garmin. Le générateur de séances arrivera avec l'écran Plan.</div>
          )}
        </section>

        {/* Anneaux */}
        <section className="card">
          <span className="overline">Anneaux de la semaine</span>
          <div className="row">
            <Rings
              label={ringData.map((r) => `${CATEGORY_META[r.c].label} ${r.n} sur ${r.target}`).join(', ')}
              rings={ringData.map((r) => ({ value: r.n / r.target, color: CATEGORY_META[r.c].color, track: '#26262a' }))}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              {ringData.map((r) => (
                <div key={r.c} className="between">
                  <span style={{ fontSize: 13, fontWeight: 600, color: CATEGORY_META[r.c].color }}>{CATEGORY_META[r.c].label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{r.n}/{r.target}{r.c === 'run' && runMin ? ` · ${runMin}'` : ''}</span>
                </div>
              ))}
            </div>
          </div>
          <span className="small muted">Garmin + Apple Watch (doublons écartés). Balades exclues, blocs échauffement / cooldown regroupés avec leur séance.</span>
        </section>
      </div>

      {/* Semaine */}
      <section className="card">
        <span className="overline">Ma semaine</span>
        <div className="week">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(monday, i)
            const ds = isoDay(d)
            const sess = sessionsOf(weekActs.filter((a) => a.start.startsWith(ds)), rules).filter((s) => s.category !== 'warmup')
            const planned = data.calendar.filter((c) => c.date === ds)
            if (i >= 5 && !sess.length && !planned.length) return null
            return (
              <div key={ds} className={`day ${ds === today ? 'today' : ''}`}>
                <div className="between">
                  <span className="small muted" style={{ fontWeight: 600 }}>{DAY_SHORT[i]} {d.getDate()}</span>
                  {sess.length > 0 && <span className="small" style={{ color: 'var(--good)', fontWeight: 700 }}>FAIT</span>}
                  {ds === today && !sess.length && <span className="small" style={{ color: 'var(--lift)', fontWeight: 700 }}>AUJOURD'HUI</span>}
                </div>
                {sess.map((s) => (
                  <div key={s.start} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="row" style={{ gap: 8 }}><span className="dot" style={{ background: CATEGORY_META[s.category].color }} /><span style={{ fontWeight: 700, fontSize: 14 }}>{s.activities.filter((a) => categorize(a, rules) !== 'warmup').map((a) => a.name).join(' + ') || s.activities[0].name}</span></div>
                    <span className="small muted">{formatDuration(s.durationS)}{s.activities[0].avgHR ? ` · ${s.activities[0].avgHR} bpm` : ''}</span>
                  </div>
                ))}
                {planned.map((p) => (
                  <div key={`${p.workoutId}`} className="row" style={{ gap: 8 }}><span className="dot" style={{ background: 'var(--surface-3)' }} /><span style={{ fontSize: 14 }}>{p.name}</span></div>
                ))}
                {!sess.length && !planned.length && <span className="small muted">Repos</span>}
                {sess.length > 0 && <span className="tag">{[...new Set(sess.flatMap((x) => x.activities.map((a) => (a.source === 'healthfit' ? 'Apple Watch' : 'Garmin'))))].join(' + ')}</span>}
              </div>
            )
          })}
        </div>
      </section>

      <div className="grid">
        {/* Objectifs */}
        <section className="card">
          <span className="overline">Objectifs</span>
          {(data.profile?.goals ?? []).map((g) => {
            let pct = 0
            let right = ''
            if (g.metric === 'halfMarathonS' && !g.target) {
              right = 'repoussé · date à fixer'
            } else if (g.metric === 'halfMarathonS') {
              const m = data.profile?.goals.find((x) => x.id === g.id)?.milestone
              const target = g.target ? parseDay(`${g.target}-15`) : null
              const wk = target ? Math.max(0, Math.round((target.getTime() - now.getTime()) / (7 * 86400000))) : null
              right = wk != null ? `dans ${wk} sem.` : ''
              pct = macro ? Math.min(1, (now.getTime() - parseDay(data.profile!.macrocycles[0].start).getTime()) / ((target?.getTime() ?? 1) - parseDay(data.profile!.macrocycles[0].start).getTime())) : 0
              if (m) right += ` · test ${m.date.slice(8)}/${m.date.slice(5, 7)}`
            } else {
              const start = g.startValue ?? 0
              const cur = g.currentValue ?? start
              pct = g.targetValue === start ? 0 : Math.max(0, Math.min(1, (cur - start) / (g.targetValue - start)))
              right = g.metric === 'weightKg' ? `${cur} kg` : `${cur} / ${g.targetValue}`
            }
            const color = g.id === 'semi' ? 'var(--run)' : g.id === 'pullups' ? 'var(--lift)' : 'var(--mobility)'
            return (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="between" style={{ fontSize: 14 }}><span>{g.label}</span><span className="muted">{right}</span></div>
                <div className="bar"><div style={{ width: `${Math.max(2, pct * 100)}%`, background: color }} /></div>
              </div>
            )
          })}
          {!data.profile && <div className="empty">Profil absent du repo de données.</div>}
        </section>

        {/* Charge */}
        <section className="card">
          <div className="between">
            <span className="overline">Charge d'entraînement · 6 semaines</span>
            {data.status.vo2max && <span className="small muted">VO2max {data.status.vo2max}</span>}
          </div>
          <div className="loadbars" role="img" aria-label={weeks.map((w) => `${w.label} ${w.load}`).join(', ')}>
            {weeks.map((w) => (
              <div key={w.label}>
                <span className="small muted">{w.load || ''}</span>
                <div className={`b ${w.cur ? 'cur' : ''}`} style={{ height: `${Math.max(3, (w.load / loadMax) * 80)}%` }} />
                <span className="small muted">{w.label}</span>
              </div>
            ))}
          </div>
          <span className="small muted">Somme de la charge Garmin des séances (hors balades).</span>
        </section>

        {/* Dernières séances */}
        <section className="card">
          <span className="overline">Dernières séances</span>
          {recent.length === 0 && <div className="empty">Aucune séance synchronisée.</div>}
          {recent.map((s) => (
            <div key={s.start} className="list-row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{s.activities.filter((a) => categorize(a, rules) !== 'warmup').map((a) => a.name).join(' + ') || s.activities[0].name}</span>
                <span className="small muted">{s.start.slice(8, 10)}/{s.start.slice(5, 7)} · {s.activities[0].source === 'healthfit' ? 'Apple Watch · ' : ''}{formatDuration(s.durationS)}{s.activities[0].avgHR ? ` · FC ${s.activities[0].avgHR}` : ''}</span>
              </div>
              <span className="small" style={{ fontWeight: 600, color: CATEGORY_META[s.category].color, whiteSpace: 'nowrap' }}>{CATEGORY_META[s.category].label}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
