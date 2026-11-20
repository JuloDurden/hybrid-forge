import { useCallback, useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { loadAll, type AppData } from './lib/data'
import { GitHubError, loadConfig, type RepoConfig } from './lib/github'
import { Library } from './pages/Library'
import { Mobility } from './pages/Mobility'
import { Settings } from './pages/Settings'
import { Summary } from './pages/Summary'

function useRoute() {
  const get = () => window.location.hash.replace('#', '') || 'resume'
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const on = () => setRoute(get())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export default function App() {
  const route = useRoute()
  const [config, setConfig] = useState<RepoConfig | null>(() => loadConfig())
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (c: RepoConfig) => {
    setError(null)
    try {
      setData(await loadAll(c))
    } catch (e) {
      setError(e instanceof GitHubError && e.status === 401 ? 'Jeton refusé : mets-le à jour dans Réglages.' : (e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (config) refresh(config)
  }, [config, refresh])

  const effectiveRoute = !config ? 'reglages' : route

  let content
  if (effectiveRoute === 'reglages') {
    content = <Settings onSaved={() => { setConfig(loadConfig()); window.location.hash = 'resume' }} />
  } else if (error) {
    content = <div className="notice err">{error}</div>
  } else if (!data) {
    content = <div className="muted">Chargement des données…</div>
  } else if (effectiveRoute === 'bibliotheque') {
    content = <Library config={config!} />
  } else if (effectiveRoute === 'mobilite') {
    content = <Mobility config={config!} data={data} />
  } else if (effectiveRoute === 'resume') {
    content = <Summary data={data} config={config!} />
  } else {
    content = (
      <>
        <h1>Bientôt</h1>
        <div className="empty">Cet écran arrive dans une prochaine version (maquettes validées).</div>
      </>
    )
  }

  return <Layout route={effectiveRoute} syncedAt={data?.status.syncedAt}>{content}</Layout>
}
