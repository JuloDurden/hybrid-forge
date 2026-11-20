import Model, { type Muscle } from 'react-body-highlighter'

// Muscles de la bibliothèque (FR) -> zones du schéma
const MAP: Record<string, Muscle[]> = {
  Abdominaux: ['abs', 'obliques'],
  Obliques: ['obliques'],
  Abducteurs: ['abductors'],
  Adducteurs: ['adductor'],
  Biceps: ['biceps'],
  Mollets: ['calves', 'left-soleus', 'right-soleus'],
  Pectoraux: ['chest'],
  'Avant-bras': ['forearm'],
  Fessiers: ['gluteal'],
  Ischios: ['hamstring'],
  'Grand dorsal': ['upper-back'],
  Lombaires: ['lower-back'],
  'Milieu du dos': ['upper-back', 'trapezius'],
  Cou: ['neck'],
  Quadriceps: ['quadriceps'],
  Épaules: ['front-deltoids', 'back-deltoids'],
  'Deltoïdes avant': ['front-deltoids'],
  'Deltoïdes arrière': ['back-deltoids'],
  Trapèzes: ['trapezius'],
  Triceps: ['triceps'],
}

const toSlugs = (ms: string[]) => [...new Set(ms.flatMap((m) => MAP[m] ?? []))]

/** Schéma face/dos : muscles principaux en couleur pleine, secondaires en couleur atténuée. */
export function BodyMap({ primary, secondary }: { primary: string[]; secondary: string[] }) {
  const p = toSlugs(primary)
  const s = toSlugs(secondary).filter((x) => !p.includes(x))
  if (!p.length && !s.length) return null
  // la couleur dépend du nombre d'occurrences : principal = 2, secondaire = 1
  const data = [
    { name: 'principal', muscles: p },
    { name: 'principal bis', muscles: p },
    { name: 'secondaire', muscles: s },
  ]
  const common = {
    data,
    bodyColor: '#3f3f46',
    highlightedColors: ['#0e7490', '#7dd3fc'],
    style: { width: '100%' },
    svgStyle: { width: '100%', height: 'auto' },
  }
  return (
    <figure className="bodymap" aria-label={`Muscles principaux : ${primary.join(', ') || 'aucun'}. Secondaires : ${secondary.join(', ') || 'aucun'}.`}>
      <div><Model {...common} type="anterior" /><span>Face</span></div>
      <div><Model {...common} type="posterior" /><span>Dos</span></div>
      <figcaption>
        <span><i style={{ background: '#7dd3fc' }} /> Principal</span>
        <span><i style={{ background: '#0e7490' }} /> Secondaire</span>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------- sélection par zone

/** Zones cliquables : zone du schéma -> libellé de filtre + muscles de la bibliothèque correspondants. */
export const ZONES: { label: string; slugs: Muscle[]; muscles: string[] }[] = [
  { label: 'Pectoraux', slugs: ['chest'], muscles: ['Pectoraux'] },
  { label: 'Épaules', slugs: ['front-deltoids', 'back-deltoids'], muscles: ['Épaules', 'Deltoïdes avant', 'Deltoïdes arrière'] },
  { label: 'Trapèzes', slugs: ['trapezius'], muscles: ['Trapèzes'] },
  { label: 'Dos', slugs: ['upper-back'], muscles: ['Grand dorsal', 'Milieu du dos'] },
  { label: 'Lombaires', slugs: ['lower-back'], muscles: ['Lombaires'] },
  { label: 'Biceps', slugs: ['biceps'], muscles: ['Biceps'] },
  { label: 'Triceps', slugs: ['triceps'], muscles: ['Triceps'] },
  { label: 'Avant-bras', slugs: ['forearm'], muscles: ['Avant-bras'] },
  { label: 'Abdos', slugs: ['abs', 'obliques'], muscles: ['Abdominaux', 'Obliques'] },
  { label: 'Fessiers', slugs: ['gluteal'], muscles: ['Fessiers'] },
  { label: 'Quadriceps', slugs: ['quadriceps'], muscles: ['Quadriceps'] },
  { label: 'Ischios', slugs: ['hamstring'], muscles: ['Ischios'] },
  { label: 'Adducteurs', slugs: ['adductor'], muscles: ['Adducteurs'] },
  { label: 'Abducteurs', slugs: ['abductors'], muscles: ['Abducteurs'] },
  { label: 'Mollets', slugs: ['calves', 'left-soleus', 'right-soleus'], muscles: ['Mollets'] },
  { label: 'Cou', slugs: ['neck'], muscles: ['Cou'] },
]

export function ZoneSelector({ selected, onSelect }: { selected: string | null; onSelect: (label: string | null) => void }) {
  const zone = ZONES.find((z) => z.label === selected)
  const data = zone ? [{ name: zone.label, muscles: zone.slugs }] : []
  const click = (s: { muscle: Muscle }) => {
    const z = ZONES.find((x) => x.slugs.includes(s.muscle))
    if (z) onSelect(z.label === selected ? null : z.label)
  }
  const common = {
    data,
    bodyColor: '#3f3f46',
    highlightedColors: ['#7dd3fc'],
    onClick: click,
    style: { width: '100%' },
    svgStyle: { width: '100%', height: 'auto' },
  }
  return (
    <div className="zones" role="group" aria-label="Choisir une zone du corps">
      <div><Model {...common} type="anterior" /><span>Face</span></div>
      <div><Model {...common} type="posterior" /><span>Dos</span></div>
    </div>
  )
}

const BACK = new Set<Muscle>(['trapezius', 'upper-back', 'lower-back', 'back-deltoids', 'triceps', 'gluteal', 'hamstring'])

/** Vignette « muscles travaillés » pour les mouvements sans photo. */
export function MuscleThumb({ primary, secondary }: { primary: string[]; secondary: string[] }) {
  const p = toSlugs(primary)
  const s = toSlugs(secondary).filter((x) => !p.includes(x))
  const back = p.filter((x) => BACK.has(x)).length > p.length / 2
  return (
    <div className="mthumb" aria-hidden="true">
      <Model
        data={[{ name: 'p', muscles: p }, { name: 'p2', muscles: p }, { name: 's', muscles: s }]}
        bodyColor="#34343b" highlightedColors={['#0e7490', '#7dd3fc']}
        type={back ? 'posterior' : 'anterior'}
        style={{ height: '100%' }} svgStyle={{ height: '100%', width: 'auto' }}
      />
    </div>
  )
}
