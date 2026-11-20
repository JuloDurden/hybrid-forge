import { useState } from 'react'
import { checkAccess, clearConfig, DEFAULT_REPO, loadConfig, saveConfig } from '../lib/github'

export function Settings({ onSaved }: { onSaved: () => void }) {
  const current = loadConfig()
  const [token, setToken] = useState(current?.token ?? '')
  const [owner, setOwner] = useState(current?.owner ?? DEFAULT_REPO.owner)
  const [repo, setRepo] = useState(current?.repo ?? DEFAULT_REPO.repo)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const cfg = { token: token.trim(), owner: owner.trim(), repo: repo.trim() }
    const res = await checkAccess(cfg)
    setBusy(false)
    setMsg({ ok: res.ok, text: res.message })
    if (res.ok) {
      saveConfig(cfg)
      onSaved()
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="overline">Réglages</div>
          <h1>Connexion aux données</h1>
        </div>
      </header>
      <div className="grid" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={submit}>
          <span className="overline">Repo de données privé</span>
          <label className="field">Propriétaire<input value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="off" /></label>
          <label className="field">Repo<input value={repo} onChange={(e) => setRepo(e.target.value)} autoComplete="off" /></label>
          <label className="field">Jeton GitHub (fine-grained)
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          </label>
          {msg && <div className={`notice ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !token}>{busy ? 'Vérification…' : 'Enregistrer'}</button>
            {current && (
              <button className="btn ghost" type="button" onClick={() => { clearConfig(); setToken(''); setMsg({ ok: true, text: 'Jeton effacé de cet appareil.' }) }}>
                Effacer le jeton
              </button>
            )}
          </div>
        </form>
        <section className="card">
          <span className="overline">Créer le jeton (une fois)</span>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.45 }}>
            <li>GitHub › Settings › Developer settings › <b>Fine-grained tokens</b> › Generate new token.</li>
            <li>Expiration : 1 an. Repository access : <b>Only select repositories</b> › <code>hybrid-forge-data</code>.</li>
            <li>Permissions › Repository › <b>Contents : Read and write</b> et <b>Actions : Read and write</b> (pour déclencher une synchro depuis l'app).</li>
            <li>Colle le jeton ici, sur chaque appareil (PC, iPhone).</li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>Le jeton reste uniquement dans ce navigateur. L'app est publique mais ne contient aucune donnée : sans jeton, elle ne voit rien.</p>
        </section>
      </div>
    </>
  )
}
