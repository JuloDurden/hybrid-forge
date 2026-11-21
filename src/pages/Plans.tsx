import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, categorize, isoDay, parseDay, type AppData } from '../lib/data'
import { triggerSync, type RepoConfig } from '../lib/github'
import {
  buildCalendar, COLOR, criteria, EMPTY, gates, KIND_COLOR, loadState, nextMonday, PLANS, proposals, saveState,
  publishSchedule, scheduleOf, SEND_MODES, walkMinutes, type Adjust, type Instance, type PlanState, type PlanT,
} from '../lib/plans'

type Tab = 'plan' | 'library' | 'goals'
const ST_LABEL: Record<Instance['status'], [string, string]> = {
  ok: ['var(--good)', '✓ Fait'], warn: ['var(--warn)', '! Fait, hors cible'], missed: ['var(--bad)', '✕ Manquée'],
  today: ['var(--text)', '● Aujourd\'hui'], planned: ['var(--muted)', '○ Prévu'], moved: ['var(--muted)', '↷ Déplacée'],
}
const ADJ_COLOR: Record<Adjust['kind'], string> = { missed: 'var(--bad)', target: 'var(--warn)', form: 'var(--run)', pain: 'var(--warn)', week: 'var(--lift)' }
const ADJ_LABEL: Record<Adjust['kind'], string> = { missed: 'Séance manquée', target: 'Objectif non tenu', form: 'État de forme', pain: 'Douleur', week: 'Fin de semaine' }
const fmtDate = (d: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }) => parseDay(d).toLocaleDateString('fr-FR', o)

function PainPicker({ value, onPick }: { value: number | undefined; onPick: (n: number) => void }) {
  return (
    <div className="pain">
      {Array.from({ length: 11 }, (_, i) => (
        <button key={i} className={value === i ? 'on' : ''} style={value === i ? { background: i <= 2 ? 'var(--mobility)' : i <= 4 ? 'var(--warn)' : 'var(--bad)' } : undefined} onClick={() => onPick(i)}>{i}</button>
      ))}
    </div>
  )
}

