import garminExercises from './data/garmin-exercises.json'

const rings = [
  { label: 'Course', color: 'var(--run)' },
  { label: 'Muscu', color: 'var(--lift)' },
  { label: 'WOD', color: 'var(--wod)' },
  { label: 'Mobilité', color: 'var(--mobility)' },
]

export default function App() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>VERSION 0.1 · FONDATIONS</span>
      <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800 }}>Hybrid Forge</h1>
      <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>
        Course, muscu, WOD et mobilité au même endroit, synchronisés avec Garmin Connect et Apple Santé.
      </p>
      <section style={{ background: 'var(--surface)', borderRadius: 22, padding: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {rings.map((r) => (
          <span key={r.label} style={{ padding: '6px 12px', borderRadius: 999, background: 'var(--surface-2)', color: r.color, fontWeight: 600, fontSize: 13 }}>
            {r.label}
          </span>
        ))}
      </section>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        Catalogue Garmin chargé : {garminExercises.length} exercices de musculation.
      </p>
    </main>
  )
}
