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
