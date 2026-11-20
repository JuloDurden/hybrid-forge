import type { ReactNode } from 'react'
import { relativeTime } from '../lib/data'

const LINKS = [
  { to: 'resume', label: 'Résumé' },
  { to: 'plan', label: 'Plan & macrocycles', soon: true },
  { to: 'seances', label: 'Séances', soon: true },
  { to: 'bibliotheque', label: 'Bibliothèque', soon: true },
  { to: 'wod', label: 'WOD', soon: true },
  { to: 'mobilite', label: 'Mobilité', soon: true },
  { to: 'stats', label: 'Statistiques', soon: true },
  { to: 'reglages', label: 'Réglages' },
]

export function Layout({ route, syncedAt, children }: { route: string; syncedAt?: string; children: ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Navigation principale">
        <div className="brand">
          <span className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 14h4l3-8 3 12 3-6h3" /></svg>
          </span>
          Hybrid Forge
        </div>
        {LINKS.map((l) => (
          <a key={l.to} href={`#${l.to}`} className={`${route === l.to ? 'active' : ''} ${l.soon ? 'soon' : ''}`}>{l.label}</a>
        ))}
        <div className="sync-box">
          <span className="small muted" style={{ fontWeight: 600 }}>SYNCHRO</span>
          <span>Garmin · {relativeTime(syncedAt)}</span>
          <span className="muted">HealthFit · à venir</span>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  )
}
