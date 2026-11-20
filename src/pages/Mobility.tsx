import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedFrames, DemoVideo } from '../components/Media'
import { categorize, isoDay, type AppData } from '../lib/data'
import type { RepoConfig } from '../lib/github'
import {
  CLIPS, LIB_MOB, dailyFlow, DURATIONS, fitToDuration, fmtMin, GOWOD_EXTRA, KIND_FR, loadPerso, MOB_ZONES, MOVES, PROTOCOLS, savePerso,
  sendToGarmin, totalSeconds, TRANSITION_S, ytThumb, zoneFlow, type LibMob, type MobMove, type PersoFile, type PlayStep, type Protocol,
} from '../lib/mobility'

type Tab = 'today' | 'protocols' | 'library' | 'perso'
type Drawer =
  | { kind: 'preview'; p: Protocol }
  | { kind: 'move'; id: string }
  | { kind: 'libmove'; m: LibMob }
  | { kind: 'video'; yt: string; title: string; url?: string }
  | { kind: 'edit'; p: Protocol }
  | null


const FOCUS_KEY = 'hf.mob.focus'
const MIN_KEY = 'hf.mob.min'
const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

const firstVideo = (p: Protocol) => p.steps.map((s) => MOVES[s.id]?.yt).find(Boolean) ?? null
const TYPE_COLOR: Record<Protocol['type'], string> = { activation: 'var(--run)', recuperation: 'var(--lift)', classique: 'var(--mobility)', perso: 'var(--wod)', flow: 'var(--mobility)' }
const TYPE_FR: Record<Protocol['type'], string> = { activation: 'Activation', recuperation: 'Récupération', classique: 'Flow classique', perso: 'Mon protocole', flow: 'Flow' }

/** Protocole suggéré pour aujourd'hui : récup de la séance faite, sinon activation de la séance prévue, sinon routine selon l'heure. */
function suggestToday(data: AppData): { p: Protocol; reason: string } {
  const today = isoDay(new Date())
  const done = data.activities.filter((a) => a.start.startsWith(today)).map((a) => categorize(a, data.profile?.activityRules)).filter((c) => c !== 'other' && c !== 'mobility' && c !== 'warmup')
  const byId = (id: string) => PROTOCOLS.find((p) => p.id === id)!
  if (done.includes('run')) return { p: byId('rec-course'), reason: 'Après ta course du jour' }
  if (done.includes('wod')) return { p: byId('rec-wod'), reason: 'Après ton WOD du jour' }
  if (done.includes('strength')) return { p: byId('rec-muscu'), reason: 'Après ta séance de muscu' }
  const planned = data.calendar.find((c) => c.date === today)
  if (planned) {
    const s = (planned.sport || '').toLowerCase()
    if (s.includes('run')) return { p: byId('act-course'), reason: `Avant : ${planned.name ?? 'course'}` }
    if (s.includes('strength')) return { p: byId('act-bas'), reason: `Avant : ${planned.name ?? 'muscu'}` }
    return { p: byId('act-wod'), reason: `Avant : ${planned.name ?? 'séance'}` }
  }
  const h = new Date().getHours()
  return h >= 17 ? { p: byId('rec-soir'), reason: 'Pas de séance aujourd\'hui : détente du soir' } : { p: byId('cl-reveil'), reason: 'Pas de séance prévue : réveil articulaire' }
}

function DurationChips({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div className="mob-durs">
      {DURATIONS.map((d) => (
        <button key={d} className={value === d ? 'on' : ''} onClick={(e) => { e.stopPropagation(); onChange(d) }}>{d}<small>min</small></button>
      ))}
    </div>
  )
}

function ProtoCard({ p, onOpen, wide }: { p: Protocol; onOpen: () => void; wide?: boolean }) {
  const thumb = ytThumb(firstVideo(p))
  return (
    <button className={`mob-card ${wide ? 'wide' : ''}`} onClick={onOpen}>
      <div className="mob-card-img">{thumb && <img src={thumb} alt="" loading="lazy" />}</div>
      <div className="mob-card-txt">
        <span className="mob-tag" style={{ color: TYPE_COLOR[p.type] }}>{TYPE_FR[p.type]}</span>
        <strong>{p.title}</strong>
        {p.sub && <span className="muted small">{p.sub}</span>}
      </div>
    </button>
  )
}

