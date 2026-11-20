import { useEffect, useState } from 'react'

/** Les fiches ont 2 images (départ / arrivée) : on les alterne pour animer le mouvement. */
export function AnimatedFrames({ frames, alt }: { frames: string[]; alt: string }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (frames.length < 2 || paused) return
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 900)
    return () => clearInterval(t)
  }, [frames.length, paused])
  if (!frames.length) return null
  return (
    <button type="button" className="anim" onClick={() => setPaused(!paused)} aria-label={paused ? 'Relancer l\'animation' : 'Mettre l\'animation en pause'}>
      {frames.map((src, k) => (
        <img key={src} src={src} alt={k === 0 ? alt : ''} loading="lazy" style={{ opacity: k === i ? 1 : 0 }} />
      ))}
      {paused && <span className="anim-badge">Pause</span>}
    </button>
  )
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

/** Vidéo de démonstration : fichier vidéo direct, YouTube, ou simple lien. */
export function DemoVideo({ url }: { url: string }) {
  const yt = youtubeId(url)
  if (yt) {
    return (
      <div className="video">
        <iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Vidéo de démonstration" allow="encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    )
  }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <video className="video-file" src={url} controls loop muted playsInline preload="metadata" />
        <a className="small" href={url} target="_blank" rel="noreferrer">Ouvrir la vidéo</a>
      </div>
    )
  }
  return <a href={url} target="_blank" rel="noreferrer">Voir la vidéo de démonstration</a>
}
