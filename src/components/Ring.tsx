interface RingSpec {
  value: number // 0..1
  color: string
  track: string
}

/** Anneaux concentriques façon Apple Fitness. */
export function Rings({ rings, size = 132, label }: { rings: RingSpec[]; size?: number; label: string }) {
  const step = 10
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label}>
      {rings.map((r, i) => {
        const radius = 44 - i * step
        return (
          <g key={i}>
            <circle cx="50" cy="50" r={radius} fill="none" stroke={r.track} strokeWidth="8" />
            <circle
              cx="50" cy="50" r={radius} fill="none" stroke={r.color} strokeWidth="8" strokeLinecap="round"
              pathLength={100} strokeDasharray={`${Math.max(0.5, Math.min(1, r.value) * 100)} 100`}
              transform="rotate(-90 50 50)"
            />
          </g>
        )
      })}
    </svg>
  )
}

/** Jauge simple avec score au centre. */
export function ScoreRing({ value, max = 100, color, caption, size = 116 }: { value: number | null; max?: number; color: string; caption: string; size?: number }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${caption} ${value ?? 'inconnu'}`}>
      <circle cx="50" cy="50" r="42" fill="none" stroke="#2c2c2e" strokeWidth="10" />
      <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} transform="rotate(-90 50 50)" />
      <text x="50" y="53" textAnchor="middle" fontSize="26" fontWeight="800" fill="#f5f5f7">{value ?? '–'}</text>
      <text x="50" y="69" textAnchor="middle" fontSize="9" fill="#a1a1aa">{caption}</text>
    </svg>
  )
}
