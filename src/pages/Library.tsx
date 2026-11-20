import { useEffect, useMemo, useState } from 'react'
import { BodyMap, MuscleThumb, ZONES, ZoneSelector } from '../components/BodyMap'
import { AnimatedFrames, DemoVideo } from '../components/Media'
import type { RepoConfig } from '../lib/github'
import { displayName, otherName, useMovementLang } from '../lib/lang'
import {
  buildReverse, CAT_META, effectiveGarmin, EQUIP_FR, fold, garminKey, loadLibraryData, matchBand, saveCustom, saveOverrides, slugify,
  type ExerciseHistory, type GarminExercise, type Movement, type Overrides,
} from '../lib/library'

type LibData = Awaited<ReturnType<typeof loadLibraryData>>
type Selection = { kind: 'movement'; id: string } | { kind: 'history'; key: string } | { kind: 'new' } | null

const CATS: (Movement['cat'] | 'all')[] = ['all', 'muscu', 'halto', 'gainage', 'wod', 'plyo', 'cardio', 'mobilite']
const EQUIPS = ['barbell', 'dumbbell', 'kettlebell', 'suspension', 'cable', 'band', 'body', 'medball', 'ezbar']
const PAGE = 48

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const kg = (v: number | null | undefined) => (v ? `${String(v).replace('.', ',')} kg` : 'PDC')

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Libellé Garmin d'un exercice (traduit si possible). */
function prettyGarmin(key: string, d: { garmin: GarminExercise[]; garminFr: Record<string, string> }, fr = true) {
  if (fr && d.garminFr[key]) return d.garminFr[key]
  const [c, e] = key.split('/')
  const g = d.garmin.find((x) => x.category === c && x.exercise === e)
  return g?.name ?? cap(e ? e.toLowerCase().replace(/_/g, ' ') : `${c.toLowerCase().replace(/_/g, ' ')} (catégorie seule)`)
}

