import { useEffect, useMemo, useRef, useState } from 'react'
import { isoDay, parseDay, addDays, type AppData } from '../lib/data'
import { readJson, type RepoConfig } from '../lib/github'
import { DURATIONS, PROTOCOLS, ytThumb } from '../lib/mobility'
import {
  BENCH, countSteps, estimate, fmtAmount, fmtKg, FORMATS, formatLine, GARMIN_MAX, garminWorkouts, LEVELS, loadMine, parseWod,
  roundMoves, saveMine, sendWod, stimulus, UNIT_FR, WMOVES, type CfWod, type Format, type Level, type MineFile, type Wod,
} from '../lib/wod'

type Tab = 'create' | 'mine' | 'cf' | 'bench'
const DRAFT_KEY = 'hf.wod.draft'
const LEVEL_KEY = 'hf.wod.level'
const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

const DEFAULT: Wod = {
  id: 'w-default', name: 'EMOM Olympique 20\'', format: 'emom', minutes: 20, every: 60, emom: 'alternate',
  moves: [{ key: 'power-clean', reps: 5 }, { key: 'front-squat', reps: 5 }, { key: 'push-jerk', reps: 5 }, { key: 'burpee', reps: 10 }],
  warmup: { protocol: 'act-wod', minutes: 8 }, skill: null, cooldown: { protocol: 'rec-wod', minutes: 8 },
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const mmss = (s: number) => `${Math.round(s / 60)}'`
const LEG_KEYS = new Set(['thruster', 'clean', 'power-clean', 'hang-power-clean', 'clean-and-jerk', 'snatch', 'power-snatch', 'deadlift', 'back-squat', 'front-squat', 'overhead-squat', 'barbell-lunge', 'db-lunge', 'goblet-squat', 'wall-ball', 'lunge', 'box-jump', 'pistol', 'db-thruster', 'db-box-step-up', 'sumo-deadlift-high-pull'])
const PULL_KEYS = new Set(['pull-up', 'chest-to-bar', 'banded-pull-up', 'jumping-pull-up', 'muscle-up', 'rope-climb'])

function NumField({ label, value, onChange, suffix, step = 1 }: { label: string; value: number | undefined; onChange: (n: number) => void; suffix?: string; step?: number }) {
  return (
    <label className="wod-field"><span>{label}</span>
      <span className="wod-num"><input type="number" min={0} step={step} value={value ?? ''} onChange={(e) => onChange(+e.target.value)} />{suffix && <em>{suffix}</em>}</span>
    </label>
  )
}

function MovePicker({ onPick }: { onPick: (key: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const hits = q.length < 2 ? [] : Object.values(WMOVES).filter((m) => m.key !== 'rest' && fold(`${m.fr} ${m.en} ${m.key}`).includes(fold(q))).slice(0, 8)
  if (!open) return <button className="wod-add" onClick={() => setOpen(true)}>+ Ajouter un mouvement</button>
  return (
    <div className="wod-picker">
      <input autoFocus placeholder="Mouvement (FR ou EN) : thruster, traction, wall ball…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {hits.map((m) => <button key={m.key} onClick={() => { onPick(m.key); setQ(''); setOpen(false) }}><strong>{m.fr}</strong><span className="muted small">{m.en}{m.rx ? ` · RX ${fmtKg(m.rx)}` : ''}</span></button>)}
    </div>
  )
}

export function WodPage({ config, data }: { config: RepoConfig; data: AppData }) {
  const [tab, setTab] = useState<Tab>('create')
  const [w, setWRaw] = useState<Wod>(() => lsGet(DRAFT_KEY, DEFAULT))
  const [level, setLevelRaw] = useState<Level>(() => lsGet(LEVEL_KEY, 'my'))
  const [mine, setMine] = useState<MineFile>({ wods: [] })
  const sha = useRef<string | null>(null)
  const [cf, setCf] = useState<CfWod[] | null>(null)
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null)
  const [paste, setPaste] = useState<string | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [date, setDate] = useState(isoDay(new Date()))
  const [busy, setBusy] = useState(false)

  const setW = (next: Wod) => { setWRaw(next); lsSet(DRAFT_KEY, next) }
  const patch = (p: Partial<Wod>) => setW({ ...w, ...p })
  const setLevel = (l: Level) => { setLevelRaw(l); lsSet(LEVEL_KEY, l) }
  const flash = (t: string, err = false) => { setMsg({ t, err }); setTimeout(() => setMsg(null), 5000) }

  useEffect(() => { loadMine(config).then((r) => { setMine(r.data); sha.current = r.sha }).catch(() => {}) }, [config])
  useEffect(() => { if (tab === 'cf' && !cf) readJson<CfWod[]>(config, 'data/wod/crossfit.json', []).then(setCf).catch(() => setCf([])) }, [tab, cf, config])

  const open = (next: Wod, unk: string[] = []) => { setW({ warmup: { protocol: 'act-wod', minutes: 8 }, cooldown: { protocol: 'rec-wod', minutes: 8 }, ...next }); setUnknown(unk); setTab('create'); window.scrollTo(0, 0) }

  const est = useMemo(() => estimate(w, level), [w, level])
  const workouts = useMemo(() => garminWorkouts(w, level), [w, level])
  const steps = workouts.reduce((n, x) => n + countSteps(x.steps), 0)
  const rm = useMemo(() => roundMoves(w, level), [w, level])
  const linked = rm.filter((r) => r.def.garmin && !r.def.garmin.startsWith('CARDIO/CARDIO')).length

  // contrôles du plan
  const checks = useMemo(() => {
    const out: { ok: boolean; t: string }[] = []
    const legs = rm.filter((r) => LEG_KEYS.has(r.key))
    const d = parseDay(date)
    const soon = data.calendar.filter((c) => (c.date === isoDay(addDays(d, 1)) || c.date === isoDay(d)) && (c.sport ?? '').toLowerCase().includes('run'))
    if (legs.length && soon.length) out.push({ ok: false, t: `Jambes chargées (${legs.map((r) => r.def.fr).join(', ')}) moins de 36 h avant « ${soon[0].name ?? 'course'} »` })
    else if (legs.length) out.push({ ok: true, t: 'Pas de course prévue dans les 36 h après ce WOD' })
    if (rm.some((r) => PULL_KEYS.has(r.key))) out.push({ ok: true, t: 'Compte pour le plancher tirage vertical (2/sem)' })
    const swaps = rm.filter((r) => r.swapped)
    if (swaps.length) out.push({ ok: true, t: `Adapté à ton niveau : ${swaps.map((r) => `${r.swapped} → ${r.def.fr}`).join(', ')}` })
    if (est.totalS > 60 * 60) out.push({ ok: false, t: `Durée totale ${mmss(est.totalS)} : au-delà de ta limite d'1 h` })
    return out
  }, [rm, date, data.calendar, est.totalS])

  async function persistMine(next: MineFile, m: string) {
    try { sha.current = await saveMine(config, next, sha.current, m); setMine(next); flash('Enregistré dans tes WOD.') }
    catch (e) { flash((e as Error).message, true) }
  }
  const saveCurrent = () => {
    const exists = mine.wods.some((x) => x.id === w.id)
    const cur = { ...w, id: exists ? w.id : 'w-' + Date.now(), level }
    setW(cur)
    persistMine({ wods: exists ? mine.wods.map((x) => (x.id === w.id ? cur : x)) : [cur, ...mine.wods] }, `wod: ${w.name}`)
  }
  async function send() {
    setBusy(true)
    try { await sendWod(config, w, level, date); flash(`Envoyé : « ${w.name} » arrive sur la 965 d'ici 1 à 2 min, planifié le ${date.split('-').reverse().join('/')}.`) }
    catch (e) { flash((e as Error).message, true) }
    setBusy(false)
  }

  const moveRow = (i: number, d: number) => { const m = [...w.moves]; const j = i + d; if (j < 0 || j >= m.length) return; [m[i], m[j]] = [m[j], m[i]]; patch({ moves: m }) }
  const setMove = (i: number, p: Partial<Wod['moves'][number]>) => patch({ moves: w.moves.map((m, k) => (k === i ? { ...m, ...p } : m)) })
  const fmt = w.format

  return (
    <div className="wod">
      <div className="mob-head">
        <div style={{ flex: 1, minWidth: 280 }}>
          <span className="overline">WOD · {tab === 'create' ? 'Créateur' : tab === 'mine' ? 'Mes WOD' : tab === 'cf' ? 'CrossFit.com' : 'Benchmarks'}</span>
          {tab === 'create' ? <input className="wod-title" value={w.name} onChange={(e) => patch({ name: e.target.value })} /> : <h1 style={{ margin: '4px 0 0' }}>{tab === 'mine' ? 'Mes WOD' : tab === 'cf' ? 'WOD du jour CrossFit.com' : 'Benchmarks'}</h1>}
        </div>
        <div className="seg">
          {([['create', 'Créateur'], ['mine', `Mes WOD (${mine.wods.length})`], ['cf', 'WOD du jour CrossFit.com'], ['bench', 'Benchmarks']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {msg && <div className={`notice ${msg.err ? 'err' : 'ok'}`}>{msg.t}</div>}

      {tab === 'create' && (
        <div className="wod-grid">
          {/* -------- Colonne gauche : format et niveau */}
          <section className="card wod-left">
            <span className="overline">Format</span>
            <div className="wod-formats">
              {FORMATS.map((f) => <button key={f.id} className={fmt === f.id ? 'on' : ''} onClick={() => patch({ format: f.id as Format, ...(f.id === 'emom' && !w.emom ? { emom: 'alternate', every: 60, minutes: w.minutes ?? 12 } : {}) })}>{f.label}</button>)}
            </div>
            <div className="wod-params">
              {(fmt === 'amrap' || fmt === 'emom') && <NumField label="Durée totale" value={w.minutes} suffix="min" onChange={(n) => patch({ minutes: n })} />}
              {fmt === 'emom' && <NumField label="Toutes les" value={w.every ?? 60} suffix="s" step={15} onChange={(n) => patch({ every: n })} />}
              {fmt === 'emom' && (
                <label className="wod-field"><span>Chaque minute</span>
                  <select className="fpill" value={w.emom ?? 'alternate'} onChange={(e) => patch({ emom: e.target.value as Wod['emom'] })}>
                    <option value="alternate">un mouvement à la fois</option><option value="all">tous les mouvements</option>
                  </select>
                </label>
              )}
              {(fmt === 'fortime' || fmt === 'intervals' || fmt === 'strength') && !w.scheme && <NumField label={fmt === 'strength' ? 'Séries' : 'Tours'} value={w.rounds ?? 1} onChange={(n) => patch({ rounds: n })} />}
              {(fmt === 'fortime' || fmt === 'strength') && (
                <label className="wod-field"><span>Schéma de reps</span>
                  <span className="wod-num"><input placeholder="21-15-9" value={w.scheme?.join('-') ?? ''} onChange={(e) => { const v = e.target.value.split('-').map(Number).filter((n) => n > 0); patch({ scheme: v.length > 1 ? v : undefined }) }} /></span>
                </label>
              )}
              {fmt === 'intervals' && (
                <>
                  <label className="wod-field"><span>Type</span>
                    <select className="fpill" value={w.intervals ?? 'stations'} onChange={(e) => patch({ intervals: e.target.value as Wod['intervals'] })}>
                      <option value="stations">ateliers chronométrés</option><option value="amrap">AMRAP par tour</option>
                    </select>
                  </label>
                  <NumField label={w.intervals === 'amrap' ? 'Travail par tour' : 'Travail par atelier'} value={w.work ?? 60} suffix="s" step={15} onChange={(n) => patch({ work: n })} />
                </>
              )}
              {(fmt === 'fortime' || fmt === 'intervals' || fmt === 'strength') && <NumField label="Repos entre tours" value={w.rest ?? 0} suffix="s" step={15} onChange={(n) => patch({ rest: n || undefined })} />}
              {(fmt === 'fortime' || fmt === 'chipper') && <NumField label="Time cap" value={w.cap} suffix="min" onChange={(n) => patch({ cap: n || undefined })} />}
            </div>
            <span className="overline">Niveau</span>
            <div className="seg wod-level">{LEVELS.map((l) => <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)}>{l.label}</button>)}</div>
            <span className="muted small">Mon niveau : tes charges et tes variantes (tractions élastique, corde simple, course à la place du rameur…). Scaled : encore plus accessible.</span>
            <hr className="wod-hr" />
            {paste == null
              ? <button className="btn ghost sm" onClick={() => setPaste('')}>Coller un WOD (texte anglais)</button>
              : (
                <>
                  <textarea className="textarea" rows={7} placeholder={'21-15-9 reps for time of:\nThrusters\nPull-ups\n\n♂ 95 lb'} value={paste} onChange={(e) => setPaste(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn sm" disabled={!paste.trim()} onClick={() => { const r = parseWod(paste, w.name); open({ ...r.wod, warmup: w.warmup, cooldown: w.cooldown }, r.unknown); setPaste(null) }}>Lire le WOD</button>
                    <button className="btn ghost sm" onClick={() => setPaste(null)}>Annuler</button>
                  </div>
                </>
              )}
          </section>

          {/* -------- Colonne centrale : déroulé */}
          <div className="wod-center">
            <section className="card wod-block">
              <div className="wod-block-head"><span className="overline" style={{ color: 'var(--run)' }}>Échauffement{w.warmup ? ` · ${w.warmup.minutes}'` : ''}</span>
                {w.warmup ? <button className="link" onClick={() => patch({ warmup: null })}>Retirer</button> : <button className="link" onClick={() => patch({ warmup: { protocol: 'act-wod', minutes: 8 } })}>Ajouter</button>}
              </div>
              {w.warmup && (
                <div className="wod-inline">
                  <select className="fpill" value={w.warmup.protocol} onChange={(e) => patch({ warmup: { ...w.warmup!, protocol: e.target.value } })}>
                    {PROTOCOLS.filter((p) => p.type === 'activation' || p.type === 'classique').map((p) => <option key={p.id} value={p.id}>{p.type === 'activation' ? 'Activation' : 'Flow'} · {p.title}</option>)}
                  </select>
                  <div className="mob-durs sm">{DURATIONS.slice(0, 3).map((d) => <button key={d} className={w.warmup!.minutes === d ? 'on' : ''} onClick={() => patch({ warmup: { ...w.warmup!, minutes: d } })}>{d}<small>min</small></button>)}</div>
                </div>
              )}
            </section>

            <section className="card wod-block">
              <div className="wod-block-head"><span className="overline" style={{ color: 'var(--lift)' }}>Skill{w.skill ? ` · ${w.skill.sets} × ${w.skill.reps}` : ''}</span>
                {w.skill ? <button className="link" onClick={() => patch({ skill: null })}>Retirer</button> : <button className="link" onClick={() => patch({ skill: { key: rm[0]?.key ?? 'power-clean', sets: 5, reps: 3, load: 20 } })}>Ajouter</button>}
              </div>
              {w.skill && (
                <div className="wod-inline">
                  <select className="fpill" value={w.skill.key} onChange={(e) => patch({ skill: { ...w.skill!, key: e.target.value } })}>
                    {Object.values(WMOVES).filter((m) => m.unit === 'reps').sort((a, b) => a.fr.localeCompare(b.fr)).map((m) => <option key={m.key} value={m.key}>{m.fr}</option>)}
                  </select>
                  <span className="wod-mini"><input type="number" value={w.skill.sets} onChange={(e) => patch({ skill: { ...w.skill!, sets: +e.target.value } })} /> ×</span>
                  <span className="wod-mini"><input type="number" value={w.skill.reps} onChange={(e) => patch({ skill: { ...w.skill!, reps: +e.target.value } })} /> @</span>
                  <span className="wod-mini"><input type="number" step={2.5} value={w.skill.load ?? ''} onChange={(e) => patch({ skill: { ...w.skill!, load: e.target.value ? +e.target.value : null } })} /> kg</span>
                </div>
              )}
            </section>

            <section className="card wod-main">
              <div className="wod-block-head">
                <span className="overline" style={{ color: 'var(--wod)' }}>WOD · {formatLine(w)}</span>
                <span className="muted small">≈ {mmss(est.wodS)}{fmt === 'amrap' ? ` · ~${est.rounds} tours` : ''}</span>
              </div>
              {unknown.length > 0 && <div className="notice" style={{ color: 'var(--warn)' }}>Lignes non reconnues, à ajouter à la main : {unknown.join(' · ')}</div>}
              {w.moves.map((m, i) => {
                const r = rm[i]
                const def = WMOVES[m.key]
                const badge = fmt === 'emom' && w.emom !== 'all' ? `${i + 1}'` : String(i + 1)
                return (
                  <div key={i} className="wod-move">
                    <span className="wod-badge">{badge}</span>
                    <div className="wod-move-thumb">{(def.img || def.yt) && <img src={def.img ?? ytThumb(def.yt)!} alt="" loading="lazy" />}</div>
                    <div className="wod-move-name">
                      <strong>{r.def.fr}</strong>
                      <span className="muted small">{r.swapped ? `à la place de ${r.swapped} · ` : ''}{def.en}</span>
                      <span className="wod-map">⌚ {r.def.garmin ? r.def.garmin.split('/')[1].toLowerCase().replace(/_/g, ' ') : 'repos'}</span>
                    </div>
                    <span className="wod-mini">
                      <input type="number" placeholder={w.scheme ? w.scheme.join('-') : fmt === 'tabata' || (fmt === 'intervals' && w.intervals === 'stations') ? 'max' : ''} value={m.reps ?? ''} onChange={(e) => setMove(i, { reps: e.target.value ? +e.target.value : null })} />
                      {UNIT_FR[def.unit] || 'reps'}
                    </span>
                    {def.load ? (
                      <span className="wod-mini" title="Charge RX (homme). Le niveau choisi l'adapte.">
                        <input type="number" step={2.5} placeholder={String(def.rx ?? '')} value={m.load ?? ''} onChange={(e) => setMove(i, { load: e.target.value ? +e.target.value : null })} />
                        kg RX{level !== 'rx' && r.load != null ? <b> → {fmtKg(r.load)}</b> : null}
                      </span>
                    ) : <span className="wod-mini muted">{r.amount != null && r.def.key !== def.key && !(w.scheme && m.reps == null) ? `→ ${fmtAmount(r)}` : ''}</span>}
                    <span className="wod-row-btns">
                      <button onClick={() => moveRow(i, -1)} aria-label="Monter">↑</button>
                      <button onClick={() => moveRow(i, 1)} aria-label="Descendre">↓</button>
                      <button onClick={() => patch({ moves: w.moves.filter((_, k) => k !== i) })} aria-label="Retirer">✕</button>
                    </span>
                  </div>
                )
              })}
              <MovePicker onPick={(key) => patch({ moves: [...w.moves, { key, reps: WMOVES[key].unit === 'm' ? 400 : WMOVES[key].unit === 'cal' ? 15 : w.scheme ? null : 10 }] })} />
            </section>

            <section className="card wod-block">
              <div className="wod-block-head"><span className="overline" style={{ color: 'var(--mobility)' }}>Cooldown{w.cooldown ? ` · ${w.cooldown.minutes}'` : ''}</span>
                {w.cooldown ? <button className="link" onClick={() => patch({ cooldown: null })}>Retirer</button> : <button className="link" onClick={() => patch({ cooldown: { protocol: 'rec-wod', minutes: 8 } })}>Ajouter</button>}
              </div>
              {w.cooldown && (
                <div className="wod-inline">
                  <select className="fpill" value={w.cooldown.protocol} onChange={(e) => patch({ cooldown: { ...w.cooldown!, protocol: e.target.value } })}>
                    {PROTOCOLS.filter((p) => p.type === 'recuperation' || p.type === 'classique').map((p) => <option key={p.id} value={p.id}>{p.type === 'recuperation' ? 'Récupération' : 'Flow'} · {p.title}</option>)}
                  </select>
                  <div className="mob-durs sm">{DURATIONS.slice(0, 3).map((d) => <button key={d} className={w.cooldown!.minutes === d ? 'on' : ''} onClick={() => patch({ cooldown: { ...w.cooldown!, minutes: d } })}>{d}<small>min</small></button>)}</div>
                </div>
              )}
            </section>
          </div>

          {/* -------- Colonne droite : aperçu Garmin */}
          <section className="card wod-right">
            <span className="overline">Aperçu Garmin</span>
            <div className="wod-steps-row"><span className="muted">Étapes</span><strong>{steps} / {GARMIN_MAX * workouts.length}</strong></div>
            <div className="wod-bar"><i style={{ width: `${Math.min(100, (steps / (GARMIN_MAX * workouts.length)) * 100)}%` }} /></div>
            <span className="muted small">{workouts.length === 1 ? 'Tient en un seul entraînement.' : 'Plus de 100 étapes : envoyé en 2 entraînements enchaînés (échauffement + skill, puis WOD + cooldown).'}</span>
            <div className="wod-kpis">
              <div><span className="muted small">Durée totale</span><strong>{mmss(est.totalS)}</strong></div>
              <div><span className="muted small">Volume barre</span><strong>{est.volumeKg ? `${(est.volumeKg / 1000).toFixed(2).replace('.', ',')} t` : '–'}</strong></div>
              <div><span className="muted small">Stimulus</span><strong style={{ color: 'var(--wod)' }}>{stimulus(w, level)}</strong></div>
              <div><span className="muted small">Mouvements reliés</span><strong style={{ color: 'var(--good)' }}>{linked}/{rm.length}</strong></div>
            </div>
            {checks.length > 0 && (
              <>
                <span className="overline">Contrôles du plan</span>
                {checks.map((c) => <span key={c.t} className="small" style={{ color: c.ok ? 'var(--good)' : 'var(--warn)' }}>{c.ok ? '✓' : '!'} {c.t}</span>)}
              </>
            )}
            <label className="wod-field"><span>Planifier le</span><input type="date" className="select" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <button className="btn" disabled={busy || !w.moves.length} onClick={send}>{busy ? 'Envoi…' : '⌚ Envoyer vers la 965'}</button>
            <button className="btn ghost" disabled={!w.moves.length} onClick={saveCurrent}>{mine.wods.some((x) => x.id === w.id) ? 'Mettre à jour dans Mes WOD' : 'Enregistrer dans Mes WOD'}</button>
            <button className="link" onClick={() => open({ ...DEFAULT, id: 'w-' + Date.now(), name: 'Nouveau WOD', moves: [] })}>Nouveau WOD vierge</button>
          </section>
        </div>
      )}

      {tab === 'mine' && (
        mine.wods.length === 0
          ? <div className="empty">Aucun WOD enregistré. Crée-en un dans le créateur, ou pars d'un benchmark ou du WOD du jour.</div>
          : <div className="mob-row">{mine.wods.map((x) => <WodCard key={x.id} w={x} onOpen={() => { open(x); if (x.level) setLevel(x.level) }} onDelete={() => { if (window.confirm(`Supprimer « ${x.name} » ?`)) persistMine({ wods: mine.wods.filter((y) => y.id !== x.id) }, `wod: suppression ${x.name}`) }} />)}</div>
      )}

      {tab === 'bench' && (
        <>
          {['Girl', 'Hero', 'Classique'].map((fam) => (
            <div key={fam}>
              <h3 className="mob-h">{fam === 'Girl' ? 'Les Girls' : fam === 'Hero' ? 'Hero WODs' : 'Classiques'}</h3>
              <div className="mob-row">{BENCH.filter((b) => b.family === fam).map((b) => <WodCard key={b.id} w={b} onOpen={() => open({ ...b, id: 'w-' + Date.now() })} />)}</div>
            </div>
          ))}
        </>
      )}

      {tab === 'cf' && (
        cf == null ? <div className="muted">Chargement…</div>
          : cf.length === 0 ? <div className="empty">Pas encore de WOD récupéré : la synchro les télécharge chaque jour.</div>
            : <div className="cf-list">{cf.slice(0, 21).map((c) => <CfCard key={c.id} c={c} onOpen={(text, title) => { const r = parseWod(text, title); open(r.wod, r.unknown) }} />)}</div>
      )}
    </div>
  )
}

function WodCard({ w, onOpen, onDelete }: { w: Wod; onOpen: () => void; onDelete?: () => void }) {
  const rm = roundMoves(w, 'rx')
  return (
    <div className="wod-card" onClick={onOpen}>
      <span className="mob-tag" style={{ color: 'var(--wod)' }}>{formatLine(w)}</span>
      <strong>{w.name}</strong>
      <ul>{rm.map((r, i) => <li key={i}>{w.scheme && w.moves[i].reps == null ? '' : fmtAmount(r) || 'max'} {r.def.fr}{r.load ? <span className="muted"> {fmtKg(r.load)}</span> : null}</li>)}</ul>
      {w.note && <span className="muted small">{w.note}</span>}
      {onDelete && <button className="link" onClick={(e) => { e.stopPropagation(); onDelete() }}>Supprimer</button>}
    </div>
  )
}

function CfCard({ c, onOpen }: { c: CfWod; onOpen: (text: string, title: string) => void }) {
  const [more, setMore] = useState(false)
  const day = new Date(c.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const first = c.workout.split('\n')[0]
  const named = !/\d|^for |^complete|^every/i.test(first) && first.length < 30 ? first : null
  return (
    <section className={`card cf-card ${c.rest ? 'rest' : ''}`}>
      <div className="wod-block-head"><span className="overline">{day} · {c.id}</span><a className="small" href={c.url} target="_blank" rel="noreferrer">crossfit.com ↗</a></div>
      {c.rest ? <strong className="muted">Jour de repos</strong> : (
        <>
          <pre className="cf-text">{c.workout}</pre>
          {more && c.stimulus && <p className="small muted"><strong>Stimulus : </strong>{c.stimulus}</p>}
          {more && c.beginner && <pre className="cf-text small muted">{'Option débutant :\n' + c.beginner}</pre>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => onOpen(c.workout, named ?? `CrossFit ${c.id}`)}>Ouvrir dans le créateur</button>
            {(c.stimulus || c.beginner) && <button className="btn ghost sm" onClick={() => setMore(!more)}>{more ? 'Moins' : 'Stimulus et options'}</button>}
            {c.resources.slice(0, 3).map((r) => <a key={r.url} className="small" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>)}
          </div>
        </>
      )}
    </section>
  )
}
