import { useEffect, useMemo, useRef, useState } from 'react'
import { BodyMap } from '../components/BodyMap'
import { addDays, CATEGORY_META, categorize, formatDuration, isoDay, mondayOf, parseDay, sessionsOf, type AppData, type Category, type Profile, type Session } from '../lib/data'
import { writeJson, type RepoConfig } from '../lib/github'
import { buildReverse, loadLibraryData, type ExerciseHistory, type Movement, type Overrides } from '../lib/library'
import { buildCalendar, loadState, PLANS, type Instance } from '../lib/plans'
import { blocks, fmtKg, topSet, loadFeel, loadSets, redoSteps, saveFeel, trend, volume, type ExerciseBlock, type Feel, type Trend } from '../lib/sessions'

type Filter = 'all' | 'run' | 'strength' | 'wod' | 'mobility' | 'walk'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' }, { id: 'run', label: 'Course' }, { id: 'strength', label: 'Muscu' }, { id: 'wod', label: 'WOD' }, { id: 'mobility', label: 'Mobilité' }, { id: 'walk', label: 'Marche' },
]
const TREND_COLOR: Record<Trend['kind'], string> = { record: 'var(--warn)', first: 'var(--muted)', up: 'var(--good)', same: 'var(--muted)', down: 'var(--bad)' }
const TREND_ICON: Record<Trend['kind'], string> = { record: '🏅', first: '✦', up: '↑', same: '=', down: '↓' }
const ZONE_COLORS = ['#64748b', 'var(--lift)', 'var(--good)', 'var(--run)', 'var(--bad)']
const sid = (s: Session) => String(s.activities[0].id)
const dayLabel = (d: string) => parseDay(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
const hm = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min` }
const sessName = (s: Session, rules: Profile['activityRules'] | undefined) =>
  s.activities.filter((a) => categorize(a, rules) !== 'warmup').map((a) => a.name).join(' + ') || s.activities[0].name

interface Lib { rev: Map<string, Movement>; fr: Record<string, string>; hist: Record<string, ExerciseHistory> }

export function Sessions({ config, data }: { config: RepoConfig; data: AppData }) {
  const rules = data.profile?.activityRules
  const [filter, setFilter] = useState<Filter>('all')
  const [showWalks, setShowWalks] = useState(false)
  const [month, setMonth] = useState(() => data.activities.find((a) => categorize(a, rules) !== 'walk')?.start.slice(0, 7) ?? isoDay(new Date()).slice(0, 7))
  const [sel, setSel] = useState<string | null>(null)
  const [lib, setLib] = useState<Lib | null>(null)
  const [feel, setFeel] = useState<Record<string, Feel>>({})
  const feelSha = useRef<string | null>(null)
  const [plan, setPlan] = useState<Instance[]>([])

  useEffect(() => {
    loadLibraryData(config).then((d) => setLib({ rev: buildReverse(d.lib, d.overrides as Overrides), fr: d.garminFr, hist: d.history })).catch(() => {})
    loadFeel(config).then((r) => { setFeel(r.data); feelSha.current = r.sha }).catch(() => {})
    loadState(config).then((r) => {
      const st = r.data
      const p = st.active && PLANS.find((x) => x.id === st.active!.planId)
      if (p && st.active) setPlan(buildCalendar(p, { ...st, overrides: st.overrides ?? {}, decisions: st.decisions ?? {} }, data).weeks.flatMap((w) => w.inst))
    }).catch(() => {})
  }, [config, data])

  const all = useMemo(() => sessionsOf(data.activities, rules).filter((s) => s.category !== 'warmup').sort((a, b) => b.start.localeCompare(a.start)), [data, rules])
  const months = useMemo(() => [...new Set(all.map((s) => s.start.slice(0, 7)))].sort().reverse(), [all])
  const inMonth = all.filter((s) => s.start.startsWith(month))
  const walks = inMonth.filter((s) => s.category === 'walk')
  const shown = inMonth.filter((s) => (filter === 'all' ? (showWalks || s.category !== 'walk') : s.category === filter))

  const byWeek = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of shown) { const k = isoDay(mondayOf(parseDay(s.start))); m.set(k, [...(m.get(k) ?? []), s]) }
    return [...m.entries()]
  }, [shown])

  async function saveOneFeel(id: string, f: Feel) {
    const next = { ...feel, [id]: f }
    setFeel(next)
    try { feelSha.current = await saveFeel(config, next, feelSha.current, `ressenti ${id}`) } catch { /* nouvel essai au prochain changement */ }
  }

  const selected = sel ? all.find((s) => sid(s) === sel) : null
  if (selected) return <Detail s={selected} config={config} data={data} lib={lib} feel={feel[sid(selected)] ?? {}} onFeel={(f) => saveOneFeel(sid(selected), f)} plan={plan} onBack={() => setSel(null)} />

  // ---- colonne de droite : mois
  const train = inMonth.filter((s) => s.category !== 'walk')
  const cats: Category[] = ['run', 'wod', 'strength', 'mobility']
  const maxN = Math.max(1, ...cats.map((c) => train.filter((s) => s.category === c).length))
  const first = parseDay(month + '-01')
  const nDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7

  return (
    <div className="sess">
      <div className="mob-head">
        <div><h1 style={{ margin: 0 }}>Séances</h1><span className="muted small">Tout ce que tu as fait, Garmin et Apple Watch réunis</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map((f) => <button key={f.id} className={`fchip ${filter === f.id ? 'on' : ''}`} style={filter !== f.id && f.id !== 'all' ? { color: CATEGORY_META[f.id as Category].color } : undefined} onClick={() => setFilter(f.id)}>{f.label}</button>)}
          <select className="fpill" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{parseDay(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</option>)}
          </select>
        </div>
      </div>
      <div className="mob-hero-row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '3 1 600px', gap: 10 }}>
          <div className="sess-head"><span style={{ flex: 1 }}>Séance</span><span>Durée</span><span>FC moy.</span><span className="sm">Charge</span></div>
          {byWeek.length === 0 && <div className="empty">Aucune séance pour ce filtre ce mois-ci.</div>}
          {byWeek.map(([monday, ss]) => (
            <div key={monday} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="between" style={{ padding: '6px 4px 0' }}>
                <strong className="small">Semaine du {parseDay(monday).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</strong>
                <span className="muted small">{ss.length} séance{ss.length > 1 ? 's' : ''} · {hm(ss.reduce((t, s) => t + s.durationS, 0))} · charge {Math.round(ss.reduce((t, s) => t + s.load, 0))}</span>
              </div>
              {ss.map((s) => {
                const src = [...new Set(s.activities.map((a) => (a.source === 'healthfit' ? 'Apple Watch' : 'Garmin')))].join(' + ')
                const hr = s.activities.find((a) => a.avgHR)?.avgHR
                const inPlan = plan.find((x) => s.activities.some((a) => a.id === x.activity?.id))
                return (
                  <button key={sid(s)} className="sess-row" onClick={() => setSel(sid(s))}>
                    <span className="sess-date">{dayLabel(s.start)}</span>
                    <span className="plan-kind" style={{ background: CATEGORY_META[s.category].color }} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <strong>{sessName(s, rules)}</strong>
                      <span className="muted small"><b style={{ color: CATEGORY_META[s.category].color }}>{CATEGORY_META[s.category].label}</b> · {s.start.slice(11, 16)} · {src}{s.activities.length > 1 ? ` · ${s.activities.length} blocs` : ''}</span>
                    </div>
                    {inPlan && <span className="pill" style={{ background: '#1f2a10', color: 'var(--mobility)' }}>Plan · {inPlan.t.title}</span>}
                    {feel[sid(s)]?.rpe && <span className="muted small">RPE {feel[sid(s)].rpe}</span>}
                    <span className="sess-num">{formatDuration(s.durationS)}</span>
                    <span className="sess-num muted">{hr ? `FC ${hr}` : '–'}</span>
                    <span className="sess-num muted sm">{Math.round(s.load) || '–'}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {filter === 'all' && walks.length > 0 && (
            <div className="sess-walks"><i />{showWalks ? `${walks.length} balades avec Willow affichées` : `${walks.length} balades avec Willow masquées ce mois-ci (${hm(walks.reduce((t, s) => t + s.durationS, 0))})`}
              <button className="link" style={{ marginLeft: 'auto' }} onClick={() => setShowWalks(!showWalks)}>{showWalks ? 'Masquer' : 'Afficher'}</button></div>
          )}
        </section>
        <aside style={{ flex: '1 1 320px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="card" style={{ gap: 14 }}>
            <span className="overline">{parseDay(month + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
            <div className="sess-kpis">
              <div><strong>{train.length}</strong><span>séances</span></div>
              <div><strong>{hm(train.reduce((t, s) => t + s.durationS, 0))}</strong><span>d'entraînement</span></div>
              <div><strong>{Math.round(inMonth.reduce((t, s) => t + s.load, 0))}</strong><span>charge</span></div>
            </div>
            <div className="sess-cal">
              {'LMMJVSD'.split('').map((d, i) => <span key={i} className="h">{d}</span>)}
              {Array.from({ length: offset }, (_, i) => <span key={'o' + i} />)}
              {Array.from({ length: nDays }, (_, i) => {
                const d = `${month}-${String(i + 1).padStart(2, '0')}`
                const day = train.filter((s) => s.start.startsWith(d))
                const c = day[0]?.category
                return <button key={d} disabled={!day.length} onClick={() => day[0] && setSel(sid(day[0]))} style={c ? { background: CATEGORY_META[c].color, color: '#000' } : undefined} title={day.map((s) => sessName(s, rules)).join(' + ')}>{i + 1}{day.length > 1 && <sup>{day.length}</sup>}</button>
              })}
            </div>
            {cats.map((c) => {
              const ss = train.filter((s) => s.category === c)
              return (
                <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div className="between small"><b style={{ color: CATEGORY_META[c].color }}>{CATEGORY_META[c].label}</b><span className="muted">{ss.length} · {hm(ss.reduce((t, s) => t + s.durationS, 0))}</span></div>
                  <div className="bar"><div style={{ width: `${(ss.length / maxN) * 100}%`, background: CATEGORY_META[c].color }} /></div>
                </div>
              )
            })}
            <div className="between small"><b style={{ color: 'var(--walk)' }}>Marche avec Willow</b><span className="muted">{walks.length} · {hm(walks.reduce((t, s) => t + s.durationS, 0))}</span></div>
          </section>
          <MonthRecords month={month} lib={lib} />
        </aside>
      </div>
    </div>
  )
}

function MonthRecords({ month, lib }: { month: string; lib: Lib | null }) {
  if (!lib) return null
  const recs: { name: string; v: string; date: string }[] = []
  for (const [key, h] of Object.entries(lib.hist)) {
    const sess = [...h.sessions].sort((a, b) => a.date.localeCompare(b.date))
    let best = { w: 0, r: 0 }
    for (const x of sess) {
      const top = topSet(x.sets.map(([r, w]) => ({ reps: r, weightKg: w })))
      const beat = top.w > best.w || (top.w === best.w && top.r > best.r)
      if (beat && x.date.startsWith(month) && best.w > 0) recs.push({ name: lib.rev.get(key)?.name ?? lib.fr[key] ?? key, v: `${fmtKg(top.w)} kg × ${top.r}`, date: x.date })
      if (beat) best = top
    }
  }
  const uniq = [...new Map(recs.map((r) => [r.name, r])).values()].slice(0, 8)
  return (
    <section className="card" style={{ gap: 8 }}>
      <span className="overline" style={{ color: 'var(--warn)' }}>Records du mois</span>
      {uniq.length === 0 && <span className="muted small">Aucun record ce mois-ci.</span>}
      {uniq.map((r) => <div key={r.name} className="between small"><span>{r.name}</span><b style={{ color: 'var(--warn)' }}>{r.v}</b></div>)}
    </section>
  )
}

function Detail({ s, config, data, lib, feel, onFeel, plan, onBack }: {
  s: Session; config: RepoConfig; data: AppData; lib: Lib | null; feel: Feel; onFeel: (f: Feel) => void; plan: Instance[]; onBack: () => void
}) {
  const rules = data.profile?.activityRules
  const [sets, setSets] = useState<Record<string, ExerciseBlock[]>>({})
  const [note, setNote] = useState(feel.note ?? '')
  const [date, setDate] = useState(isoDay(addDays(new Date(), 1)))
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    s.activities.filter((a) => a.source === 'garmin' && ['strength', 'wod', 'mobility', 'warmup'].includes(categorize(a, rules)))
      .forEach((a) => loadSets(config, a.id).then((r) => setSets((m) => ({ ...m, [String(a.id)]: blocks(r) }))).catch(() => {}))
  }, [s, config, rules])
  useEffect(() => setNote(feel.note ?? ''), [feel.note])

  const acts = s.activities
  const sum = (f: (a: typeof acts[number]) => number | null | undefined) => acts.reduce((t, a) => t + (f(a) ?? 0), 0)
  const main = acts.find((a) => categorize(a, rules) === s.category) ?? acts[0]
  const zones = [0, 1, 2, 3, 4].map((i) => sum((a) => a.hrZonesS?.[i]))
  const zt = zones.reduce((a, b) => a + b, 0)
  const allBlocks = acts.flatMap((a) => (sets[String(a.id)] ?? []).map((b) => ({ ...b, act: a })))
  const vol = allBlocks.reduce((t, b) => t + volume(b.sets), 0)
  const nSets = allBlocks.reduce((t, b) => t + b.sets.length, 0)
  const inPlan = plan.find((x) => acts.some((a) => a.id === x.activity?.id))
  const isRun = s.category === 'run'
  const dist = sum((a) => a.distanceM)
  const moving = sum((a) => a.movingS ?? a.durationS)
  const pace = dist > 0 ? moving / (dist / 1000) : 0

  // muscles (pondérés par le nombre de séries)
  const prim = new Map<string, number>(); const sec = new Set<string>()
  if (lib) for (const b of allBlocks) { const m = lib.rev.get(b.key); m?.pm.forEach((x) => prim.set(x, (prim.get(x) ?? 0) + b.sets.length)); m?.sm.forEach((x) => sec.add(x)) }
  const musc = [...prim.entries()].sort((a, b) => b[1] - a[1])
  const mx = Math.max(1, ...musc.map((x) => x[1]))

  async function redo() {
    const steps = redoSteps(allBlocks)
    if (!steps.length) return
    const name = sessName(s, rules).slice(0, 40)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    try {
      await writeJson(config, `outbox/workouts/${stamp}-redo.json`, { name, date, description: `Hybrid Forge · refaite d'après la séance du ${s.start.slice(0, 10)}`, workouts: [{ name, steps }] }, null, `séance: refaire ${name}`)
      setMsg(`Envoyée : « ${name} » arrive sur la 965 d'ici 1 à 2 min, planifiée le ${date.split('-').reverse().join('/')}.`)
    } catch (e) { setMsg((e as Error).message) }
  }

  const stats: [string, string][] = [
    ['Durée', formatDuration(s.durationS)],
    ...(isRun ? [['Distance', `${(dist / 1000).toFixed(1).replace('.', ',')} km`], ['Allure moy.', pace ? `${Math.floor(pace / 60)}'${String(Math.round(pace % 60)).padStart(2, '0')}"/km` : '–']] as [string, string][]
      : [['Effort réel', main.movingS ? formatDuration(main.movingS) : '–']] as [string, string][]),
    ['FC moy. / max', main.avgHR ? `${main.avgHR} / ${main.maxHR ?? '–'}` : '–'],
    ['Charge', String(Math.round(s.load) || '–')],
    ['Effet aéro. / anaéro.', main.aerobicTE != null ? `${String(main.aerobicTE).replace('.', ',')} / ${String(main.anaerobicTE ?? 0).replace('.', ',')}` : '–'],
    ...(vol ? [['Volume', `${(vol / 1000).toFixed(1).replace('.', ',')} t`]] as [string, string][] : []),
  ]

  return (
    <div className="sess">
      <div className="between" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="link" onClick={onBack}>← Séances</button>
          <span className="overline" style={{ color: CATEGORY_META[s.category].color }}>{CATEGORY_META[s.category].label} · {parseDay(s.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {s.start.slice(11, 16)} · {[...new Set(acts.map((a) => (a.source === 'healthfit' ? 'Apple Watch' : 'Garmin')))].join(' + ')}</span>
          <h1 style={{ margin: 0 }}>{sessName(s, rules)}</h1>
          {acts.length > 1 && <span className="muted small">{acts.length} blocs : {acts.map((a) => `${a.name} (${formatDuration(a.durationS)})`).join(' · ')}</span>}
        </div>
        {allBlocks.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="small muted">Refaire le <input type="date" className="select" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <button className="btn" onClick={redo}>⌚ Envoyer à la 965</button>
          </div>
        )}
      </div>
      {msg && <div className="notice ok">{msg}</div>}
      <section className="card sess-stats">{stats.map(([a, b]) => <div key={a}><span className="muted small">{a}</span><strong>{b}</strong></div>)}</section>

      <div className="mob-hero-row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '3 1 620px', gap: 10 }}>
          {allBlocks.length > 0 ? (
            <>
              <div className="between"><span className="overline">Exercices · {allBlocks.length} mouvements · {nSets} séries</span><span className="muted small">charge × reps · comparé à la dernière fois</span></div>
              {allBlocks.map((b, i) => {
                const m = lib?.rev.get(b.key)
                const t = lib ? trend(b.key, b.sets, s.start.slice(0, 10), lib.hist) : null
                const v = volume(b.sets)
                return (
                  <div key={i} className="sess-ex">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong>{m?.name ?? lib?.fr[b.key] ?? (b.key === 'INCONNU' ? 'Exercice non identifié' : b.key)}</strong><span className="muted small">{m?.en ?? b.key.split('/')[1]?.toLowerCase().replace(/_/g, ' ')}</span></div>
                    <div className="sess-sets">{b.sets.map((x, k) => <span key={k}>{x.weightKg ? `${fmtKg(x.weightKg)} × ${x.reps ?? '?'}` : x.reps ? `${x.reps} reps` : `${Math.round(x.durationS ?? 0)} s`}</span>)}</div>
                    <span className="muted small" style={{ textAlign: 'right' }}>{v ? `${Math.round(v).toLocaleString('fr-FR')} kg` : ''}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>{t && <><b className="small" style={{ color: TREND_COLOR[t.kind] }}>{TREND_ICON[t.kind]} {t.label}</b><span className="muted" style={{ fontSize: 11, textAlign: 'right' }}>{t.detail}</span></>}</div>
                  </div>
                )
              })}
              <span className="muted small">Séries lues sur la Garmin.</span>
            </>
          ) : (
            <>
              <span className="overline">{isRun ? 'Course' : 'Détail'}</span>
              <span className="muted small">{isRun ? 'Le détail par tours (minutes, allure, dérive de la FC) arrivera avec la récupération des tours Garmin.' : acts.some((a) => a.source === 'healthfit') ? 'Séance Apple Watch : pas de séries enregistrées.' : 'Pas de séries enregistrées pour cette séance.'}</span>
            </>
          )}
        </section>
        <aside style={{ flex: '1 1 320px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {zt > 0 && (
            <section className="card" style={{ gap: 10 }}>
              <span className="overline">Zones cardiaques</span>
              <div className="zbar">{zones.map((z, i) => <i key={i} style={{ flex: `${z} 1 0`, background: ZONE_COLORS[i] }} />)}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{zones.map((z, i) => <span key={i} className="small muted"><b style={{ color: ZONE_COLORS[i] }}>Z{i + 1}</b> {Math.floor(z / 60)}'{String(Math.round(z % 60)).padStart(2, '0')}</span>)}</div>
            </section>
          )}
          {musc.length > 0 && (
            <section className="card" style={{ gap: 10 }}>
              <span className="overline">Muscles travaillés</span>
              <BodyMap primary={musc.map((x) => x[0])} secondary={[...sec]} />
              {musc.slice(0, 7).map(([n, v]) => <div key={n} className="between small"><span>{n}</span><div className="bar" style={{ width: 140 }}><div style={{ width: `${(v / mx) * 100}%`, background: 'var(--lift)' }} /></div></div>)}
            </section>
          )}
          <section className="card" style={{ gap: 10 }}>
            <span className="overline" style={{ color: 'var(--run)' }}>Ressenti</span>
            <span className="small" style={{ color: 'var(--soft)' }}>Difficulté (RPE)</span>
            <div className="pain">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <button key={n} className={feel.rpe === n ? 'on' : ''} style={feel.rpe === n ? { background: 'var(--run)' } : undefined} onClick={() => onFeel({ ...feel, rpe: n })}>{n}</button>)}</div>
            <span className="small" style={{ color: 'var(--soft)' }}>Douleur sciatique pendant / après</span>
            <div className="pain">{Array.from({ length: 11 }, (_, i) => i).map((n) => <button key={n} className={feel.pain === n ? 'on' : ''} style={feel.pain === n ? { background: n <= 2 ? 'var(--mobility)' : n <= 4 ? 'var(--warn)' : 'var(--bad)' } : undefined} onClick={() => onFeel({ ...feel, pain: n })}>{n}</button>)}</div>
            <textarea className="textarea" rows={3} placeholder="Note (ex. garder 80 kg la prochaine fois)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (feel.note ?? '') && onFeel({ ...feel, note })} />
          </section>
          <section className="card" style={{ gap: 6 }}>
            <span className="overline">Plan</span>
            {inPlan ? (
              <>
                <span className="small"><b>Prévu :</b> {inPlan.t.title}{inPlan.t.detail ? ` · ${inPlan.t.detail}` : ''}</span>
                <span className="small" style={{ color: inPlan.status === 'ok' ? 'var(--good)' : 'var(--warn)' }}><b>Réalisé :</b> {formatDuration(s.durationS)}{main.avgHR ? ` · FC ${main.avgHR}` : ''} · {inPlan.status === 'ok' ? 'dans l\'objectif' : 'hors cible'}</span>
              </>
            ) : <span className="small" style={{ color: 'var(--soft)' }}>Séance libre, hors plan.</span>}
          </section>
        </aside>
      </div>
    </div>
  )
}