export function Library({ config }: { config: RepoConfig }) {
  const [d, setD] = useState<LibData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'explore' | 'mine'>('explore')
  const [q, setQ] = useState('')
  const [zone, setZone] = useState<string | null>(null)
  const [cat, setCat] = useState<Movement['cat'] | 'all'>('all')
  const [eq, setEq] = useState<string>('all')
  const [onlyMine, setOnlyMine] = useState(true)
  const [withSecondary, setWithSecondary] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [sel, setSel] = useState<Selection>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [lang, setLang] = useMovementLang()

  useEffect(() => {
    loadLibraryData(config).then(setD).catch((e) => setErr((e as Error).message))
  }, [config])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const reverse = useMemo(() => (d ? buildReverse(d.lib, d.overrides) : new Map<string, Movement>()), [d])
  const byId = useMemo(() => new Map((d?.lib ?? []).map((m) => [m.id, m])), [d])

  // historique rattaché à chaque mouvement (via l'exercice Garmin enregistré)
  const histByMove = useMemo(() => {
    const out = new Map<string, ExerciseHistory>()
    if (!d) return out
    for (const [k, h] of Object.entries(d.history)) {
      const m = reverse.get(k)
      if (m && (!out.has(m.id) || out.get(m.id)!.sessions.length < h.sessions.length)) out.set(m.id, h)
    }
    return out
  }, [d, reverse])

  const zoneDef = ZONES.find((z) => z.label === zone)
  const filtered = useMemo(() => {
    if (!d) return []
    const fq = fold(q.trim())
    const list = d.lib.filter((m) => {
      if (cat !== 'all' && m.cat !== cat) return false
      if (onlyMine && !m.mine) return false
      if (eq !== 'all' && m.eq !== eq) return false
      if (zoneDef) {
        const worked = withSecondary ? [...m.pm, ...m.sm] : m.pm
        if (!worked.some((x) => zoneDef.muscles.includes(x))) return false
      }
      if (fq && !fold(`${m.name} ${m.en}`).includes(fq)) return false
      return true
    })
    // d'abord ce que tu fais déjà, puis ce qui a une image
    const rank = (m: Movement) => (histByMove.has(m.id) ? 0 : m.img.length ? 1 : 2)
    return list.sort((a, b) => rank(a) - rank(b) || (histByMove.get(b.id)?.sessions.length ?? 0) - (histByMove.get(a.id)?.sessions.length ?? 0) || displayName(a, lang).localeCompare(displayName(b, lang)))
  }, [d, q, cat, eq, onlyMine, withSecondary, zoneDef, histByMove, lang])

  const historyKeys = useMemo(() => {
    if (!d) return []
    return Object.entries(d.history).sort((a, b) => b[1].lastDate.localeCompare(a[1].lastDate) || b[1].totalSets - a[1].totalSets)
  }, [d])
  const toReview = historyKeys.filter(([k]) => d && !d.overrides.confirmed[k] && !d.overrides.alias[k])

  async function update(mutator: (o: Overrides) => Overrides, msg: string) {
    if (!d) return
    setSaving('Enregistrement…')
    const next = mutator(structuredClone(d.overrides))
    try {
      const sha = await saveOverrides(config, next, d.sha, msg)
      setD({ ...d, overrides: next, sha })
      setSaving('Enregistré.')
      setTimeout(() => setSaving(null), 1500)
    } catch (e) {
      setSaving((e as Error).message)
    }
  }

  async function addCustom(m: Movement) {
    if (!d) return
    setSaving('Enregistrement…')
    const list = [m, ...d.custom.filter((x) => x.id !== m.id)]
    try {
      const customSha = await saveCustom(config, list, d.customSha, `bibliothèque: nouveau mouvement ${m.en}`)
      setD({ ...d, custom: list, customSha, lib: [m, ...d.lib.filter((x) => x.id !== m.id)] })
      setSel({ kind: 'movement', id: m.id })
      setSaving('Mouvement ajouté.')
      setTimeout(() => setSaving(null), 1500)
    } catch (e) {
      setSaving((e as Error).message)
    }
  }

  if (err) return <div className="notice err">{err}</div>
  if (!d) return <div className="muted">Chargement de la bibliothèque…</div>

  const title = q.trim() ? `« ${q.trim()} »` : zone ?? (cat !== 'all' ? CAT_META[cat].label : 'Tous les mouvements')

  return (
    <>
      <header className="lib-head">
        <div className="between" style={{ alignItems: 'flex-end' }}>
          <div className="lib-tabs">
            <h1>Bibliothèque</h1>
            <button className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}>Explorer</button>
            <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
              Mes mouvements{toReview.length ? <span className="badge">{toReview.length}</span> : null}
            </button>
          </div>
          <div className="lang" role="group" aria-label="Langue des noms">
            <button aria-pressed={lang === 'fr'} className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
            <span className="muted">/</span>
            <button aria-pressed={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
        {tab === 'explore' && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="searchbar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span className="sr">Rechercher</span>
              <input type="search" placeholder="Rechercher un mouvement, en français ou en anglais" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} />
            </label>
            <button className="plus" aria-label="Nouveau mouvement" title="Nouveau mouvement" onClick={() => setSel({ kind: 'new' })}>+</button>
          </div>
        )}
      </header>
      {saving && <div className="notice">{saving}</div>}

      {tab === 'explore' ? (
        <div className="lib-body">
          <aside className="zone-panel" aria-label="Filtres">
            <span className="overline">Touche une zone</span>
            <ZoneSelector selected={zone} onSelect={(z) => { setZone(z); setLimit(PAGE) }} />
            {zone && (
              <div className="zone-pill">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{zone}</span>
                  <span className="small" style={{ color: '#bae6fd' }}>{filtered.length} mouvements</span>
                </div>
                <button aria-label="Effacer la zone" onClick={() => setZone(null)}>×</button>
              </div>
            )}
            <div className="fpills">
              <button className={`fpill ${onlyMine ? 'on' : ''}`} aria-pressed={onlyMine} onClick={() => setOnlyMine(!onlyMine)}>{onlyMine ? '✓ ' : ''}Mon matériel</button>
              <label className="sr" htmlFor="f-cat">Type</label>
              <select id="f-cat" className={`fpill ${cat !== 'all' ? 'on' : ''}`} value={cat} onChange={(e) => { setCat(e.target.value as Movement['cat'] | 'all'); setLimit(PAGE) }}>
                <option value="all">Tous types</option>
                {CATS.filter((c) => c !== 'all').map((c) => <option key={c} value={c}>{CAT_META[c as Movement['cat']].label}</option>)}
              </select>
              <label className="sr" htmlFor="f-eq">Matériel</label>
              <select id="f-eq" className={`fpill ${eq !== 'all' ? 'on' : ''}`} value={eq} onChange={(e) => { setEq(e.target.value); setLimit(PAGE) }}>
                <option value="all">Tout matériel</option>
                {EQUIPS.map((x) => <option key={x} value={x}>{EQUIP_FR[x]}</option>)}
              </select>
              {zone && <button className={`fpill ${withSecondary ? 'on' : ''}`} aria-pressed={withSecondary} onClick={() => setWithSecondary(!withSecondary)}>{withSecondary ? '✓ ' : ''}Muscles secondaires</button>}
            </div>
          </aside>

          <section className="results" aria-label="Mouvements">
            <div className="between" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 20, fontWeight: 800 }}>{title}</span>
              <span className="small muted">{filtered.length} · les plus faits d'abord</span>
            </div>
            {filtered.length === 0 && <div className="empty">Aucun mouvement avec ces filtres.</div>}
            <div className="tiles">
              {filtered.slice(0, limit).map((m) => {
                const g = effectiveGarmin(m, d.overrides)
                const band = matchBand(g.s, g.locked)
                const h = histByMove.get(m.id)
                return (
                  <Tile key={m.id} m={m} lang={lang} onClick={() => setSel({ kind: 'movement', id: m.id })}
                    badge={h ? `${h.sessions.length} séance${h.sessions.length > 1 ? 's' : ''}` : undefined}
                    meta={<>{EQUIP_FR[m.eq] ?? m.eq} · <span style={{ color: band.color }}>Garmin {band.label.toLowerCase()}</span></>}
                    sub={h?.bestWeight ? `Ton max : ${kg(h.bestWeight[1])} × ${h.bestWeight[0]}` : undefined} />
                )
              })}
            </div>
            {filtered.length > limit && <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>Afficher plus ({filtered.length - limit})</button>}
          </section>
        </div>
      ) : (
        <section className="results" aria-label="Mes mouvements">
          <span className="small muted">Les exercices enregistrés par ta Garmin. Valide chaque libellé ou indique le mouvement réellement fait.</span>
          <div className="tiles">
            {historyKeys.map(([k, h]) => {
              const m = reverse.get(k)
              const ok = d.overrides.confirmed[k] || d.overrides.alias[k]
              return (
                <Tile key={k} m={m} lang={lang} onClick={() => setSel({ kind: 'history', key: k })}
                  name={m ? undefined : prettyGarmin(k, d, lang === 'fr')}
                  badge={ok ? undefined : 'À vérifier'} badgeWarn={!ok}
                  meta={<>{h.sessions.length} séance{h.sessions.length > 1 ? 's' : ''} · {fmtDate(h.lastDate)}</>}
                  sub={h.bestWeight ? `Max : ${kg(h.bestWeight[1])} × ${h.bestWeight[0]}` : h.bestReps ? `Max : ${h.bestReps} reps` : undefined} />
              )
            })}
          </div>
        </section>
      )}

      {sel && (
        <div className="drawer-bg" onClick={() => setSel(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Détail" onClick={(e) => e.stopPropagation()}>
            <button className="drawer-close" aria-label="Fermer" onClick={() => setSel(null)}>×</button>
            {sel.kind === 'new' && <NewMovement d={d} onSave={addCustom} onCancel={() => setSel(null)} />}
            {sel.kind === 'movement' && byId.get(sel.id) && <MovementDetail m={byId.get(sel.id)!} d={d} reverse={reverse} update={update} />}
            {sel.kind === 'history' && (
              <HistoryDetail k={sel.key} h={d.history[sel.key]} d={d} reverse={reverse} update={update} openMovement={(id) => setSel({ kind: 'movement', id })} />
            )}
          </aside>
        </div>
      )}
    </>
  )
}