function MoveTile({ name, yt, sub, onOpen, img }: { name: string; yt?: string | null; sub?: string; onOpen: () => void; img?: string | null }) {
  const src = img ?? ytThumb(yt)
  return (
    <button className="tile" onClick={onOpen}>
      <div className="tile-visual">
        {src ? <img src={src} alt="" loading="lazy" /> : <div className="mthumb muted small">Sans visuel</div>}
        {yt && <span className="tile-play">▶</span>}
      </div>
      <div className="tile-text"><span className="tile-name">{name}</span>{sub && <span className="muted small">{sub}</span>}</div>
    </button>
  )
}

// ---------------- Lecteur ----------------

let audioCtx: AudioContext | null = null
function beep(freq = 880, ms = 160) {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = freq; g.gain.value = 0.08
    o.connect(g); g.connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + ms / 1000)
  } catch { /* pas d'audio */ }
}

function Player({ title, steps, onClose }: { title: string; steps: PlayStep[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<'prep' | 'work' | 'done'>('prep')
  const [left, setLeft] = useState(TRANSITION_S)
  const [paused, setPaused] = useState(false)
  const cur = steps[idx]

  useEffect(() => {
    if (paused || phase === 'done') return
    const t = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(t)
  }, [paused, phase])

  useEffect(() => {
    if (left > 0) { if (left <= 3 && phase === 'work') beep(660, 80); return }
    if (phase === 'prep') { beep(); setPhase('work'); setLeft(steps[idx].seconds) }
    else if (phase === 'work') {
      if (idx + 1 >= steps.length) { beep(990, 400); setPhase('done') }
      else { beep(520); setIdx(idx + 1); setPhase('prep'); setLeft(TRANSITION_S) }
    }
  }, [left, phase, idx, steps])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p) } if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const go = (i: number) => { if (i < 0 || i >= steps.length) return; setIdx(i); setPhase('prep'); setLeft(TRANSITION_S) }
  const dur = phase === 'work' ? cur.seconds : TRANSITION_S
  const pct = phase === 'done' ? 1 : 1 - left / dur
  const R = 54, C = 2 * Math.PI * R
  const elapsed = steps.slice(0, idx).reduce((s, x) => s + x.seconds + TRANSITION_S, 0) + (phase === 'work' ? TRANSITION_S + cur.seconds - left : TRANSITION_S - left)
  const total = totalSeconds(steps)

  return (
    <div className="player">
      <div className="player-top">
        <div><span className="overline">{title}</span><div className="muted small">{fmtMin(elapsed)} / {fmtMin(total)}</div></div>
        <div className="player-progress"><i style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} /></div>
        <button className="drawer-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      {phase === 'done' ? (
        <div className="player-done">
          <div style={{ fontSize: 56 }}>✓</div>
          <h2>Séance terminée</h2>
          <p className="muted">{steps.length} étapes · {fmtMin(total)}</p>
          <button className="btn" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <div className="player-body">
          <div className="player-main">
            <div className="player-video">
              {cur.move.yt
                ? <iframe key={cur.move.id} src={`https://www.youtube-nocookie.com/embed/${cur.move.yt}?autoplay=1&mute=1&loop=1&playlist=${cur.move.yt}&controls=0&modestbranding=1&rel=0&playsinline=1`} title={cur.move.name} allow="autoplay; encrypted-media" />
                : <div className="mthumb muted">Pas de vidéo</div>}
            </div>
            {cur.move.yt && <a className="small muted" style={{ marginTop: -10 }} href={`https://www.youtube.com/watch?v=${cur.move.yt}`} target="_blank" rel="noreferrer">Vidéo indisponible ? L'ouvrir sur YouTube</a>}
            <div className="player-ctrl">
              <div className="player-ring">
                <svg viewBox="0 0 128 128" width="128" height="128">
                  <circle cx="64" cy="64" r={R} stroke="#2c2c2e" strokeWidth="10" fill="none" />
                  <circle cx="64" cy="64" r={R} stroke={phase === 'work' ? 'var(--mobility)' : 'var(--warn)'} strokeWidth="10" fill="none" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
                </svg>
                <div><strong>{left}</strong><span>{phase === 'prep' ? 'prépare-toi' : 'secondes'}</span></div>
              </div>
              <div className="player-name">
                <span className="overline">{idx + 1}/{steps.length}{cur.side ? ` · côté ${cur.side === 'G' ? 'gauche' : 'droit'}` : ''}</span>
                <h2>{cur.move.name}</h2>
                <span className="muted small">{KIND_FR[cur.move.kind]} · {cur.move.zones.join(', ')}</span>
                <div className="player-btns">
                  <button className="btn ghost sm" onClick={() => go(idx - 1)} disabled={idx === 0}>◀ Préc.</button>
                  <button className="btn sm" onClick={() => setPaused(!paused)}>{paused ? 'Reprendre' : 'Pause'}</button>
                  <button className="btn ghost sm" onClick={() => go(idx + 1)} disabled={idx + 1 >= steps.length}>Suiv. ▶</button>
                </div>
              </div>
            </div>
            <div className="player-fiche">
              <div><h4>Pourquoi</h4><p>{cur.move.why}</p></div>
              <div><h4>Comment</h4><ol>{cur.move.how.map((h) => <li key={h}>{h}</li>)}</ol></div>
              <div><h4>À éviter</h4><ul>{cur.move.avoid.map((h) => <li key={h}>{h}</li>)}</ul></div>
            </div>
          </div>
          <ol className="player-list">
            {steps.map((s, i) => (
              <li key={i} className={i === idx ? 'on' : i < idx ? 'past' : ''} onClick={() => go(i)}>
                <span>{s.move.name}{s.side ? ` (${s.side})` : ''}</span><span className="muted">{s.seconds} s</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ---------------- Écran ----------------

export function Mobility({ config, data }: { config: RepoConfig; data: AppData }) {
  const [tab, setTab] = useState<Tab>('today')
  const [focus, setFocusS] = useState<string[]>(() => lsGet(FOCUS_KEY, ['Hanches', 'Thoracique', 'Chevilles']))
  const [minutes, setMinutesS] = useState<number>(() => lsGet(MIN_KEY, 8))
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [playing, setPlaying] = useState<{ title: string; steps: PlayStep[] } | null>(null)
  const [perso, setPerso] = useState<PersoFile>({ protocols: [] })
  const sha = useRef<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [zoneF, setZoneF] = useState<string | null>(null)

  const setFocus = (f: string[]) => { setFocusS(f); lsSet(FOCUS_KEY, f) }
  const setMinutes = (m: number) => { setMinutesS(m); lsSet(MIN_KEY, m) }
  const today = isoDay(new Date())

  useEffect(() => { loadPerso(config).then((r) => { setPerso(r.data); sha.current = r.sha }).catch(() => {}) }, [config])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !playing) setDrawer(null) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [playing])

  const flow = useMemo(() => dailyFlow(today, focus), [today, focus])
  const sugg = useMemo(() => suggestToday(data), [data])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  async function persist(next: PersoFile, label: string) {
    try {
      sha.current = await savePerso(config, next, sha.current, label)
      setPerso(next)
      flash('Enregistré dans ton repo privé.')
    } catch (e) { flash((e as Error).message) }
  }

  const start = (p: Protocol, m = minutes) => setPlaying({ title: p.title, steps: fitToDuration(p.steps, m) })
  const byType = (t: Protocol['type']) => PROTOCOLS.filter((p) => p.type === t)

  // -------- Bibliothèque : filtres
  const f = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const match = (name: string, zones: string[]) => (!q || f(name).includes(f(q))) && (!zoneF || zones.includes(zoneF))
  const fiches = Object.values(MOVES).filter((m) => match(m.name + ' ' + (m.en ?? ''), m.zones))
  const gowod = GOWOD_EXTRA.filter((m) => match(m.name, m.zones))
  const clips = zoneF ? [] : CLIPS.filter((c) => match(c.title, []))
  const libm = LIB_MOB.filter((m) => match(m.name + ' ' + m.en, m.zones))

  return (
    <div className="mob">
      <div className="mob-head">
        <div><span className="overline">Mobilité</span><h1 style={{ margin: '4px 0 0' }}>Bouger mieux, chaque jour</h1></div>
        <div className="lib-tabs">
          {([['today', 'Aujourd\'hui'], ['protocols', 'Protocoles'], ['library', 'Bibliothèque'], ['perso', `Mes protocoles (${perso.protocols.length})`]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}

      {tab === 'today' && (
        <>
          <div className="mob-hero-row">
            <section className="mob-hero">
              <span className="overline" style={{ color: 'var(--mobility)' }}>Flow quotidien personnalisé</span>
              <h2>{flow.sub}</h2>
              <p className="muted small">Nouveau tirage chaque jour parmi les mouvements de tes zones prioritaires. Dynamiques d'abord, maintiens ensuite.</p>
              <div className="fpills">
                {MOB_ZONES.map((z) => (
                  <button key={z} className={`fpill ${focus.includes(z) ? 'on' : ''}`} onClick={() => setFocus(focus.includes(z) ? focus.filter((x) => x !== z) : [...focus, z])}>{z}</button>
                ))}
              </div>
              <div className="mob-hero-actions">
                <DurationChips value={minutes} onChange={setMinutes} />
                <button className="btn mob-go" onClick={() => start(flow)}>▶ Démarrer</button>
                <button className="btn ghost" onClick={() => setDrawer({ kind: 'preview', p: flow })}>Voir le détail</button>
              </div>
            </section>
            <section className="card mob-today" onClick={() => setDrawer({ kind: 'preview', p: sugg.p })}>
              <span className="overline">Aujourd'hui</span>
              <div className="mob-today-img">{ytThumb(firstVideo(sugg.p)) && <img src={ytThumb(firstVideo(sugg.p))!} alt="" />}</div>
              <span className="mob-tag" style={{ color: TYPE_COLOR[sugg.p.type] }}>{TYPE_FR[sugg.p.type]} · {sugg.p.title}</span>
              <span className="muted small">{sugg.reason}</span>
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); start(sugg.p) }}>▶ {minutes} min</button>
            </section>
          </div>

          <h3 className="mob-h">Activation <span className="muted small">avant la séance</span></h3>
          <div className="mob-row">{byType('activation').map((p) => <ProtoCard key={p.id} p={p} onOpen={() => setDrawer({ kind: 'preview', p })} />)}</div>
          <h3 className="mob-h">Récupération <span className="muted small">après la séance ou le soir</span></h3>
          <div className="mob-row">{byType('recuperation').map((p) => <ProtoCard key={p.id} p={p} onOpen={() => setDrawer({ kind: 'preview', p })} />)}</div>
          <h3 className="mob-h">Par zone</h3>
          <div className="mob-zones">
            {MOB_ZONES.map((z) => {
              const n = Object.values(MOVES).filter((m) => m.zones.includes(z)).length
              return <button key={z} onClick={() => setDrawer({ kind: 'preview', p: zoneFlow(z) })}><strong>{z}</strong><span className="muted small">{n} mouvement{n > 1 ? 's' : ''}</span></button>
            })}
          </div>
          {perso.protocols.length > 0 && (
            <>
              <h3 className="mob-h">Mes protocoles</h3>
              <div className="mob-row">{perso.protocols.map((p) => <ProtoCard key={p.id} p={p} onOpen={() => setDrawer({ kind: 'preview', p })} />)}</div>
            </>
          )}
        </>
      )}

      {tab === 'protocols' && (
        <>
          {(['activation', 'recuperation', 'classique'] as const).map((t) => (
            <div key={t}>
              <h3 className="mob-h">{t === 'classique' ? 'Flows classiques' : TYPE_FR[t]}</h3>
              <div className="mob-row">{byType(t).map((p) => <ProtoCard key={p.id} p={p} onOpen={() => setDrawer({ kind: 'preview', p })} />)}</div>
            </div>
          ))}
        </>
      )}

      {tab === 'library' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="searchbar"><span className="muted">⌕</span><input placeholder="Rechercher un mouvement (FR ou EN)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className="fpills">
            <button className={`fpill ${!zoneF ? 'on' : ''}`} onClick={() => setZoneF(null)}>Toutes les zones</button>
            {MOB_ZONES.map((z) => <button key={z} className={`fpill ${zoneF === z ? 'on' : ''}`} onClick={() => setZoneF(zoneF === z ? null : z)}>{z}</button>)}
          </div>
          <h3 className="mob-h">Fiches Hybrid Forge <span className="muted small">{fiches.length} · vidéo GOWOD + explications</span></h3>
          <div className="tiles">{fiches.map((m) => <MoveTile key={m.id} name={m.name} yt={m.yt} sub={`${KIND_FR[m.kind]} · ${m.zones.slice(0, 2).join(', ')}`} onOpen={() => setDrawer({ kind: 'move', id: m.id })} />)}</div>
          <h3 className="mob-h">Vidéos GOWOD <span className="muted small">{gowod.length + clips.length} · sans fiche pour l'instant</span></h3>
          <div className="tiles">
            {gowod.map((m) => <MoveTile key={m.id} name={m.name} yt={m.yt} sub={m.zones.join(', ')} onOpen={() => m.yt && setDrawer({ kind: 'video', yt: m.yt, title: m.name, url: m.url })} />)}
            {clips.map((c) => <MoveTile key={c.id} name={c.title} yt={c.id} onOpen={() => setDrawer({ kind: 'video', yt: c.id, title: c.title })} />)}
          </div>
          <h3 className="mob-h">Bibliothèque générale <span className="muted small">{libm.length} mouvements classés mobilité</span></h3>
          <div className="tiles">{libm.slice(0, 120).map((m) => <MoveTile key={m.id} name={m.name} img={m.img[0]} yt={m.yt} sub={m.en} onOpen={() => setDrawer({ kind: 'libmove', m })} />)}</div>
          {libm.length > 120 && <p className="muted small">Affine la recherche pour voir les {libm.length - 120} autres.</p>}
        </>
      )}

      {tab === 'perso' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>Tes routines, enregistrées dans ton repo privé. Pars de zéro ou copie n'importe quel protocole pour l'adapter.</p>
            <button className="btn" onClick={() => setDrawer({ kind: 'edit', p: { id: 'p-' + Date.now(), type: 'perso', title: 'Nouveau protocole', steps: [] } })}>+ Nouveau protocole</button>
          </div>
          {perso.protocols.length === 0
            ? <div className="empty">Aucun protocole perso pour l'instant.</div>
            : <div className="mob-row">{perso.protocols.map((p) => <ProtoCard key={p.id} p={p} onOpen={() => setDrawer({ kind: 'preview', p })} />)}</div>}
        </>
      )}

      {drawer && (
        <div className="drawer-bg" onClick={() => setDrawer(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawer(null)} aria-label="Fermer">✕</button>
            {drawer.kind === 'preview' && (
              <Preview p={drawer.p} minutes={minutes} setMinutes={setMinutes}
                onStart={(steps) => { setDrawer(null); setPlaying({ title: drawer.p.title, steps }) }}
                onSend={async (steps) => {
                  try { await sendToGarmin(config, drawer.p.title, today, steps); flash('Envoyé : la séance arrive sur la 965 d\'ici 1 à 2 minutes (planifiée aujourd\'hui).') }
                  catch (e) { flash((e as Error).message) }
                }}
                onCopy={() => setDrawer({ kind: 'edit', p: { id: 'p-' + Date.now(), type: 'perso', title: drawer.p.title + ' (copie)', steps: drawer.p.steps.map((s) => ({ id: s.id, prio: s.prio })) } })}
                onEdit={drawer.p.type === 'perso' ? () => setDrawer({ kind: 'edit', p: drawer.p }) : undefined}
                onMove={(id) => setDrawer({ kind: 'move', id })}
              />
            )}
            {drawer.kind === 'move' && (
              <MoveDetail m={MOVES[drawer.id]} perso={perso.protocols}
                onAdd={(pid) => {
                  const next = { protocols: perso.protocols.map((p) => (p.id === pid ? { ...p, steps: [...p.steps, { id: drawer.id }] } : p)) }
                  persist(next, 'mobilité: ajout mouvement')
                }} />
            )}
            {drawer.kind === 'libmove' && (
              <>
                <span className="overline">Bibliothèque générale</span>
                <h2 style={{ margin: 0 }}>{drawer.m.name}</h2>
                <span className="muted">{drawer.m.en}</span>
                {drawer.m.img.length > 0 && <AnimatedFrames frames={drawer.m.img} alt={drawer.m.name} />}
                {drawer.m.yt && <DemoVideo url={`https://youtu.be/${drawer.m.yt}`} />}
                {drawer.m.how.length > 0 && <ol className="small" style={{ color: 'var(--soft)', lineHeight: 1.5 }}>{drawer.m.how.map((h) => <li key={h}>{h}</li>)}</ol>}
                <span className="muted small">Zones : {drawer.m.zones.join(', ') || 'non renseignées'}</span>
              </>
            )}
            {drawer.kind === 'video' && (
              <>
                <span className="overline">Vidéo GOWOD</span>
                <h2 style={{ margin: 0 }}>{drawer.title}</h2>
                <DemoVideo url={`https://youtu.be/${drawer.yt}`} />
                {drawer.url && <a href={drawer.url} target="_blank" rel="noreferrer">Fiche sur gowod.app</a>}
                <p className="muted small">Pas encore de fiche Hybrid Forge pour ce mouvement : il n'est pas utilisé dans les protocoles.</p>
              </>
            )}
            {drawer.kind === 'edit' && (
              <Editor p={drawer.p}
                onSave={(p) => {
                  const exists = perso.protocols.some((x) => x.id === p.id)
                  const next = { protocols: exists ? perso.protocols.map((x) => (x.id === p.id ? p : x)) : [...perso.protocols, p] }
                  persist(next, `mobilité: protocole ${p.title}`).then(() => { setTab('perso'); setDrawer({ kind: 'preview', p }) })
                }}
                onDelete={perso.protocols.some((x) => x.id === drawer.p.id) ? () => {
                  persist({ protocols: perso.protocols.filter((x) => x.id !== drawer.p.id) }, 'mobilité: suppression protocole').then(() => setDrawer(null))
                } : undefined}
              />
            )}
          </div>
        </div>
      )}

      {playing && <Player title={playing.title} steps={playing.steps} onClose={() => setPlaying(null)} />}
    </div>
  )
}

function Preview({ p, minutes, setMinutes, onStart, onSend, onCopy, onEdit, onMove }: {
  p: Protocol; minutes: number; setMinutes: (m: number) => void; onStart: (s: PlayStep[]) => void; onSend: (s: PlayStep[]) => Promise<void>
  onCopy: () => void; onEdit?: () => void; onMove: (id: string) => void
}) {
  const steps = useMemo(() => fitToDuration(p.steps, minutes), [p, minutes])
  const [sending, setSending] = useState(false)
  const moves = [...new Map(steps.map((s) => [s.move.id, s])).values()]
  return (
    <>
      <span className="overline" style={{ color: TYPE_COLOR[p.type] }}>{TYPE_FR[p.type]}</span>
      <h2 style={{ margin: 0 }}>{p.title}</h2>
      {p.sub && <span className="muted">{p.sub}</span>}
      <DurationChips value={minutes} onChange={setMinutes} />
      <span className="muted small">{moves.length} mouvements · {steps.length} étapes · {fmtMin(totalSeconds(steps))} transitions comprises</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn mob-go" onClick={() => onStart(steps)} disabled={!steps.length}>▶ Démarrer</button>
        <button className="btn ghost" disabled={sending || !steps.length} onClick={async () => { setSending(true); await onSend(steps); setSending(false) }}>{sending ? 'Envoi…' : '⌚ Envoyer à la 965'}</button>
      </div>
      <ol className="mob-steps">
        {moves.map((s) => (
          <li key={s.move.id} onClick={() => onMove(s.move.id)}>
            <div className="mob-step-img">{s.move.yt && <img src={ytThumb(s.move.yt)!} alt="" loading="lazy" />}</div>
            <div style={{ flex: 1, minWidth: 0 }}><strong>{s.move.name}</strong><div className="muted small">{KIND_FR[s.move.kind]} · {s.move.zones.slice(0, 3).join(', ')}</div></div>
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{s.move.sides ? `2 × ${s.seconds} s` : `${s.seconds} s`}</span>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onEdit ? <button className="btn ghost sm" onClick={onEdit}>Modifier</button> : <button className="btn ghost sm" onClick={onCopy}>Copier dans mes protocoles</button>}
      </div>
      <p className="muted small">Sur la montre : un entraînement « Mobilité · {p.title} » avec un exercice chronométré par étape, planifié aujourd'hui.</p>
    </>
  )
}

function MoveDetail({ m, perso, onAdd }: { m: MobMove; perso: Protocol[]; onAdd: (pid: string) => void }) {
  const [pid, setPid] = useState(perso[0]?.id ?? '')
  return (
    <>
      <span className="overline">{KIND_FR[m.kind]}{m.sides ? ' · des deux côtés' : ''}</span>
      <h2 style={{ margin: 0 }}>{m.name}</h2>
      {m.en && <span className="muted">{m.en}</span>}
      {m.yt && <DemoVideo url={`https://youtu.be/${m.yt}`} />}
      <div className="fpills">{m.zones.map((z) => <span key={z} className="pill">{z}</span>)}</div>
      <div className="player-fiche col">
        <div><h4>Pourquoi</h4><p>{m.why}</p></div>
        <div><h4>Comment</h4><ol>{m.how.map((h) => <li key={h}>{h}</li>)}</ol></div>
        <div><h4>À éviter</h4><ul>{m.avoid.map((h) => <li key={h}>{h}</li>)}</ul></div>
      </div>
      <span className="muted small">Sur la Garmin : {m.garminName ?? m.garmin}</span>
      {m.url && <a className="small" href={m.url} target="_blank" rel="noreferrer">Fiche d'origine sur gowod.app</a>}
      {perso.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select" value={pid} onChange={(e) => setPid(e.target.value)} style={{ flex: 1 }}>
            {perso.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button className="btn sm" onClick={() => pid && onAdd(pid)}>Ajouter</button>
        </div>
      )}
    </>
  )
}

function Editor({ p, onSave, onDelete }: { p: Protocol; onSave: (p: Protocol) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(p.title)
  const [steps, setSteps] = useState(p.steps.map((s) => s.id))
  const [q, setQ] = useState('')
  const f = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const found = q.length < 2 ? [] : Object.values(MOVES).filter((m) => f(m.name + ' ' + (m.en ?? '') + ' ' + m.zones.join(' ')).includes(f(q))).slice(0, 8)
  const mv = (i: number, d: number) => { const s = [...steps]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; setSteps(s) }
  return (
    <>
      <span className="overline">Mon protocole</span>
      <label className="field"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nom du protocole" /></label>
      <span className="muted small">L'ordre compte : la durée choisie (3, 8, 15 ou 22 min) garde les premiers mouvements et ajuste les temps.</span>
      <ol className="mob-steps edit">
        {steps.map((id, i) => (
          <li key={id + i}>
            <div className="mob-step-img">{MOVES[id]?.yt && <img src={ytThumb(MOVES[id].yt)!} alt="" />}</div>
            <strong style={{ flex: 1 }}>{MOVES[id]?.name ?? id}</strong>
            <button onClick={() => mv(i, -1)} aria-label="Monter">↑</button>
            <button onClick={() => mv(i, 1)} aria-label="Descendre">↓</button>
            <button onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label="Retirer">✕</button>
          </li>
        ))}
      </ol>
      <div className="searchbar"><span className="muted">＋</span><input placeholder="Ajouter un mouvement (nom ou zone)" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {found.map((m) => (
        <button key={m.id} className="mob-add" onClick={() => { setSteps([...steps, m.id]); setQ('') }}>
          <strong>{m.name}</strong><span className="muted small">{m.zones.join(', ')}</span>
        </button>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" disabled={!steps.length || !title.trim()} onClick={() => onSave({ ...p, type: 'perso', title: title.trim(), sub: `${steps.length} mouvements`, steps: steps.map((id) => ({ id })) })}>Enregistrer</button>
        {onDelete && <button className="btn ghost" onClick={() => { if (window.confirm('Supprimer ce protocole ?')) onDelete() }}>Supprimer</button>}
      </div>
    </>
  )
}