export function Plans({ config, data }: { config: RepoConfig; data: AppData }) {
  const [tab, setTab] = useState<Tab>('plan')
  const [st, setSt] = useState<PlanState>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const sha = useRef<string | null>(null)
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null)
  const [view, setView] = useState<PlanT | null>(null)
  const [busy, setBusy] = useState(false)
  const today = isoDay(new Date())

  useEffect(() => { loadState(config).then((r) => { setSt({ ...EMPTY, ...r.data }); sha.current = r.sha; setLoaded(true) }).catch((e) => { setMsg({ t: (e as Error).message, err: true }); setLoaded(true) }) }, [config])
  const flash = (t: string, err = false) => { setMsg({ t, err }); setTimeout(() => setMsg(null), 5000) }

  async function persist(next: PlanState, m: string, ok?: string) {
    const prev = st
    setSt(next)
    try { sha.current = await saveState(config, next, sha.current, m); if (ok) flash(ok) }
    catch (e) { setSt(prev); flash((e as Error).message, true) }
  }

  const plan = st.active ? PLANS.find((p) => p.id === st.active!.planId) ?? null : null
  const cal = useMemo(() => (plan && st.active ? buildCalendar(plan, st, data) : null), [plan, st, data])
  const props = useMemo(() => (plan && cal && !st.active?.paused ? proposals(plan, st, cal, data) : []), [plan, cal, st, data])
  const g = useMemo(() => gates(st, data), [st, data])

  const setPain = (n: number) => persist({ ...st, pain: { ...st.pain, [today]: n } }, `douleur ${today}: ${n}`)
  const decide = (a: Adjust, ok: boolean) => {
    const base = ok ? a.apply(st) : st
    persist({ ...base, decisions: { ...base.decisions, [a.id]: ok ? 'accepted' : 'refused' } }, `plan: ajustement ${ok ? 'accepté' : 'refusé'} (${a.id})`, ok ? 'Ajustement appliqué.' : 'Ajustement refusé.')
  }
  const start = (p: PlanT) => persist({ ...st, active: { planId: p.id, start: nextMonday(), repeats: [] }, decisions: {}, overrides: {} }, `plan: démarrage ${p.name}`, `« ${p.name} » démarre le lundi ${fmtDate(nextMonday(), { day: 'numeric', month: 'long' })}.`)
  const stop = () => {
    if (!st.active || !window.confirm('Arrêter ce plan ? L\'historique est conservé.')) return
    persist({ ...st, active: null, history: [...st.history, { planId: st.active.planId, start: st.active.start, end: today, status: 'arrêté' }] }, 'plan: arrêt', 'Plan arrêté. Tu repasses en séances libres.')
  }
  // calendrier publié pour l'envoi automatique : mis à jour dès que le plan ou ses ajustements changent
  const sched = useMemo(() => (loaded ? scheduleOf(st, cal) : null), [loaded, st, cal])
  useEffect(() => {
    if (!sched || (!st.active && !sched.jobs.length && !st.history.length)) return
    publishSchedule(config, sched).catch((e) => flash((e as Error).message, true))
  }, [sched, config]) // eslint-disable-line react-hooks/exhaustive-deps
  async function sendNow() {
    setBusy(true)
    try { if (sched) await publishSchedule(config, sched); await triggerSync(config); flash('Synchro lancée : les séances de la période arrivent sur la 965 d\'ici 2 à 3 min.') }
    catch (e) { flash((e as Error).message, true) }
    setBusy(false)
  }

  // 14 derniers jours (séances libres)
  const strip = useMemo(() => Array.from({ length: 14 }, (_, k) => {
    const d = isoDay(addDays(new Date(), k - 13))
    const cats = data.activities.filter((a) => a.start.startsWith(d)).map((a) => categorize(a, data.profile?.activityRules))
    const walk = cats.includes('walk')
    const c = cats.includes('run') ? 'run' : cats.includes('wod') ? 'wod' : cats.includes('strength') ? 'strength' : cats.includes('mobility') || cats.includes('warmup') ? 'mobility' : ''
    return { d, c, walk }
  }), [data])
  const counts = strip.reduce<Record<string, number>>((m, x) => { if (x.c) m[x.c] = (m[x.c] ?? 0) + 1; return m }, {})
  const SC: Record<string, string> = { run: 'var(--run)', wod: 'var(--wod)', strength: 'var(--lift)', mobility: 'var(--mobility)', '': 'var(--surface-3)' }
  const reprise = PLANS.find((p) => p.id === 'reprise')!
  const allGreen = g.every((x) => x.ok)

  if (!loaded) return <div className="muted">Chargement…</div>

  return (
    <div className="plans">
      <div className="mob-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Plans</h1>
          <div className="lib-tabs">
            {([['plan', 'Mon plan'], ['library', 'Bibliothèque de plans'], ['goals', 'Objectifs']] as [Tab, string][]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
        </div>
      </div>
      {msg && <div className={`notice ${msg.err ? 'err' : 'ok'}`}>{msg.t}</div>}

      {tab === 'plan' && !plan && (
        <div className="mob-hero-row">
          <section className="card" style={{ flex: '3 1 520px', gap: 14 }}>
            <div className="between"><span className="overline">Aucun plan actif</span><span className="pill">Séances libres</span></div>
            <h2 style={{ margin: 0, fontSize: 26 }}>Tu t'entraînes librement</h2>
            <span className="muted small">L'app suit ce que tu fais (Garmin et Apple Watch) sans rien imposer. Les 14 derniers jours :</span>
            <div className="plan-strip">{strip.map((x) => <div key={x.d} title={x.d}><i style={{ background: SC[x.c] }} /><b style={{ background: x.walk ? 'var(--walk)' : 'transparent' }} /><span>{'DLMMJVS'[parseDay(x.d).getDay()]}</span></div>)}</div>
            <div className="small muted" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span><b style={{ color: 'var(--mobility)' }}>●</b> Mobilité · {counts.mobility ?? 0}</span><span><b style={{ color: 'var(--wod)' }}>●</b> WOD · {counts.wod ?? 0}</span>
              <span><b style={{ color: 'var(--run)' }}>●</b> Course · {counts.run ?? 0}</span><span><b style={{ color: 'var(--lift)' }}>●</b> Muscu · {counts.strength ?? 0}</span><span><b style={{ color: 'var(--walk)' }}>●</b> Marche avec Willow · {strip.filter((x) => x.walk).length} j</span>
            </div>
            <div className="pain-row"><span>Douleur sciatique aujourd'hui</span><PainPicker value={st.pain[today]} onPick={setPain} /></div>
            <span className="muted small">Note de 0 à 10, en 2 secondes. Elle sert à juger quand reprendre, puis à adapter le plan.</span>
          </section>
          <section className="card plan-ready" style={{ flex: '2 1 340px', gap: 12 }}>
            <span className="overline" style={{ color: 'var(--mobility)' }}>Prêt à reprendre ?</span>
            <h2 style={{ margin: 0 }}>{reprise.name}</h2>
            <span className="small" style={{ color: 'var(--soft)' }}>À lancer quand ces 4 feux sont au vert. Rien ne démarre tout seul.</span>
            <ul className="gates">
              {g.map((x) => (
                <li key={x.label}>
                  <button className={`gate ${x.ok ? 'on' : ''}`} disabled={!!x.auto} aria-label={x.label}
                    onClick={() => x.key && persist({ ...st, gates: { ...st.gates, [x.key]: !st.gates[x.key] } }, 'plan: feu de reprise')}>{x.ok ? '✓' : ''}</button>
                  <span>{x.label}{x.info && <em className="muted"> · {x.info}</em>}</span>
                </li>
              ))}
            </ul>
            <span className="muted small">Les 2 premiers se cochent seuls (activités et notes de douleur). Coche les 2 autres toi-même.</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 'auto' }}>
              <button className="btn ghost" onClick={() => setView(reprise)}>Voir le plan</button>
              <button className="btn" disabled={!allGreen} onClick={() => start(reprise)}>{allGreen ? `Démarrer lundi ${fmtDate(nextMonday(), { day: 'numeric' })}` : `Démarrer (${g.filter((x) => x.ok).length}/4 feux au vert)`}</button>
            </div>
          </section>
        </div>
      )}

      {tab === 'plan' && plan && cal && (() => {
        const w = cal.weeks[cal.cur]
        const crit = criteria(w, st)
        const done = cal.weeks.flatMap((x) => x.inst).filter((x) => x.status === 'ok' || x.status === 'warn').length
        const planned = cal.weeks.slice(0, cal.cur + 1).reduce((n, x) => n + x.inst.length, 0)
        return (
          <>
            <section className="card" style={{ gap: 16 }}>
              <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="overline" style={{ color: COLOR[plan.color] }}>Plan actif · {st.active!.start > today ? `démarre le ${fmtDate(st.active!.start, { day: 'numeric', month: 'long' })}` : `démarré le ${fmtDate(st.active!.start, { day: 'numeric', month: 'long' })}`}{st.active!.paused ? ' · en pause' : ''}</span>
                  <h2 style={{ margin: 0, fontSize: 28 }}>{plan.name}</h2>
                  <span className="muted small">Semaine {cal.cur + 1} sur {cal.weeks.length}{w.n !== cal.cur + 1 ? ` (contenu de la semaine ${w.n})` : ''} · {plan.phases?.find((p) => p.weeks.includes(w.n))?.name} · {done} séances faites sur {planned} prévues</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn ghost" onClick={() => persist({ ...st, active: { ...st.active!, paused: !st.active!.paused } }, 'plan: pause')}>{st.active!.paused ? 'Reprendre' : 'Mettre en pause'}</button>
                  <button className="btn ghost" onClick={stop}>Arrêter le plan</button>
                </div>
              </div>
              <div className="plan-weeks">
                {cal.weeks.map((x) => {
                  const d = x.inst.filter((i) => i.status === 'ok' || i.status === 'warn').length
                  const past = x.end < today
                  const color = x.i === cal.cur ? 'var(--run)' : past ? (criteria(x, st).pass ? 'var(--mobility)' : 'var(--warn)') : 'var(--surface-3)'
                  const ph = plan.phases?.find((p) => p.weeks.includes(x.n))
                  return (
                    <div key={x.i} className={x.i === cal.cur ? 'cur' : ''}>
                      <span className="small" style={{ color: ph ? COLOR[ph.color] : undefined }}>{ph?.name}</span>
                      <div className="plan-wbar"><i style={{ height: `${(d / x.inst.length) * 100}%`, background: color }} /></div>
                      <span className="small"><b>S{x.i + 1}</b>{x.n !== x.i + 1 ? ` (=S${x.n})` : ''} · {d}/{x.inst.length}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="mob-hero-row" style={{ alignItems: 'flex-start' }}>
              <section className="card" style={{ flex: '3 1 520px', gap: 10 }}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <span className="overline">Semaine {cal.cur + 1} · {fmtDate(w.monday, { day: 'numeric', month: 'short' })} → {fmtDate(w.end, { day: 'numeric', month: 'short' })}</span>
                  <div className="send-mode">
                    <span className="muted small">⌚ Envoi sur la 965</span>
                    <div className="seg">{SEND_MODES.map((m) => <button key={m.id} title={m.hint} className={(st.sendMode ?? 'day') === m.id ? 'on' : ''} onClick={() => persist({ ...st, sendMode: m.id }, `plan: envoi ${m.id}`, `Envoi : ${m.label.toLowerCase()} (${m.hint}).`)}>{m.label}</button>)}</div>
                    <button className="btn ghost sm" disabled={busy} onClick={sendNow}>{busy ? '…' : 'Envoyer maintenant'}</button>
                  </div>
                </div>
                {w.inst.map((x) => {
                  const [c, l] = ST_LABEL[x.status]
                  const title = x.ov?.mobility ? 'Mobilité sciatique 15\'' : x.t.title
                  return (
                    <div key={x.id} className={`plan-day ${x.status}`}>
                      <span className="plan-date">{fmtDate(x.date)}</span>
                      <span className="plan-kind" style={{ background: x.ov?.mobility ? 'var(--mobility)' : KIND_COLOR[x.t.kind] }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <strong>{title}{x.t.key && <span className="plan-key" title="Séance clé">clé</span>}</strong>
                        <span className="muted small">{x.ov?.mobility ? `remplace « ${x.t.title} »` : x.t.detail}{x.min !== x.t.min ? ` · raccourcie à ${x.min}'` : ''}{x.ov?.date ? ` · déplacée du ${fmtDate(x.baseDate)}` : ''}</span>
                        {x.note && <span className="small" style={{ color: 'var(--warn)' }}>{x.note}</span>}
                        {walkMinutes(data, x.date) > 0 && <span className="small" style={{ color: 'var(--walk)' }}>+ {walkMinutes(data, x.date)}' de marche avec Willow</span>}
                      </div>
                      <span className="small" style={{ color: c, whiteSpace: 'nowrap', fontWeight: 700 }}>{l}{x.activity?.avgHR && x.t.run ? ` · FC ${x.activity.avgHR}` : ''}</span>
                    </div>
                  )
                })}
                <div className="pain-row"><span>Douleur aujourd'hui</span><PainPicker value={st.pain[today]} onPick={setPain} /></div>
                <div className="plan-crit">
                  <span className="overline">Pour passer à la semaine {cal.cur + 2}</span>
                  {crit.items.map((x) => <div key={x.label} className="between small"><span style={{ color: 'var(--soft)' }}>{x.label} <em className="muted">({x.need})</em></span><b style={{ color: x.ok == null ? 'var(--muted)' : x.ok ? 'var(--good)' : 'var(--warn)' }}>{x.value}</b></div>)}
                  <span className="muted small">Si les critères ne sont pas tenus dimanche, l'app proposera de refaire la semaine plutôt que d'avancer.</span>
                </div>
              </section>
              <aside style={{ flex: '2 1 360px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="between"><h2 style={{ margin: 0, fontSize: 20 }}>Ajustements proposés</h2>{props.length > 0 && <span className="pill" style={{ background: 'var(--warn)', color: '#000' }}>{props.length}</span>}</div>
                {props.length === 0 && <div className="empty">Rien à ajuster pour l'instant.{st.active!.paused ? ' Plan en pause.' : ''}</div>}
                {props.map((a) => (
                  <div key={a.id} className="adj" style={{ borderLeftColor: ADJ_COLOR[a.kind] }}>
                    <span className="overline" style={{ color: ADJ_COLOR[a.kind] }}>{ADJ_LABEL[a.kind]}</span>
                    <strong>{a.title}</strong>
                    <span className="muted small">{a.why}</span>
                    <span className="adj-change">→ {a.change}</span>
                    <div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => decide(a, true)}>Accepter</button><button className="btn ghost sm" onClick={() => decide(a, false)}>Refuser</button></div>
                  </div>
                ))}
                {plan.rules && <div className="card" style={{ gap: 6 }}><span className="overline">Règles du plan</span>{plan.rules.map((r) => <span key={r} className="small" style={{ color: 'var(--soft)' }}>• {r}</span>)}</div>}
              </aside>
            </div>
          </>
        )
      })()}

      {tab === 'library' && (
        <div className="mob-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {PLANS.map((p) => (
            <button key={p.id} className="plan-card" style={{ borderColor: p.id === st.active?.planId ? COLOR[p.color] : undefined }} onClick={() => setView(p)}>
              <div className="between"><i style={{ background: COLOR[p.color] }} />{p.id === st.active?.planId ? <span className="pill" style={{ background: COLOR[p.color], color: '#000' }}>En cours</span> : p.draft ? <span className="pill">Contenu à rédiger</span> : p.combinable ? <span className="pill">Combinable</span> : null}</div>
              <strong>{p.name}</strong>
              <span className="small" style={{ color: COLOR[p.color], fontWeight: 700 }}>{p.weeks_label} · {p.per_week}</span>
              <span className="small" style={{ color: 'var(--soft)', lineHeight: 1.5 }}>{p.desc}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>{p.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
            </button>
          ))}
        </div>
      )}

      {tab === 'goals' && (
        <div className="mob-row" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {(data.profile?.goals ?? []).map((x) => (
            <div key={x.id} className="card" style={{ gap: 6 }}>
              <span className="overline">{x.id === 'semi' ? 'Semi-marathon' : x.id === 'pullups' ? 'Tractions strictes' : 'Poids'}</span>
              <strong style={{ fontSize: 20 }}>{x.id === 'semi' ? 'Moins de 2 h 00' : x.id === 'pullups' ? `${x.startValue ?? 0} → ${x.targetValue}` : `${x.startValue} → ${x.targetValue} kg`}</strong>
              <span className="muted small">{x.id === 'semi' ? (x.target ? `Visé en ${x.target}` : 'Repoussé · date à fixer après la reprise') : `Actuel : ${x.currentValue ?? x.startValue}`}</span>
            </div>
          ))}
        </div>
      )}

      {view && (
        <div className="drawer-bg" onClick={() => setView(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => setView(null)} aria-label="Fermer">✕</button>
            <span className="overline" style={{ color: COLOR[view.color] }}>{view.weeks_label} · {view.per_week}</span>
            <h2 style={{ margin: 0 }}>{view.name}</h2>
            <span className="small" style={{ color: 'var(--soft)' }}>{view.desc}</span>
            {view.draft && <div className="notice">Contenu détaillé pas encore rédigé. Dis-moi quand tu veux le préparer : il sera construit sur le même modèle que « Reprise en douceur ».</div>}
            {view.weeks?.map((wk) => (
              <div key={wk.n} className="plan-week-detail">
                <div className="between"><strong>Semaine {wk.n} · {view.phases?.find((p) => p.weeks.includes(wk.n))?.name}</strong><span className="muted small">{wk.sessions.reduce((n, s) => n + s.min, 0)}' au total</span></div>
                {wk.sessions.map((s, k) => (
                  <div key={k} className="plan-sess"><span className="plan-kind" style={{ background: KIND_COLOR[s.kind] }} /><span className="muted small" style={{ width: 34 }}>{'LMMJV'[s.d]}</span><div style={{ flex: 1 }}><span className="small"><b>{s.title}</b>{s.key ? ' · clé' : ''}</span><div className="muted small">{s.detail}</div></div><span className="muted small">{s.min}'</span></div>
                ))}
                <span className="muted small">Passage : {wk.criteria.sessions} séances mini, douleur ≤ {wk.criteria.pain}/10, au moins la moitié des courses sous la FC cible.</span>
              </div>
            ))}
            {view.rules && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="overline">Règles</span>{view.rules.map((r) => <span key={r} className="small" style={{ color: 'var(--soft)' }}>• {r}</span>)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