function Tile({ m, lang, onClick, meta, sub, badge, badgeWarn, name }: {
  m?: Movement; lang: 'fr' | 'en'; onClick: () => void; meta: React.ReactNode; sub?: string; badge?: string; badgeWarn?: boolean; name?: string
}) {
  return (
    <button className="tile" onClick={onClick}>
      <div className="tile-visual">
        {m && m.img.length > 0 ? (
          <>
            <img src={m.img[0]} alt="" loading="lazy" />
            {m.img[1] && <img className="alt" src={m.img[1]} alt="" loading="lazy" />}
          </>
        ) : (
          <MuscleThumb primary={m?.pm ?? []} secondary={m?.sm ?? []} />
        )}
        {badge && <span className="tile-badge" style={badgeWarn ? { background: 'var(--warn)', color: '#000' } : undefined}>{badge}</span>}
      </div>
      <div className="tile-text">
        <span className="tile-name">{name ?? (m ? displayName(m, lang) : '')}</span>
        <span className="small muted">{meta}</span>
        {sub && <span className="small" style={{ color: 'var(--good)', fontWeight: 600 }}>{sub}</span>}
      </div>
    </button>
  )
}

function GarminCard({ m, d, update }: { m: Movement; d: LibData; update: (f: (o: Overrides) => Overrides, msg: string) => void }) {
  const [picking, setPicking] = useState(false)
  const g = effectiveGarmin(m, d.overrides)
  const band = matchBand(g.s, g.locked)
  return (
    <div className="gcard" style={{ background: band.bg, borderColor: band.border }}>
      <div className="between">
        <span className="small" style={{ fontWeight: 700, color: band.color }}>CORRESPONDANCE GARMIN</span>
        <span className="small" style={{ fontWeight: 700, color: band.color }}>{band.label}{g.locked ? '' : ` · ${g.s} %`}</span>
      </div>
      <div className="stats2">
        <div className="stat"><span className="k">Catégorie</span><span style={{ fontWeight: 600 }}>{g.c.replace(/_/g, ' ').toLowerCase()}</span></div>
        <div className="stat"><span className="k">Exercice Garmin</span><span style={{ fontWeight: 600 }}>{g.n}</span></div>
      </div>
      {!g.locked && m.g.length > 1 && (
        <span className="small muted">Autres candidats : {m.g.slice(1).map((x) => `${x.n} (${x.s} %)`).join(', ')}</span>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost sm" onClick={() => setPicking(!picking)}>{picking ? 'Annuler' : 'Changer'}</button>
        {!g.locked && <button className="btn ghost sm" onClick={() => update((o) => ({ ...o, map: { ...o.map, [m.id]: { c: g.c, e: g.e, n: g.n } } }), `bibliothèque: verrouille ${m.en}`)}>Verrouiller</button>}
        {g.locked && <button className="btn ghost sm" onClick={() => update((o) => { const map = { ...o.map }; delete map[m.id]; return { ...o, map } }, `bibliothèque: déverrouille ${m.en}`)}>Déverrouiller</button>}
      </div>
      {picking && (
        <Picker
          items={d.garmin.map((x) => ({ id: garminKey(x.category, x.exercise), label: x.name, sub: x.category.replace(/_/g, ' ').toLowerCase() }))}
          initial={m.en.split(' ').slice(-1)[0]}
          onPick={(id) => {
            const x = d.garmin.find((y) => garminKey(y.category, y.exercise) === id)!
            setPicking(false)
            update((o) => ({ ...o, map: { ...o.map, [m.id]: { c: x.category, e: x.exercise, n: x.name } } }), `bibliothèque: ${m.en} -> ${x.name}`)
          }}
        />
      )}
    </div>
  )
}

function Picker({ items, onPick, initial = '' }: { items: { id: string; label: string; sub?: string }[]; onPick: (id: string) => void; initial?: string }) {
  const [q, setQ] = useState(initial)
  const res = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    return items.filter((i) => words.every((w) => fold(`${i.label} ${i.sub ?? ''}`).includes(w))).slice(0, 40)
  }, [q, items])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="search" style={{ flex: 'none' }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher" />
      <div className="picker">
        {res.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id)}>
            <span>{r.label}</span>{r.sub && <span className="small muted">{r.sub}</span>}
          </button>
        ))}
        {!res.length && <span className="small muted" style={{ padding: 8 }}>Aucun résultat</span>}
      </div>
    </div>
  )
}

function MovementDetail({ m, d, reverse, update }: { m: Movement; d: LibData; reverse: Map<string, Movement>; update: (f: (o: Overrides) => Overrides, msg: string) => void }) {
  const [lang] = useMovementLang()
  const [videoInput, setVideoInput] = useState('')
  const video = d.overrides.video[m.id] ?? m.video
  const keys = [...reverse.entries()].filter(([, v]) => v.id === m.id).map(([k]) => k).filter((k) => d.history[k])
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="small" style={{ fontWeight: 700, color: CAT_META[m.cat].color }}>{CAT_META[m.cat].label.toUpperCase()} · {(EQUIP_FR[m.eq] ?? m.eq).toUpperCase()}</span>
        <h2 className="h2">{displayName(m, lang)}</h2>
        {m.name !== m.en && <span className="small muted">{otherName(m, lang)}</span>}
      </div>
      {video && <DemoVideo url={video} />}
      {!video && m.img.length > 0 && <AnimatedFrames frames={m.img} alt={`${m.en}, démonstration`} />}
      {!video && !m.img.length && <div className="empty">Pas d'image pour ce mouvement. Ajoute un lien vidéo ci-dessous (YouTube, fichier vidéo, Instagram…).</div>}
      <BodyMap primary={m.pm} secondary={m.sm} />
      {(m.pm.length > 0 || m.sm.length > 0) && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {m.pm.map((x) => <span key={x} className="mtag strong">{x}</span>)}
          {m.sm.map((x) => <span key={x} className="mtag">{x}</span>)}
        </div>
      )}
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
        e.preventDefault()
        const url = videoInput.trim()
        if (!/^https?:\/\//.test(url)) return
        setVideoInput('')
        update((o) => ({ ...o, video: { ...o.video, [m.id]: url } }), `bibliothèque: vidéo pour ${m.en}`)
      }}>
        <input className="search" style={{ height: 38 }} type="url" placeholder={video ? 'Remplacer la vidéo (lien)…' : 'Ajouter une vidéo (lien)…'} aria-label="Lien vidéo" value={videoInput} onChange={(e) => setVideoInput(e.target.value)} />
        <button className="btn ghost sm" type="submit" disabled={!videoInput.trim()}>Ajouter</button>
        {d.overrides.video[m.id] && <button className="btn ghost sm" type="button" onClick={() => update((o) => { const v = { ...o.video }; delete v[m.id]; return { ...o, video: v } }, `bibliothèque: retire la vidéo de ${m.en}`)}>Retirer</button>}
      </form>
      <GarminCard m={m} d={d} update={update} />
      {keys.map((k) => <HistoryTable key={k} h={d.history[k]} title={`Mon historique (${prettyGarmin(k, d)})`} />)}
      {m.how.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', fontWeight: 600 }}>CONSIGNES (EN ANGLAIS POUR L'INSTANT)</summary>
          <ol className="how">{m.how.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      )}
    </>
  )
}

function HistoryTable({ h, title }: { h: ExerciseHistory; title: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="small muted" style={{ fontWeight: 600 }}>{title.toUpperCase()}</span>
      <div className="hist">
        {h.bestWeight && <div className="between"><span className="muted">Meilleure charge</span><span>{kg(h.bestWeight[1])} × {h.bestWeight[0]}</span></div>}
        {!h.bestWeight && h.bestReps && <div className="between"><span className="muted">Meilleure série</span><span>{h.bestReps} reps</span></div>}
        {h.sessions.slice(0, 6).map((s) => (
          <div key={`${s.activityId}`} className="between">
            <span className="muted">{fmtDate(s.date)} · {s.activity}</span>
            <span>{s.sets.map((r) => (r[0] ? `${r[0]}${r[1] ? `@${String(r[1]).replace('.', ',')}` : ''}` : `${Math.round(r[2] ?? 0)}s`)).join(' · ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryDetail({ k, h, d, reverse, update, openMovement }: {
  k: string; h: ExerciseHistory; d: LibData; reverse: Map<string, Movement>
  update: (f: (o: Overrides) => Overrides, msg: string) => void; openMovement: (id: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [lang] = useMovementLang()
  const m = reverse.get(k)
  const aliased = d.overrides.alias[k]
  const confirmed = d.overrides.confirmed[k]
  const libItems = useMemo(() => d.lib.filter((x) => x.mine).map((x) => ({ id: x.id, label: displayName(x, lang), sub: otherName(x, lang) })), [d.lib, lang])
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="small muted" style={{ fontWeight: 600 }}>ENREGISTRÉ PAR LA GARMIN</span>
        <h2 className="h2">{prettyGarmin(k, d, false)}</h2>
        <span className="small muted">{k.replace('/', ' › ')}</span>
      </div>
      <div className="gcard" style={{ background: '#141416', borderColor: 'var(--border)' }}>
        <span className="small muted" style={{ fontWeight: 600 }}>MOUVEMENT RÉELLEMENT FAIT</span>
        {m ? (
          <button className="linklike" onClick={() => openMovement(m.id)}>{displayName(m, lang)}{m.name !== m.en ? <span className="small muted"> · {otherName(m, lang)}</span> : null}</button>
        ) : <span className="muted small">Pas encore de fiche associée : utilise « En réalité c'est… » pour la relier.</span>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!confirmed && !aliased && <button className="btn sm" onClick={() => update((o) => ({ ...o, confirmed: { ...o.confirmed, [k]: true } }), `bibliothèque: valide ${k}`)}>C'est bien ça</button>}
          <button className="btn ghost sm" onClick={() => setPicking(!picking)}>{picking ? 'Annuler' : 'En réalité c\'est…'}</button>
          {(confirmed || aliased) && (
            <button className="btn ghost sm" onClick={() => update((o) => { const a = { ...o.alias }; const c = { ...o.confirmed }; delete a[k]; delete c[k]; return { ...o, alias: a, confirmed: c } }, `bibliothèque: réinitialise ${k}`)}>Réinitialiser</button>
          )}
        </div>
        {picking && (
          <Picker items={libItems} onPick={(id) => { setPicking(false); update((o) => ({ ...o, alias: { ...o.alias, [k]: id } }), `bibliothèque: ${k} = ${id}`) }} />
        )}
      </div>
      <HistoryTable h={h} title="Historique" />
    </>
  )
}

const MUSCLES = ['Pectoraux', 'Épaules', 'Deltoïdes avant', 'Deltoïdes arrière', 'Trapèzes', 'Grand dorsal', 'Milieu du dos', 'Lombaires', 'Biceps', 'Triceps', 'Avant-bras', 'Abdominaux', 'Obliques', 'Fessiers', 'Quadriceps', 'Ischios', 'Adducteurs', 'Abducteurs', 'Mollets', 'Cou']

function NewMovement({ d, onSave, onCancel }: { d: LibData; onSave: (m: Movement) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [en, setEn] = useState('')
  const [cat, setCat] = useState<Movement['cat']>('muscu')
  const [eq, setEq] = useState('dumbbell')
  const [pm, setPm] = useState<string[]>([])
  const [sm, setSm] = useState<string[]>([])
  const [video, setVideo] = useState('')
  const [notes, setNotes] = useState('')
  const [garmin, setGarmin] = useState<GarminExercise | null>(null)
  const garminItems = useMemo(() => d.garmin.map((x) => ({ id: garminKey(x.category, x.exercise), label: x.name, sub: x.category.replace(/_/g, ' ').toLowerCase() })), [d.garmin])
  const cycle = (m: string) => {
    if (pm.includes(m)) { setPm(pm.filter((x) => x !== m)); setSm([...sm, m]) }
    else if (sm.includes(m)) setSm(sm.filter((x) => x !== m))
    else setPm([...pm, m])
  }
  const valid = (name.trim() || en.trim()) && garmin
  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={(e) => {
      e.preventDefault()
      if (!valid || !garmin) return
      const fr = name.trim() || en.trim()
      const eng = en.trim() || fr
      onSave({
        id: `custom:${slugify(eng)}`, name: fr, en: eng, cat, eq, mine: true, pm, sm, lvl: null,
        how: notes.trim() ? notes.trim().split('\n').filter(Boolean) : [], img: [],
        g: [{ c: garmin.category, e: garmin.exercise, n: garmin.name, s: 100 }], src: 'custom',
        ...(video.trim() ? { video: video.trim() } : {}),
      })
    }}>
      <span className="overline">Nouveau mouvement</span>
      <label className="field">Nom en français<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Serrage dorsal haltères" /></label>
      <label className="field">Nom en anglais<input value={en} onChange={(e) => setEn(e.target.value)} placeholder="Dumbbell Back Squeeze" /></label>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1 }}>Catégorie
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value as Movement['cat'])}>
            {Object.entries(CAT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>Matériel
          <select className="select" value={eq} onChange={(e) => setEq(e.target.value)}>
            {EQUIPS.map((k) => <option key={k} value={k}>{EQUIP_FR[k]}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small muted">Muscles : 1 clic = principal, 2 clics = secondaire, 3 clics = retirer</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {MUSCLES.map((m) => (
            <button type="button" key={m} className={`mtag ${pm.includes(m) ? 'strong' : ''}`} style={{ border: sm.includes(m) ? '1px solid #7dd3fc' : '1px solid transparent', cursor: 'pointer' }} onClick={() => cycle(m)}>{m}</button>
          ))}
        </div>
        <BodyMap primary={pm} secondary={sm} />
      </div>
      <label className="field">Lien vidéo (facultatif)<input type="url" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://…" /></label>
      <label className="field">Consignes (une par ligne, facultatif)<textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="small muted">Équivalent Garmin (obligatoire pour l'envoi sur la montre){garmin ? ` : ${garmin.name}` : ''}</span>
        <Picker items={garminItems} initial={en.split(' ').slice(-1)[0] ?? ''} onPick={(id) => setGarmin(d.garmin.find((x) => garminKey(x.category, x.exercise) === id) ?? null)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" type="submit" disabled={!valid}>Enregistrer</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  )
}
